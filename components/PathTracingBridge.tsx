"use client";

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { WebGLRenderer } from 'three';
import type { WebGLPathTracer } from 'three-gpu-pathtracer';
import {snapshotScene, type SceneSnapshot} from '@/lib/pathtracing-snapshot';

export interface PathTracingBridgeProps {
  request: number;
  onProgress: (samples: number) => void;
  onComplete: (image: string) => void;
  onError: (message: string) => void;
  onBusy?: (busy: boolean) => void;
  /** Lower values are useful for verification; normal design snapshots use 64. */
  sampleTarget?: number;
  /** Output is bounded independently of the interactive canvas and device pixel ratio. */
  maxWidth?: number;
}

/** A cancellable static path-traced snapshot. Never takes over R3F's render loop or renderer. */
export default function PathTracingBridge(props: PathTracingBridgeProps) {
  const { scene, camera, gl, size } = useThree();
  const callbacks = useRef(props); callbacks.current = props;
  const dimensions = useRef(size); dimensions.current = size;
  const sampleTarget = Math.max(2, Math.min(128, Math.round(Number.isFinite(props.sampleTarget) ? props.sampleTarget! : 64)));
  const maxWidth = Math.max(512, Math.min(960, Math.round(Number.isFinite(props.maxWidth) ? props.maxWidth! : 960)));

  useEffect(() => {
    if (!Number.isFinite(props.request) || props.request <= 0) return;
    let cancelled = false, closed = false, renderer: WebGLRenderer | null = null, tracer: WebGLPathTracer | null = null, frozen: SceneSnapshot | null = null;
    let animation = 0, reportedSamples = -1, shaderFailure = false;
    const timeout = setTimeout(() => fail('光线追踪计算超时，已停止本次静帧。可降低采样或换用支持 WebGL2 的设备。'), 180000);
    const release = () => {
      if (closed) return; closed = true;
      clearTimeout(timeout); cancelAnimationFrame(animation);
      try { tracer?.dispose(); } catch { /* Context loss must still release the remaining local resources. */ }
      tracer = null;
      try { frozen?.dispose(); } catch { /* All snapshot resources belong only to this job. */ }
      frozen = null;
      try { renderer?.dispose(); renderer?.forceContextLoss(); } catch { /* Context may already have been lost. */ }
      renderer = null;
      callbacks.current.onBusy?.(false);
    };
    function fail(message: string) { if (closed || cancelled) return; release(); callbacks.current.onError(message); }
    callbacks.current.onBusy?.(true); callbacks.current.onProgress(0);
    const render = () => {
      if (cancelled || closed || !renderer || !tracer) return;
      try {
        if (renderer.getContext().isContextLost()) { fail('光追渲染上下文已中断；实时三维仍可继续使用。'); return; }
        tracer.renderSample();
        if (shaderFailure) { fail('当前显卡无法编译光追着色器，未生成光追结果。请使用支持 WebGL2 的设备。'); return; }
        const samples = Math.floor(tracer.samples);
        if (samples !== reportedSamples) { reportedSamples = samples; callbacks.current.onProgress(Math.min(sampleTarget, samples)); }
        if (samples >= sampleTarget) {
          const image = renderer.domElement.toDataURL('image/png');
          if (!image.startsWith('data:image/png;base64,') || image.length < 100) { fail('光追画布未返回有效图片，请重试。'); return; }
          release(); callbacks.current.onComplete(image); return;
        }
        animation = requestAnimationFrame(render);
      } catch { fail('本次光线追踪未能完成，未替换为普通截图。可继续实时三维设计或稍后重试。'); }
    };
    void (async () => {
      try {
        const { WebGLPathTracer: PathTracer } = await import('three-gpu-pathtracer');
        if (cancelled || closed) return;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
        if (!context || !context.getExtension('EXT_color_buffer_float')) { context?.getExtension('WEBGL_lose_context')?.loseContext(); fail('当前设备缺少 WebGL2 浮点渲染支持，无法生成真实光追静帧。实时三维与全景预览仍可使用。'); return; }
        renderer = new WebGLRenderer({ canvas, context, antialias: false, alpha: false, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1); renderer.toneMapping = gl.toneMapping; renderer.toneMappingExposure = gl.toneMappingExposure; renderer.outputColorSpace = gl.outputColorSpace;
        renderer.debug.checkShaderErrors = true; renderer.debug.onShaderError = () => { shaderFailure = true; };
        const viewport = dimensions.current, aspect = Math.max(.35, Math.min(3, viewport.width / Math.max(1, viewport.height)));
        const width = Math.min(maxWidth, Math.max(512, Math.round(viewport.width))), height = Math.round(width / aspect);
        renderer.setSize(width, height, false);
        frozen = snapshotScene(scene, camera);
        tracer = new PathTracer(renderer); tracer.bounces = 6; tracer.transmissiveBounces = 4; tracer.filterGlossyFactor = .5;
        tracer.tiles.set(2, 2); tracer.textureSize.set(512, 512); tracer.renderScale = 1;
        tracer.dynamicLowRes = false; tracer.renderDelay = 0; tracer.fadeDuration = 0; tracer.minSamples = 1;
        // No raster fallback: onComplete is possible only after the requested path-traced samples.
        tracer.rasterizeScene = false; tracer.renderToCanvas = true;
        tracer.setScene(frozen.scene, frozen.camera);
        if (!cancelled && !closed) animation = requestAnimationFrame(render);
      } catch { fail('光追初始化失败，未生成光追图片。请检查设备图形能力后重试。'); }
    })();
    return () => { cancelled = true; release(); };
  }, [props.request, sampleTarget, maxWidth, scene, camera, gl]);
  return null;
}
