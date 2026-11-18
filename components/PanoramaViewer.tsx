"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Expand, LoaderCircle, Minus, Plus, RotateCcw } from 'lucide-react';
import { createPanoramaRays, DEFAULT_PANORAMA_POSE, normalizePanoramaPose, renderPanoramaPixels } from '@/lib/panorama-projection';
import type { PanoramaPixels, PanoramaPose } from '@/lib/panorama-projection';
import './panorama-viewer.css';

export interface PanoramaViewerProps { image: string; label: string; sourceLabel?: string; onError?: (message: string) => void }
type Quality = 'preview' | 'full';

export default function PanoramaViewer({ image, label, sourceLabel = 'AI 全景 · 非实拍', onError }: PanoramaViewerProps) {
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const pixels = useRef<PanoramaPixels | null>(null), pose = useRef<PanoramaPose>({ ...DEFAULT_PANORAMA_POSE });
  const rays = useRef<{ width: number; height: number; fov: number; data: Float32Array } | null>(null);
  const pendingFrame = useRef(0), detailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawRef = useRef<(quality: Quality) => void>(() => {}), errorCallback = useRef(onError);
  errorCallback.current = onError;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [retry, setRetry] = useState(0);
  const [displayPose, setDisplayPose] = useState<PanoramaPose>({ ...DEFAULT_PANORAMA_POSE });

  const draw = useCallback((quality: Quality) => {
    const element = canvas.current, host = root.current, source = pixels.current;
    if (!element || !host || !source) return;
    const bounds = host.getBoundingClientRect();
    if (bounds.width < 2 || bounds.height < 2) return;
    const dpr = quality === 'preview' ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    const maxArea = quality === 'preview' ? 240000 : 1100000, maxEdge = quality === 'preview' ? 680 : 1450;
    const scale = Math.min(dpr, maxEdge / Math.max(bounds.width, bounds.height), Math.sqrt(maxArea / (bounds.width * bounds.height)));
    const width = Math.max(2, Math.round(bounds.width * scale)), height = Math.max(2, Math.round(bounds.height * scale));
    if (element.width !== width || element.height !== height) { element.width = width; element.height = height; }
    const context = element.getContext('2d', { alpha: false });
    if (!context) { setError('当前浏览器无法显示全景画布，请刷新后重试。'); setStatus('error'); return; }
    const view = pose.current;
    if (!rays.current || rays.current.width !== width || rays.current.height !== height || rays.current.fov !== view.fov) rays.current = { width, height, fov: view.fov, data: createPanoramaRays(width, height, view.fov) };
    const output = renderPanoramaPixels(source, rays.current.data, view, quality === 'full');
    const frame = context.createImageData(width, height); frame.data.set(output); context.putImageData(frame, 0, 0);
  }, []);
  drawRef.current = draw;

  const schedule = useCallback((quality: Quality = 'preview') => {
    cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = requestAnimationFrame(() => { pendingFrame.current = 0; drawRef.current(quality); });
    if (detailTimer.current) clearTimeout(detailTimer.current);
    if (quality === 'preview') detailTimer.current = setTimeout(() => { detailTimer.current = null; drawRef.current('full'); }, 160);
  }, []);
  const move = useCallback((delta: Partial<PanoramaPose>, absolute = false) => {
    const previous = pose.current;
    pose.current = normalizePanoramaPose(absolute ? { ...previous, ...delta } : { yaw: previous.yaw + (delta.yaw || 0), pitch: previous.pitch + (delta.pitch || 0), fov: previous.fov + (delta.fov || 0) });
    setDisplayPose(pose.current); schedule();
  }, [schedule]);

  useEffect(() => {
    let active = true;
    pixels.current = null; rays.current = null; pose.current = { ...DEFAULT_PANORAMA_POSE }; setDisplayPose(pose.current);
    setStatus('loading'); setError(''); setNotice('');
    const element = canvas.current;
    element?.getContext('2d')?.clearRect(0, 0, element.width, element.height);
    const photo = new Image(); photo.crossOrigin = 'anonymous'; photo.decoding = 'async';
    const fail = (message: string) => { if (active) { setError(message); setStatus('error'); errorCallback.current?.(message); } };
    photo.onload = () => {
      if (!active) return;
      try {
        const { naturalWidth: width, naturalHeight: height } = photo;
        if (width < 400 || height < 200 || width * height > 48000000) throw new Error('全景图片尺寸无效或过大，请使用清晰的 2:1 全景图。');
        if (Math.abs(width / height - 2) > .04) throw new Error('这张图片不是 2:1 球面全景图，不能作为 360° 环顾视图。');
        const scale = Math.min(1, 4096 / width), buffer = document.createElement('canvas');
        buffer.width = Math.round(width * scale); buffer.height = Math.round(height * scale);
        const context = buffer.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('当前浏览器无法读取全景图片。');
        context.fillStyle = '#fff'; context.fillRect(0, 0, buffer.width, buffer.height); context.drawImage(photo, 0, 0, buffer.width, buffer.height);
        const data = context.getImageData(0, 0, buffer.width, buffer.height);
        pixels.current = { width: data.width, height: data.height, data: data.data };
        setStatus('ready'); schedule('full');
      } catch (error) { fail(error instanceof Error ? error.message : '全景图片无法显示，请重新生成。'); }
    };
    photo.onerror = () => fail('全景图片加载失败，请检查连接或重新生成。');
    if (!image || image.length > 32 * 1024 * 1024) fail('全景图片为空或超过允许大小。'); else photo.src = image;
    return () => { active = false; photo.onload = null; photo.onerror = null; photo.removeAttribute('src'); pixels.current = null; };
  }, [image, retry, schedule]);

  useEffect(() => {
    const host = root.current, element = canvas.current;
    if (!host || !element) return;
    const resize = new ResizeObserver(() => schedule('full')); resize.observe(host);
    let dragging: { id: number; x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      if (!pixels.current || event.button !== 0 || dragging) return;
      event.preventDefault(); dragging = { id: event.pointerId, x: event.clientX, y: event.clientY }; element.setPointerCapture(event.pointerId); element.focus({ preventScroll: true }); element.style.cursor = 'grabbing';
    };
    const pointer = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== dragging.id) return;
      move({ yaw: -(event.clientX - dragging.x) * .004, pitch: (event.clientY - dragging.y) * .004 });
      dragging.x = event.clientX; dragging.y = event.clientY;
    };
    const release = (event?: PointerEvent) => {
      if (!dragging || (event && event.pointerId !== dragging.id)) return;
      if (element.hasPointerCapture(dragging.id)) element.releasePointerCapture(dragging.id);
      dragging = null; element.style.cursor = 'grab'; schedule('full');
    };
    const wheel = (event: WheelEvent) => { if (!pixels.current) return; event.preventDefault(); move({ fov: Math.max(-10, Math.min(10, event.deltaY * .045)) }); };
    const blur = () => release();
    const keyboard = (event: KeyboardEvent) => {
      if (!pixels.current) return;
      const delta: Record<string, Partial<PanoramaPose>> = { ArrowLeft: { yaw: -.12 }, ArrowRight: { yaw: .12 }, ArrowUp: { pitch: .08 }, ArrowDown: { pitch: -.08 }, '+': { fov: -5 }, '=': { fov: -5 }, '-': { fov: 5 } };
      if (delta[event.key]) { event.preventDefault(); event.stopPropagation(); move(delta[event.key]); }
      if (event.key === 'Home') { event.preventDefault(); move(DEFAULT_PANORAMA_POSE, true); }
    };
    element.addEventListener('pointerdown', down); element.addEventListener('pointermove', pointer); element.addEventListener('pointerup', release); element.addEventListener('pointercancel', release);
    element.addEventListener('wheel', wheel, { passive: false }); element.addEventListener('keydown', keyboard); window.addEventListener('blur', blur);
    return () => {
      resize.disconnect(); element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', pointer); element.removeEventListener('pointerup', release); element.removeEventListener('pointercancel', release);
      element.removeEventListener('wheel', wheel); element.removeEventListener('keydown', keyboard); window.removeEventListener('blur', blur); release();
      cancelAnimationFrame(pendingFrame.current); if (detailTimer.current) clearTimeout(detailTimer.current);
    };
  }, [move, schedule]);

  async function fullscreen() {
    try { if (document.fullscreenElement === root.current) await document.exitFullscreen(); else await root.current?.requestFullscreen(); }
    catch { setNotice('当前浏览器未开放全屏，可继续拖动环顾。'); }
  }
  return <div ref={root} className="pano-viewer" data-testid="panorama-viewer" data-yaw={displayPose.yaw.toFixed(4)} data-pitch={displayPose.pitch.toFixed(4)} data-fov={displayPose.fov.toFixed(1)} data-status={status}>
    <canvas ref={canvas} tabIndex={0} className="pano-canvas" aria-label={`${label}，360度全景，可拖动或使用方向键环顾`} />
    {status === 'ready' && <>
      <div className="pano-heading"><div><span className="pano-badge">360° 全景</span><strong>{label}</strong></div><button type="button" aria-label="全屏查看全景" title="全屏查看" onClick={() => void fullscreen()}><Expand size={16} /></button></div>
      <div className="pano-guide">拖动环顾 · 滚轮缩放<span>图片视点固定，通过房间导航切换</span></div>
      <div className="pano-bottom"><span className="pano-disclosure">{sourceLabel}</span><div className="pano-controls" aria-label="全景视角控制">
        <button type="button" aria-label="全景向左看" onClick={() => move({ yaw: -.18 })}><ArrowLeft size={16} /></button><button type="button" aria-label="全景向右看" onClick={() => move({ yaw: .18 })}><ArrowRight size={16} /></button><button type="button" aria-label="全景向上看" onClick={() => move({ pitch: .12 })}><ArrowUp size={16} /></button><button type="button" aria-label="全景向下看" onClick={() => move({ pitch: -.12 })}><ArrowDown size={16} /></button><i /><button type="button" aria-label="全景放大" disabled={displayPose.fov <= 35} onClick={() => move({ fov: -8 })}><Plus size={16} /></button><button type="button" aria-label="全景缩小" disabled={displayPose.fov >= 110} onClick={() => move({ fov: 8 })}><Minus size={16} /></button><button type="button" aria-label="重置全景视角" onClick={() => move(DEFAULT_PANORAMA_POSE, true)}><RotateCcw size={15} /></button>
      </div></div>
      {notice && <p className="pano-notice" role="status">{notice}</p>}
    </>}
    {status !== 'ready' && <div className="pano-message" role={status === 'error' ? 'alert' : 'status'}>{status === 'loading' ? <><LoaderCircle size={26} className="pano-spinner" /><strong>正在载入室内全景</strong><span>即将呈现照片质感的室内视角</span></> : <><strong>全景暂时无法显示</strong><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)}>重新载入全景</button></>}</div>}
  </div>;
}
