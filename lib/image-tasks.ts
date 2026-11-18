import { Buffer } from 'node:buffer';
import { ApiError, ImageTaskFailed } from './http-error';

type ImageConfig = { imageKey: string; imageBase: string; imageModel: string };
export type ImageTaskOptions = { preset?: 'interior' | 'panorama' };
const encoder = new TextEncoder();
const DAY_SECONDS = 24 * 60 * 60;

async function signingKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function taskToken(config: ImageConfig, taskId: string, actor: string) {
  const issued = Math.floor(Date.now() / 1000);
  const signature = await crypto.subtle.sign('HMAC', await signingKey(config.imageKey), encoder.encode(`roomcraft-image:${taskId}:${actor}:${issued}`));
  return `${issued}.${Buffer.from(signature).toString('base64url')}`;
}
async function verifyToken(config: ImageConfig, taskId: string, actor: string, token: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(taskId)) throw new ApiError('生图任务编号无效。');
  const match = /^(\d{10})\.([a-zA-Z0-9_-]{43})$/.exec(token);
  if (!match) throw new ApiError('生图任务凭据无效。', 403);
  const age = Math.floor(Date.now() / 1000) - Number(match[1]);
  if (age < -60 || age > DAY_SECONDS) throw new ApiError('生图任务查询已过期，请及时下载生成结果。', 410);
  const valid = await crypto.subtle.verify('HMAC', await signingKey(config.imageKey), Buffer.from(match[2], 'base64url'), encoder.encode(`roomcraft-image:${taskId}:${actor}:${match[1]}`));
  if (!valid) throw new ApiError('不能访问这个生图任务。', 403);
}
async function responseJSON(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404 || response.status === 410) throw new ApiError('生图任务不存在或已过期。', 410);
    if (response.status === 401 || response.status === 403) throw new ApiError('生图服务拒绝访问，请检查模型权限。', 502);
    if (response.status === 402 || response.status === 429) throw new ApiError('生图额度或并发受限，请稍后继续查询。', 429);
    throw new ApiError('生图服务暂时不可用，已受理的任务可稍后继续查询。', 502);
  }
  try { return await response.json() as Record<string, unknown>; }
  catch { throw new ApiError('生图服务返回了无法解析的响应。', 502); }
}

/** One submission only. Callers must retain its token and poll rather than resubmit. */
export async function submitImageTask(config: ImageConfig, prompt: string, actor: string, referenceImage?: string, options: ImageTaskOptions = {}) {
  const path = referenceImage ? '/images/edits/async' : '/images/generations/async';
  const panorama = options.preset === 'panorama';
  const body = { model: config.imageModel, prompt, size: panorama ? '2048x1024' : '1536x1024', quality: panorama ? 'high' : 'medium', n: 1, output_format: 'png', ...(referenceImage ? { image_base64: referenceImage } : {}) };
  const result = await responseJSON(await fetch(config.imageBase + path, { method: 'POST', headers: { Authorization: `Bearer ${config.imageKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) }));
  if (typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(result.id) || !['processing', 'succeeded'].includes(String(result.status))) throw new ApiError('生图任务未返回有效编号，请检查服务任务记录后再提交。', 502);
  return { status: 'processing' as const, taskId: result.id, taskToken: await taskToken(config, result.id, actor), model: config.imageModel };
}

async function downloadImage(urlValue: unknown): Promise<string> {
  if (typeof urlValue !== 'string') throw new ApiError('生图任务没有返回可用图片。', 502);
  let url: URL; try { url = new URL(urlValue); } catch { throw new ApiError('生图服务返回了无效图片地址。', 502); }
  if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) throw new ApiError('生图服务返回了不受支持的图片地址。', 502);
  // The URL is accepted only from the authenticated provider response, never from a client parameter.
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (response.status === 410) throw new ApiError('生成图片下载链接已过期。', 410);
  if (!response.ok || !response.body) throw new ApiError('图片暂时无法下载，请继续查询这个任务。', 502);
  const limit = 20 * 1024 * 1024;
  if (Number(response.headers.get('content-length') || 0) > limit) { await response.body.cancel(); throw new ApiError('生成图片超过允许大小，请联系管理员保存。', 502); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new ApiError('生成图片超过允许大小。', 502); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, size);
  const mime = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
  if (!mime) throw new ApiError('生成结果不是支持的图片文件。', 502);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

export async function pollImageTask(config: ImageConfig, taskId: string, token: string, actor: string) {
  await verifyToken(config, taskId, actor, token);
  const task = await responseJSON(await fetch(`${config.imageBase}/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${config.imageKey}` }, signal: AbortSignal.timeout(25000) }));
  if (task.id !== taskId) throw new ApiError('生图服务返回了不匹配的任务。', 502);
  const model = typeof task.model === 'string' ? task.model : config.imageModel;
  if (task.status === 'processing') return { status: 'processing' as const, model };
  if (task.status === 'failed') {
    // Observed Conflux gateway defect: an HTTP 502 error can wrap a completed
    // image result. Recover only its precise envelope and known result hosts,
    // then validate actual downloaded bytes. Never turn an error string into success.
    const error = task.error as { message?: unknown } | undefined;
    const prefix = '上游调用失败: upstream HTTP 502: ';
    let recoveredURL: string | undefined;
    if (typeof error?.message === 'string' && error.message.startsWith(prefix)) {
      try {
        const payload = JSON.parse(error.message.slice(prefix.length)) as { data?: { url?: unknown }[] };
        const candidate = payload.data?.[0]?.url;
        if (typeof candidate === 'string') {
          const url = new URL(candidate);
          const trustedHosts = ['multimodal.vibelearning.top', new URL(config.imageBase).hostname];
          if (url.protocol === 'https:' && trustedHosts.includes(url.hostname)) recoveredURL = url.href;
        }
      } catch { /* Ordinary model failures remain failures. */ }
    }
    if (recoveredURL) return { status: 'succeeded' as const, image: await downloadImage(recoveredURL), model, warning: '供应商任务状态异常，已成功取回真实图片；请核对并下载保存。' };
    throw new ImageTaskFailed('模型生成失败，原设计和已有图片已保留。可以重新提交新任务。', 502);
  }
  if (task.status !== 'succeeded') throw new ApiError('生图服务返回了未知任务状态。请稍后继续查询。', 502);
  return { status: 'succeeded' as const, image: await downloadImage(Array.isArray(task.urls) ? task.urls[0] : undefined), model };
}
