"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Download, ImagePlus, LoaderCircle, RotateCcw, Sparkles, StopCircle } from 'lucide-react';
import type { Plan } from '@/lib/plan';
import { STYLE_OPTIONS } from '@/lib/plan';
import { downloadImage } from '@/lib/export';
import { getPanoramaSceneKey, getPanoramaProjectKey, isPanoramaImageAspect } from '@/lib/panorama';
import { loadPanoramas, savePanorama, type PanoramaRecord } from '@/lib/panorama-store';
import dynamic from 'next/dynamic';
const PhotoStudy=dynamic(()=>import('./PhotoStudy'),{ssr:false});
import PhotoWorldPanel from './PhotoWorldPanel';
import PanoramaViewer from '@/components/PhotoSphereViewer';
import './photo-tour.css';

type Props = { sourceImage?:{id:string;image:string}; plan: Plan; styleId: string; prompt: string; selectedRoomId?: string; imageConfigured: boolean; onConfigure: () => void };
type Pending = { taskId: string; taskToken: string; model: string; projectKey: string; sceneKey: string; roomId: string; roomName: string; styleId: string; styleName: string; createdAt: number; recordId: string };
class TaskFailure extends Error { constructor(message: string, readonly definitive = false) { super(message); } }
const PENDING_PREFIX = 'roomcraft.panorama.pending.v1.';
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请稍后重试';
function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('停止等待', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('停止等待', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
function isPending(value: unknown, projectKey: string): value is Pending {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Pending>;
  return item.projectKey === projectKey && typeof item.taskId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(item.taskId) &&
    typeof item.taskToken === 'string' && /^\d{10}\.[a-zA-Z0-9_-]{43}$/.test(item.taskToken) &&
    ['model', 'sceneKey', 'roomId', 'roomName', 'styleId', 'styleName', 'recordId'].every(key => typeof item[key as keyof Pending] === 'string' && String(item[key as keyof Pending]).length < 1000) && Number.isFinite(item.createdAt);
}
async function imageDimensions(image: string): Promise<{ width: number; height: number }> {
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(image) || image.length > 30 * 1024 * 1024) throw new Error('全景图片格式或大小不受支持');
  return new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => { const width = element.naturalWidth, height = element.naturalHeight; element.onload = null; element.onerror = null; element.removeAttribute('src'); if (!width || !height || width * height > 32000000) reject(new Error('全景图片像素超过 3200 万，请缩小后重试')); else resolve({ width, height }); };
    element.onerror = () => reject(new Error('无法读取全景图片，请下载检查后重试'));
    element.src = image;
  });
}

export default function PhotoTour({ plan, styleId, prompt, selectedRoomId, imageConfigured, onConfigure,sourceImage }: Props) {
  const [studyId,setStudyId]=useState('');
  const [world,setWorld]=useState<{image:string;id:string}|null>(null);
  const projectKey = getPanoramaProjectKey(plan)+(sourceImage?':image:'+sourceImage.id:'');
  const [records, setRecords] = useState<PanoramaRecord[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [roomId, setRoomId] = useState(plan.rooms[0]?.id || '');
  const [demo, setDemo] = useState(!sourceImage);
  const [busy, setBusy] = useState<'submit' | 'poll' | 'upload' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rejectedImage, setRejectedImage] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const stopped = useRef(false);
  const alive = useRef(true);
  const activeProject = useRef(projectKey);
  activeProject.current = projectKey;
  const upload = useRef<HTMLInputElement>(null);
  const currentRoom = plan.rooms.find(room => room.id === roomId) || plan.rooms[0];
  const currentRoomId = currentRoom?.id || '';
  const sceneKey = currentRoom ? getPanoramaSceneKey(plan, currentRoom.id, styleId, prompt) : '';
  const current = useMemo(() => records.find(record => record.roomId === currentRoomId), [records, currentRoomId]);
  const stale = !!current && current.sceneKey !== sceneKey;
  const style = STYLE_OPTIONS.find(item => item.id === styleId) || STYLE_OPTIONS[0];

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abort.current?.abort(); };
  }, []);
  useEffect(() => {
    let active = true;
    abort.current?.abort();
    setLoaded(false); setBusy(null); setRecords([]); setPending(null); pendingRef.current = null; setDemo(!sourceImage); setError(''); setRejectedImage('');
    void (async () => {
      try { const values = await loadPanoramas(projectKey); if (active) setRecords(values); }
      catch (error) { if (active) setNotice(messageOf(error)); }
      try {
        const text = localStorage.getItem(PENDING_PREFIX + projectKey);
        if (text) {
          const value: unknown = JSON.parse(text);
          if (isPending(value, projectKey)) { if (active) { setPending(value); pendingRef.current = value; } }
          else if (active) setError('上次全景任务的本机记录无效，请检查服务记录后再提交。');
        }
      } catch { if (active) setNotice('无法读取本机全景任务记录，请检查浏览器存储权限。'); }
      if (active) setLoaded(true);
    })();
    return () => { active = false; abort.current?.abort(); };
  }, [projectKey]);
  useEffect(() => {
    if (selectedRoomId && selectedRoomId !== 'all' && plan.rooms.some(room => room.id === selectedRoomId)) { setRoomId(selectedRoomId); setDemo(false); }
  }, [selectedRoomId, plan.rooms]);
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const timer = setInterval(() => setElapsed(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  function persist(task: Pending) {
    if (activeProject.current === task.projectKey) { pendingRef.current = task; if (alive.current) setPending(task); }
    try { localStorage.setItem(PENDING_PREFIX + task.projectKey, JSON.stringify(task)); }
    catch { if (alive.current) setNotice('无法保存任务恢复记录，请保持页面打开，并记得下载生成结果。'); }
  }
  function clearPending(task: Pending) {
    try { localStorage.removeItem(PENDING_PREFIX + task.projectKey); } catch { /* Successful result remains downloadable. */ }
    if (pendingRef.current?.taskId === task.taskId) { pendingRef.current = null; if (alive.current) setPending(null); }
  }
  async function accept(image: string, model: string, task: Pending) {
    const dimensions = await imageDimensions(image);
    if (!isPanoramaImageAspect(dimensions.width, dimensions.height)) {
      if (alive.current && activeProject.current === task.projectKey) setRejectedImage(image);
      clearPending(task);
      throw new TaskFailure(`模型返回了 ${dimensions.width}×${dimensions.height} 图片，未达到 2:1 全景比例；已保留原图供下载，没有把普通效果图当作全景。`, true);
    }
    const record: PanoramaRecord = { id: task.recordId, projectKey: task.projectKey, sceneKey: task.sceneKey, roomId: task.roomId, roomName: task.roomName, styleId: task.styleId, styleName: task.styleName, image, model, source: 'generated', createdAt: task.createdAt };
    let storageWarning = '';
    try { await savePanorama(record); }
    catch (error) { storageWarning = messageOf(error); }
    clearPending(task);
    if (alive.current && activeProject.current === task.projectKey) { setRecords(items => [record, ...items.filter(item => item.id !== record.id)].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8)); setRoomId(task.roomId); setDemo(false); setNotice(storageWarning || '全景已生成；AI 画面需核对门窗与布局，不能用于测量。'); }
  }
  async function run(resume?: Pending) {
    if (busy || !loaded) return;
    if (!resume && pendingRef.current) { setError('已有全景任务，请先继续查询原任务，避免重复提交。'); return; }
    if (!resume && !imageConfigured) { onConfigure(); return; }
    if (!resume && !currentRoom) { setError('请先识别户型或添加房间边界，再生成房间全景。'); return; }
    const controller = new AbortController(); abort.current = controller; stopped.current = false;
    setBusy(resume ? 'poll' : 'submit'); setError(''); setNotice(''); setRejectedImage('');
    let task = resume;
    const timeout = setTimeout(() => controller.abort(), 8 * 60 * 1000);
    try {
      if (!task) {
        const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, style: styleId, prompt, roomId: currentRoomId, mode: 'panorama', referenceImage:sourceImage?.image }), signal: controller.signal });
        const data = await response.json() as { error?: string; image?: string; taskId?: string; taskToken?: string; model?: string; sourceKey?: string };
        if (!response.ok) throw new TaskFailure(data.error || '全景生成请求未被接受', true);
        const snapshot = { projectKey, sceneKey: typeof data.sourceKey === 'string' ? data.sourceKey : sceneKey, roomId: currentRoomId, roomName: currentRoom!.name, styleId, styleName: style.name, createdAt: Date.now(), recordId: crypto.randomUUID() };
        if (data.image) { await accept(data.image, data.model || 'GPT Image', { ...snapshot, taskId: 'synchronous', taskToken: '', model: data.model || 'GPT Image' }); return; }
        task = { ...snapshot, taskId: data.taskId || '', taskToken: data.taskToken || '', model: data.model || 'GPT Image' };
        if (!isPending(task, projectKey)) throw new TaskFailure('服务未返回有效任务凭据，请先检查服务记录，避免重复生成。');
        persist(task);
      }
      setBusy('poll');
      while (!controller.signal.aborted) {
        await wait(4500, controller.signal);
        const response = await fetch(`/api/generate?taskId=${encodeURIComponent(task.taskId)}`, { headers: { 'X-Roomcraft-Task-Token': task.taskToken }, signal: controller.signal });
        const data = await response.json() as { status?: string; error?: string; image?: string; model?: string; warning?: string };
        if (!response.ok || data.status === 'failed') throw new TaskFailure((data.error || '暂时无法查询全景任务，请继续等待').replaceAll(task.taskToken, '[任务凭据]'), data.status === 'failed' || [400, 403, 404, 410, 422].includes(response.status));
        if (data.image) { await accept(data.image, data.model || task.model, task); if (data.warning && alive.current) setNotice(data.warning); return; }
        if (!['processing', 'pending', 'queued'].includes(data.status || '')) throw new TaskFailure('任务状态暂不可用，请稍后继续查询。');
      }
    } catch (error) {
      if (task && error instanceof TaskFailure && error.definitive) clearPending(task);
      else if (task) persist(task);
      if (alive.current && activeProject.current === projectKey) setError(task && !(error instanceof TaskFailure && error.definitive) ? stopped.current ? '已停止等待。后台可能继续生成，可查询原任务，不会再次提交。' : '等待已中断或超时，任务已保留；请继续等待原任务。' : task ? messageOf(error) : error instanceof TaskFailure && error.definitive ? messageOf(error) : '尚未取得任务凭据，服务端可能仍在处理；请检查服务记录后再提交，避免重复费用。');
    } finally { clearTimeout(timeout); if (alive.current && activeProject.current === projectKey && abort.current === controller) setBusy(null); if (abort.current === controller) abort.current = null; }
  }
  async function importPanorama(file?: File) {
    if (!file || busy || !currentRoom) return;
    setBusy('upload'); setError(''); setRejectedImage('');
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('请上传 20 MB 以内的 PNG、JPG 或 WEBP 2:1 全景图片。');
      const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file); });
      const dimensions = await imageDimensions(image);
      if (!isPanoramaImageAspect(dimensions.width, dimensions.height)) throw new Error('需要 2:1 的等距柱状全景图，例如 4096×2048；普通透视照片无法完整环顾。');
      const record: PanoramaRecord = { id: crypto.randomUUID(), projectKey, sceneKey, roomId: currentRoomId, roomName: currentRoom.name, styleId, styleName: '用户全景', image, model: '用户上传', createdAt: Date.now(), source: 'upload' };
      let storageWarning = '';
      try { await savePanorama(record); } catch (error) { storageWarning = messageOf(error); }
      setRecords(items => [record, ...items.filter(item => item.id !== record.id)].slice(0, 8)); setDemo(false);
      setNotice(storageWarning || '已载入用户上传的全景；来源与拍摄位置由上传者确认，不表示图片自动匹配户型。');
    } catch (error) { setError(messageOf(error)); }
    finally { setBusy(null); if (upload.current) upload.current.value = ''; }
  }

  const showImage = demo ? '/images/photo-tour-demo-v1.png' : current?.image;
  const label = demo ? 'AI 全景示例 · 非当前户型 · 非实拍' : current?.source === 'upload' ? `${current.roomName} · 用户上传全景` : `${current?.roomName || ''} · AI 生成全景 · 非实拍`;
  return <div className="photo-tour" data-testid="photo-tour">
    <header className="photo-tour-header"><div><span className="photo-tour-eyebrow">PANORAMA PREVIEW</span><h3>{sourceImage?"按效果图生成房间全景":"照片质感，环顾空间。"}</h3><p>拖动可原地环顾；要走进画面，请从当前全景生成可行走空间。</p></div><button className={demo ? 'photo-demo active' : 'photo-demo'} onClick={() => setDemo(true)}><Sparkles size={13} />查看全景示例</button></header>
    <div className="photo-tour-room-row"><label><span>房间节点</span><select aria-label="全景房间节点" value={currentRoomId} disabled={!!busy || !plan.rooms.length} onChange={event => { setRoomId(event.target.value); setDemo(false); setError(''); }}>{plan.rooms.map(room => <option key={room.id} value={room.id}>{room.name}{records.some(record => record.roomId === room.id) ? ' · 已有全景' : ' · 待生成'}</option>)}{!plan.rooms.length && <option value="">先添加或识别房间</option>}</select></label><span className="photo-tour-current-style">{style.name}</span><div className="photo-tour-actions"><button onClick={() => upload.current?.click()} disabled={!!busy || !currentRoom || !loaded} title="上传2:1等距柱状全景图"><ImagePlus size={14} /><span>上传全景</span></button><button className="photo-generate" disabled={!!busy || !loaded || !!pending || !currentRoom} onClick={() => void run()}><Sparkles size={14} /><span>{imageConfigured ? current ? '重新生成房间全景' : '生成当前房间全景' : '配置生图服务'}</span></button></div></div>
    {showImage&&<div className="world-entry"><div><strong>走进{demo?'示例空间':current?.roomName}</strong><small>先体验照片空间，或生成更大范围的漫游。</small></div><button className="button button-dark" onClick={()=>setStudyId(demo?"demo":current!.id)}>进入照片空间</button><button className="button button-light" onClick={()=>setWorld({image:showImage,id:demo?'roomcraft-pano-demo-v1':current!.id})}>生成写实漫游空间</button></div>}
    <input ref={upload} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传2比1全景图" onChange={event => void importPanorama(event.target.files?.[0])} />
    <div className="photo-tour-frame" style={{position:"relative"}}>{world&&<PhotoWorldPanel key={world.id} image={world.image} imageId={world.id} onClose={()=>setWorld(null)}/>}
      {showImage && studyId===(demo?"demo":current?.id)?<PhotoStudy key={studyId} image={showImage} sample={demo} onExit={()=>setStudyId("")}/>:showImage ? <PanoramaViewer image={showImage} label={label} sourceLabel={!demo && current?.source === 'upload' ? '用户上传全景 · 来源由上传者确认' : 'AI 全景 · 非实拍'} onError={setError} /> : <div className="photo-tour-empty"><ImagePlus size={34} /><h4>{currentRoom ? `${currentRoom.name}还没有全景` : '先定义一个房间'}</h4><p>生成当前房间的 2:1 全景，或上传已有的全景图片。<br />也可以先查看 AI 示例，体验环顾操作。</p><button onClick={() => setDemo(true)}>查看示例<ArrowRight size={14} /></button></div>}
      {busy && <div className="photo-tour-progress" role="status"><LoaderCircle size={16} className="spin" /><span>{busy === 'upload' ? '正在读取全景' : busy === 'submit' ? '正在提交一次全景生成请求' : '全景任务已受理，正在查询原任务'} · {elapsed}s</span>{busy !== 'upload' && <button onClick={() => { stopped.current = true; abort.current?.abort(); }}><StopCircle size={13} />停止等待</button>}</div>}
    </div>
    {!demo && stale && <p className="photo-tour-stale" role="status">户型、材质、风格或设计要求已变化；当前全景是旧版画面，请重新生成。图片不会自动跟随三维几何变化。</p>}
    {pending && !busy && <div className="photo-pending"><div><RotateCcw size={15} /><span><strong>{pending.roomName}的全景任务待查询</strong><small>继续等待只查询原任务，不重复提交。{pending.sceneKey !== getPanoramaSceneKey(plan, pending.roomId, styleId, prompt) ? ' 户型或风格已变化，完成结果将标为旧版。' : ''}</small></span></div><button onClick={() => void run(pending)} disabled={!loaded}>继续等待</button></div>}
    {error && <p className="photo-tour-error" role="alert">{error}</p>}
    {rejectedImage && <button className="photo-tour-download" onClick={() => downloadImage(rejectedImage, '未通过全景比例检查的生成原图.png')}><Download size={13} />下载生成原图</button>}
    {notice && <p className="photo-tour-notice" role="status">{notice}</p>}
    {records.length > 0 && <div className="photo-tour-nodes" aria-label="已保存全景节点">{plan.rooms.map(room => { const record = records.find(item => item.roomId === room.id); return <button key={room.id} className={!demo && currentRoomId === room.id ? 'selected' : ''} onClick={() => { setRoomId(room.id); setDemo(false); }} disabled={!!busy}>{record ? <img src={record.image} alt="" /> : <span className="photo-node-placeholder"><ImagePlus size={15} /></span>}<span><strong>{room.name}</strong><small>{record ? record.sceneKey === getPanoramaSceneKey(plan, room.id, styleId, prompt) ? '已有全景' : '旧版 · 需重生成' : '待生成'}</small></span>{record && <Check size={12} />}</button>; })}</div>}
    <footer className="photo-tour-footer"><span>AI 全景用于氛围预览，门窗和布局需核对，不能用于现场测量。本机最多保留最近 8 张，不随项目分享链接传递。</span>{!demo && current && <button onClick={() => downloadImage(current.image, `${current.roomName}-全景.png`)}><Download size={13} />下载全景原图</button>}</footer>
  </div>;
}
