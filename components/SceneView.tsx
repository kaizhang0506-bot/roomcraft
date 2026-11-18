"use client";

import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls, useProgress } from "@react-three/drei";
import { ACESFilmicToneMapping, BackSide, CanvasTexture, Euler, Object3D, PCFSoftShadowMap, PerspectiveCamera, Plane, RepeatWrapping, SRGBColorSpace, Vector3 } from "three";
import type { OrbitControls as OrbitControlsType } from "three-stdlib";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Compass, Footprints, Layers3, LogOut, MousePointer2, RotateCcw, ScanLine, Sun } from "lucide-react";
import type { MaterialDefinition, Plan } from "@/lib/plan";
import { pointInPolygon, polygonBounds, polygonContainsPolygon, roomLabelPoint, roomPolygon } from "@/lib/layout";
import { createRoomFloorGeometry, createRoomSlabGeometry, resolvePlanMaterial, wallRenderSegments } from "@/lib/room-rendering";
import { planBounds } from "@/lib/plan-bounds";
import {buildingBounds} from '@/lib/building-bounds';
import { findFreeWalkSpawn, findWalkthroughSpawn, getWalkableDoorPortals, isWalkthroughPositionFree, moveWalkthrough, WALK_EYE_HEIGHT } from "@/lib/walkthrough";
import type {FrameCamera} from '@/lib/generation-store';
import type { WalkSpawn } from "@/lib/walkthrough";
import PbrMaterial,{WhiteModel} from '@/components/PbrMaterial';
import RealisticFurniture from '@/components/RealisticFurniture';
import ReferenceFurniture from '@/components/ReferenceFurniture';
import { isReferencePlan } from '@/lib/reference-plan';
import RealisticLighting, { ContactShadowPass } from '@/components/RealisticLighting';
import PathTracingBridge from '@/components/PathTracingBridge';
import WorldEnvironment from '@/components/WorldEnvironment';
import EnvironmentPanel from '@/components/EnvironmentPanel';
import BuildingControls, {type BuildingViewMode} from '@/components/BuildingControls';
import BuildingShell from '@/components/BuildingShell';
import {FinishRails,ReferencePrint} from './InteriorFinishDetails';
import OpeningVisual from '@/components/OpeningVisual';
import SceneInteractions, {openingIsOpen} from '@/components/SceneInteractions';
import {DEFAULT_ENVIRONMENT, deriveEnvironment, localEnvironmentDate, type EnvironmentSettings, type EnvironmentState, type ProjectEnvironment} from '@/lib/environment';

export interface SceneViewProps {
  presentation?:'draft'|'finished';
  onPanoramaFrame?:(image:string)=>void;
  onCaptureReady?:(ready:boolean)=>void;
  tourStart?:WalkSpawn;
  onTourExit?:()=>void;
  plan: Plan;
  onPlanChange?: (plan: Plan) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  visibleLayers: string[];
  onReferenceReady?: (image: string,camera:FrameCamera) => void;
  onNewEraRender?: (camera: {x:number;y:number;z:number;look_at:[number,number,number];fov:number},renderPlan?:Plan) => void;
  newEraRendering?: boolean;
  onEditOpenings?: () => void;
  onEnvironmentChange?: (environment: ProjectEnvironment) => void;
  onFloorChange?: (floor: number) => void;
  onFloorCountChange?: (count: number) => void;
  onFloorHeightChange?: (height: number) => void;
}

const colors: Record<string, string> = { power: "#cc6b53", lighting: "#c09d48", coldWater: "#508eaa", hotWater: "#c56973", drain: "#747e88" };
const nodeLayer = (kind: string) => kind === "water" ? "coldWater" : kind === "drain" ? "drain" : kind === "light" ? "lighting" : "power";

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <SceneFallback message="三维视图初始化失败，请刷新页面或启用浏览器硬件加速。二维编辑与项目保存仍然可用。" />;
    return this.props.children;
  }
}

function SceneFallback({ message }: { message: string }) {
  return <div style={{ height: "100%", minHeight: 420, display: "grid", placeItems: "center", background: "#f0efe8", padding: 32 }}><div style={{ maxWidth: 330, textAlign: "center", color: "#777165", fontSize: 13, lineHeight: 1.8 }}><Layers3 size={30} style={{ margin: "0 auto 14px", color: "#aaa08c" }} /><strong style={{ display: "block", color: "#4c493f", marginBottom: 7 }}>需要支持 WebGL 的浏览器</strong>{message}</div></div>;
}

function CaptureBridge({ capture, cameraSnapshot, onReferenceReady, download,onReady }: { onReady?:(ready:boolean)=>void;capture: { current: (() => void) | null }; cameraSnapshot:{current:(()=>{x:number;y:number;z:number;look_at:[number,number,number];fov:number})|null}; onReferenceReady?: (image: string,camera:FrameCamera) => void; download: boolean }) {
  const { gl, scene, camera } = useThree();
  useEffect(()=>{onReady?.(true);return ()=>onReady?.(false);},[onReady]);
  useEffect(() => {
    capture.current = () => {
      gl.render(scene, camera);
      const url = gl.domElement.toDataURL("image/png");
      if (download || !onReferenceReady) {
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "roomcraft-3d-reference.png"; anchor.click();
      } else {const d=camera.getWorldDirection(new Vector3());onReferenceReady(url,{x:camera.position.x,y:camera.position.y,z:camera.position.z,dx:d.x,dy:d.y,dz:d.z});}
    };
    // New Era expects a horizontal FOV. Its "good" still is 1280x800;
    // preserve the viewport's vertical framing at that output aspect ratio.
    cameraSnapshot.current=()=>{const dir=camera.getWorldDirection(new Vector3());const p=camera.position;const vertical=camera instanceof PerspectiveCamera?camera.fov:50;const horizontal=2*Math.atan(Math.tan(vertical*Math.PI/360)*1.6)*180/Math.PI;return{x:p.x,y:p.z,z:p.y,look_at:[p.x+dir.x*3,p.z+dir.z*3,p.y+dir.y*3],fov:horizontal};};
    return () => { capture.current = null;cameraSnapshot.current=null; };
  }, [gl, scene, camera, capture, cameraSnapshot, onReferenceReady, download]);
  return null;
}

type WalkDirection = "forward" | "backward" | "left" | "right";
interface WalkPosition { x: number; y: number; yaw: number }
interface WalkControllerProps {
  passThrough:boolean;
  plan: Plan;
  spawn: WalkSpawn;
  directions: { current: Set<WalkDirection> };
  lock: { current: (() => void) | null };
  onExit: () => void;
  onPosition: (position: WalkPosition) => void;
  onLockChange: (locked: boolean) => void;
  onNotice: (message: string) => void;
}

/** Camera motion is applied every frame; the HUD reports its actual world coordinates. */
function WalkthroughController({ passThrough, plan, spawn, directions, lock, onExit, onPosition, onLockChange, onNotice }: WalkControllerProps) {
  const { camera, gl } = useThree();
  const planRef = useRef(plan);
  planRef.current = plan;
  const keys = useRef(new Set<string>());
  const angles = useRef({ yaw: spawn.yaw, pitch: spawn.pitch??0 });
  const reportClock = useRef(0);
  const lastReportedPosition = useRef<WalkPosition | null>(null);

  useEffect(() => {
    const canvas = gl.domElement;
    const previous = {
      position: camera.position.clone(), quaternion: camera.quaternion.clone(),
      fov: camera instanceof PerspectiveCamera ? camera.fov : undefined,
      near: camera.near, cursor: canvas.style.cursor, touchAction: canvas.style.touchAction,
      tabIndex: canvas.tabIndex,
    };
    let dragging: { pointerId: number; x: number; y: number } | null = null;
    let wasLocked = false;
    const clearMovement = () => {
      keys.current.clear(); directions.current.clear();
      if (dragging && canvas.hasPointerCapture(dragging.pointerId)) canvas.releasePointerCapture(dragging.pointerId);
      dragging = null;
      if (document.pointerLockElement !== canvas) canvas.style.cursor = "grab";
    };
    const look = (dx: number, dy: number) => {
      angles.current.yaw -= dx * .003;
      angles.current.pitch = Math.max(-Math.PI / 2 + .09, Math.min(Math.PI / 2 - .09, angles.current.pitch - dy * .003));
    };
    const keyboard = (event: KeyboardEvent, pressed: boolean) => {
      if (pressed && event.code === "Escape") { event.preventDefault(); onExit(); return; }
      const target = event.target as HTMLElement | null;
      if (pressed && target?.closest("input,textarea,select,[contenteditable=true]")) return;
      if (!["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(event.code)) return;
      event.preventDefault();
      if (pressed) keys.current.add(event.code); else keys.current.delete(event.code);
    };
    const keydown = (event: KeyboardEvent) => keyboard(event, true);
    const keyup = (event: KeyboardEvent) => keyboard(event, false);
    const focusin = (event: FocusEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input,textarea,select,[contenteditable=true]")) clearMovement();
    };
    const visibility = () => { if (document.hidden) clearMovement(); };
    const pointerdown = (event: PointerEvent) => {
      if (document.pointerLockElement === canvas || event.button !== 0) return;
      dragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
      canvas.style.cursor = "grabbing";
    };
    const pointermove = (event: PointerEvent) => {
      if (document.pointerLockElement === canvas || dragging?.pointerId !== event.pointerId) return;
      look(event.clientX - dragging.x, event.clientY - dragging.y);
      dragging.x = event.clientX; dragging.y = event.clientY;
    };
    const pointerup = (event: PointerEvent) => {
      if (dragging?.pointerId !== event.pointerId) return;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      dragging = null; canvas.style.cursor = "grab";
    };
    const mousemove = (event: MouseEvent) => { if (document.pointerLockElement === canvas) look(event.movementX, event.movementY); };
    const lockchange = () => {
      const locked = document.pointerLockElement === canvas;
      dragging = null; onLockChange(locked);
      // Some browsers consume Escape while unlocking and omit the key event.
      if (wasLocked && !locked) onExit();
      wasLocked = locked;
    };
    const lockerror = () => onNotice("鼠标锁定不可用，可以按住画布拖动看向。");
    lock.current = () => {
      if (!canvas.requestPointerLock) { lockerror(); return; }
      try { const result = canvas.requestPointerLock(); result?.catch(lockerror); } catch { lockerror(); }
    };
    camera.position.set(spawn.position.x, WALK_EYE_HEIGHT, spawn.position.y);
    angles.current = { yaw: spawn.yaw, pitch: spawn.pitch??0 };
    camera.quaternion.setFromEuler(new Euler(spawn.pitch??0, spawn.yaw, 0, "YXZ"));
    camera.near = .05;
    if (camera instanceof PerspectiveCamera) { camera.fov = 65; camera.updateProjectionMatrix(); }
    canvas.tabIndex = 0; canvas.style.cursor = "grab"; canvas.style.touchAction = "none";
    canvas.focus({ preventScroll: true });
    onPosition({ x: camera.position.x, y: camera.position.z, yaw: spawn.yaw });
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", clearMovement);
    document.addEventListener("focusin", focusin);
    document.addEventListener("visibilitychange", visibility);
    canvas.addEventListener("pointerdown", pointerdown);
    canvas.addEventListener("pointermove", pointermove);
    canvas.addEventListener("pointerup", pointerup);
    canvas.addEventListener("pointercancel", pointerup);
    document.addEventListener("mousemove", mousemove);
    document.addEventListener("pointerlockchange", lockchange);
    document.addEventListener("pointerlockerror", lockerror);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", clearMovement);
      document.removeEventListener("focusin", focusin);
      document.removeEventListener("visibilitychange", visibility);
      canvas.removeEventListener("pointerdown", pointerdown);
      canvas.removeEventListener("pointermove", pointermove);
      canvas.removeEventListener("pointerup", pointerup);
      canvas.removeEventListener("pointercancel", pointerup);
      document.removeEventListener("mousemove", mousemove);
      document.removeEventListener("pointerlockchange", lockchange);
      document.removeEventListener("pointerlockerror", lockerror);
      if (dragging && canvas.hasPointerCapture(dragging.pointerId)) canvas.releasePointerCapture(dragging.pointerId);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      clearMovement(); lock.current = null;
      camera.position.copy(previous.position); camera.quaternion.copy(previous.quaternion); camera.near = previous.near;
      if (camera instanceof PerspectiveCamera && previous.fov !== undefined) { camera.fov = previous.fov; camera.updateProjectionMatrix(); }
      canvas.style.cursor = previous.cursor; canvas.style.touchAction = previous.touchAction; canvas.tabIndex = previous.tabIndex;
    };
  }, [camera, gl, spawn, directions, lock, onExit, onPosition, onLockChange, onNotice]);

  useEffect(() => {
    if (passThrough || isWalkthroughPositionFree(plan, { x: camera.position.x, y: camera.position.z })) return;
    const next = findWalkthroughSpawn(plan, spawn.roomId);
    if (!next) { onNotice("当前户型没有足够的可站立空间，请先调整墙体或家具。"); onExit(); return; }
    camera.position.set(next.position.x, WALK_EYE_HEIGHT, next.position.y);
  }, [passThrough, plan, camera, spawn.roomId, onExit, onNotice]);

  useFrame((_, delta) => {
    const active = keys.current, touch = directions.current;
    const forward = Number(active.has("KeyW") || active.has("ArrowUp") || touch.has("forward")) - Number(active.has("KeyS") || active.has("ArrowDown") || touch.has("backward"));
    const side = Number(active.has("KeyD") || active.has("ArrowRight") || touch.has("right")) - Number(active.has("KeyA") || active.has("ArrowLeft") || touch.has("left"));
    const length = Math.hypot(forward, side);
    if (length > 0) {
      const speed = (active.has("ShiftLeft") || active.has("ShiftRight") ? 2.8 : 1.65) * Math.min(delta, .05) / length;
      const yaw = angles.current.yaw;
      const deltaXZ = {
        x: (side * Math.cos(yaw) - forward * Math.sin(yaw)) * speed,
        y: (-side * Math.sin(yaw) - forward * Math.cos(yaw)) * speed,
      };
      const moved=passThrough?{x:camera.position.x+deltaXZ.x,y:camera.position.z+deltaXZ.y}:moveWalkthrough(planRef.current,{x:camera.position.x,y:camera.position.z},deltaXZ);
      camera.position.set(moved.x, WALK_EYE_HEIGHT, moved.y);
    }
    camera.quaternion.setFromEuler(new Euler(angles.current.pitch, angles.current.yaw, 0, "YXZ"));
    reportClock.current += delta;
    if (reportClock.current > .2) {
      reportClock.current = 0;
      const current = { x: camera.position.x, y: camera.position.z, yaw: angles.current.yaw };
      const previous = lastReportedPosition.current;
      if (!previous || Math.hypot(current.x - previous.x, current.y - previous.y) > .01 || Math.abs(current.yaw - previous.yaw) > .01) {
        lastReportedPosition.current = current;
        onPosition(current);
      }
    }
  });
  return null;
}

function Box({ position, size, color, selected = false, opacity = 1, roughness = .82, material }: { position: [number, number, number]; size: [number, number, number]; color: string; selected?: boolean; opacity?: number; roughness?: number; material?:MaterialDefinition }) {
  if (size.some(n => n <= .001)) return null;
  return <mesh position={position} castShadow={opacity >= 1} receiveShadow>
    <boxGeometry args={size} />
    {opacity<1?<meshPhysicalMaterial color={color} roughness={.08} metalness={0} transparent opacity={opacity} transmission={.45} thickness={.025} depthWrite={false}/>:<PbrMaterial material={material??{id:'wood-oak',name:'实木',category:'furniture',color,roughness,pattern:'wood'}} kind={material?.category==='wall'?'wall':'wood'} repeat={[Math.max(.1,size[0]/2),Math.max(.1,size[1]/2)]} selected={selected}/>}
  </mesh>;
}

function WallMesh({ wall, openings, cutaway, sectionHeight, selected, onSelect, material, onOpeningToggle }: { wall: Plan["walls"][number]; openings: Plan["openings"]; cutaway: boolean; sectionHeight?: number; selected: boolean; onSelect: () => void; material: MaterialDefinition; onOpeningToggle?:(id:string)=>void }) {
  const dx = wall.end.x - wall.start.x, dz = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dz), angle = -Math.atan2(dz, dx);
  const height = sectionHeight === undefined ? wall.height : Math.min(wall.height, sectionHeight);
  const { parts, holes } = sectionHeight === undefined
    ? wallRenderSegments(wall, openings, cutaway)
    : wallRenderSegments({...wall, height}, openings.filter(opening => opening.sill < height), false);
  if (length < .01) return null;
  return <group position={[wall.start.x, 0, wall.start.y]} rotation={[0, angle, 0]} onClick={event => { event.stopPropagation(); onSelect(); }}>
    {parts.map((part, index) => <Box key={index} position={[(part.start + part.end) / 2, (part.bottom + part.top) / 2, 0]} size={[part.end - part.start, part.top - part.bottom, wall.thickness]} material={material} color={material.color} roughness={material.roughness} selected={selected} />)}
    {sectionHeight !== undefined && parts.filter(part => part.top === height).map(part =>
      <mesh key={`cap-${part.start}`} position={[(part.start + part.end) / 2, height + .005, 0]} receiveShadow>
        <boxGeometry args={[part.end - part.start, .01, wall.thickness]} />
        <meshStandardMaterial color={material.color} roughness={.96} />
      </mesh>)}
    {holes.map(opening => <OpeningVisual key={opening.id} opening={opening} wallThickness={wall.thickness} center={(opening.a+opening.b)/2} bottom={opening.renderBottom} height={opening.renderHeight} width={opening.b-opening.a} onToggle={onOpeningToggle?()=>onOpeningToggle(opening.id):undefined}/>)}
  </group>;
}

function FurnitureMesh({ item, selected, onSelect, material }: { item: Plan["furniture"][number]; selected: boolean; onSelect: () => void; material: MaterialDefinition }) {
  const w = item.width, d = item.depth, h = Math.max(.12, item.height);
  const wood = ['sofa', 'bed', 'chair'].includes(item.kind) ? "#b79b76" : material.color, fabric = material.color, light = "#eee7d8";
  const common = { selected, roughness: material.roughness };
  return <group position={[item.x, 0, item.y]} rotation={[0, -(item.rotation ?? 0) * Math.PI / 180, 0]} onClick={event => { event.stopPropagation(); onSelect(); }}>
    {item.kind === "sofa" ? <>
      <Box {...common} position={[0, .18, 0]} size={[w, .24, d]} color="#ae977b" />
      <Box {...common} position={[0, .36, 0]} size={[w - .08, .2, d - .08]} color={fabric} />
      <Box {...common} position={[0, h * .65, -d / 2 + .12]} size={[w, Math.max(.2, h * .65), .24]} color={fabric} />
      {[-1, 1].map(side => <Box key={side} {...common} position={[side * (w / 2 - .1), h * .42, 0]} size={[.2, h * .6, d]} color={fabric} />)}
      {[-1, 0, 1].map(side => <Box key={side} {...common} position={[side * (w - .45) / 3, .51, .06]} size={[(w - .5) / 3 - .035, .14, d * .65]} color={side === 1 ? "#c3b49a" : light} />)}
    </> : item.kind === "bed" ? <>
      <Box {...common} position={[0, .18, 0]} size={[w, .28, d]} color={wood} />
      <Box {...common} position={[0, .43, 0]} size={[w - .05, .22, d - .04]} color="#f5f0e5" />
      <Box {...common} position={[0, .55, d * .15]} size={[w - .03, .09, d * .65]} color={material.color} />
      <Box {...common} position={[0, h * .65, -d / 2 + .04]} size={[w + .08, Math.max(.6, h * 1.1), .12]} color="#b9a488" />
      {[-1, 1].map(side => <Box key={side} {...common} position={[side * w * .23, .6, -d * .32]} size={[w * .38, .13, d * .22]} color="#f7f3e9" />)}
    </> : item.kind === "table" ? <>
      <Box {...common} position={[0, h - .045, 0]} size={[w, .09, d]} color={material.color} />
      {[-1, 1].flatMap(x => [-1, 1].map(z => <Box key={`${x}-${z}`} position={[x * w * .36, (h - .09) / 2, z * d * .32]} size={[.06, h - .09, .06]} color="#9f8869" />))}
      <mesh position={[w * .18, h + .04, 0]} castShadow><cylinderGeometry args={[.1, .1, .07, 20]} /><meshStandardMaterial color="#eee9dd" roughness={.65} /></mesh>
      <Box position={[-w * .2, h + .03, d * .08]} size={[.23, .04, .17]} color="#8b967f" />
    </> : item.kind === "cabinet" ? <>
      <Box {...common} position={[0, h / 2, 0]} size={[w, h, d]} color={material.color} />
      {[-1, 1].map(side => <Box key={side} {...common} position={[side * w * .25, h / 2, d / 2 + .008]} size={[w / 2 - .015, h - .06, .025]} color={material.color} />)}
      {[-1, 1].map(side => <Box key={`handle-${side}`} position={[side * .055, h * .6, d / 2 + .035]} size={[.012, .12, .02]} color="#7b7465" />)}
    </> : item.kind === "chair" ? <>
      <Box {...common} position={[0, .42, 0]} size={[w, .1, d]} color={fabric} />
      <Box {...common} position={[0, h * .76, -d / 2 + .04]} size={[w, Math.max(.25, h * .5), .09]} color={fabric} />
      {[-1, 1].flatMap(x => [-1, 1].map(z => <Box key={`${x}-${z}`} position={[x * w * .35, .2, z * d * .35]} size={[.04, .4, .04]} color={wood} />))}
    </> : <>
      <mesh position={[0, h * .16, 0]} castShadow receiveShadow><cylinderGeometry args={[w * .33, w * .24, h * .32, 20]} /><meshStandardMaterial color={material.color} roughness={material.roughness} /></mesh>
      <Box position={[0, h * .48, 0]} size={[.025, h * .6, .025]} color="#7b8767" />
      {[[0, .78, 0], [-.18, .6, .04], [.17, .65, -.05], [.03, .52, .16]].map(([x, y, z], i) => <mesh key={i} position={[x * w, h * y, z * d]} scale={[w * .3, h * .22, d * .3]} castShadow><sphereGeometry args={[1, 12, 10]} /><meshStandardMaterial color={i % 2 ? "#879b73" : "#a0ad88"} roughness={1} /></mesh>)}
    </>}
    {selected && <Line points={[[-w / 2 - .06, .025, -d / 2 - .06], [w / 2 + .06, .025, -d / 2 - .06], [w / 2 + .06, .025, d / 2 + .06], [-w / 2 - .06, .025, d / 2 + .06], [-w / 2 - .06, .025, -d / 2 - .06]]} color="#bc654c" lineWidth={2} />}
  </group>;
}

function RouteMesh({ route, selected, onSelect }: { route: Plan["routes"][number]; selected: boolean; onSelect: () => void }) {
  const points = route.points.map(p => [p.x, Math.max(.07, route.height), p.y] as [number, number, number]);
  if (points.length < 2) return null;
  const color = colors[route.kind] ?? "#777";
  return <group onClick={event => { event.stopPropagation(); onSelect(); }}>
    <Line points={points} color={color} lineWidth={selected ? 6 : 3.5} dashed={route.kind === "lighting"} dashSize={.14} gapSize={.08} />
    {points.map((p, i) => <mesh key={i} position={p}><sphereGeometry args={[selected ? .055 : .035, 8, 8]} /><meshStandardMaterial color={color} roughness={.6} /></mesh>)}
  </group>;
}

/** All surface patterns are generated here, with no external texture assets. */
function createSurfaceTexture(pattern: MaterialDefinition['pattern']): CanvasTexture | null {
  if (pattern === 'solid' || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 256, 256);
  if (pattern === 'wood') {
    for (let plank = 0; plank < 4; plank++) {
      context.fillStyle = `rgba(94,75,50,${.025 + plank % 2 * .035})`;
      context.fillRect(plank * 64, 0, 64, 256);
      context.strokeStyle = 'rgba(74,55,35,.19)'; context.lineWidth = 1;
      context.beginPath(); context.moveTo(plank * 64, 0); context.lineTo(plank * 64, 256);
      const joint = (plank % 2 ? .68 : .18) * 256;
      context.moveTo(plank * 64, joint); context.lineTo(plank * 64 + 64, joint); context.stroke();
      for (let grain = 1; grain < 9; grain++) {
        context.strokeStyle = 'rgba(91,68,44,.045)'; context.beginPath();
        for (let y = 0; y <= 256; y += 8) {
          const x = plank * 64 + grain * 7 + Math.sin(y / 47 + grain) * 1.6;
          if (!y) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.stroke();
      }
    }
  } else if (pattern === 'tile') {
    context.fillStyle = 'rgba(86,83,74,.21)'; context.fillRect(0, 0, 2, 256); context.fillRect(0, 0, 256, 2);
  } else {
    for (let i = 0; i < 1700; i++) {
      const x = (i * 137.31) % 256, y = (i * i * .618) % 256;
      context.fillStyle = `rgba(78,71,62,${pattern === 'carpet' ? .08 : .025})`; context.fillRect(x, y, 1.5, 1.5);
    }
    if (pattern === 'stone') for (let i = 0; i < 4; i++) {
      context.strokeStyle = 'rgba(116,111,103,.12)'; context.lineWidth = 1.5; context.beginPath();
      context.moveTo(i * 80 - 30, 0); context.bezierCurveTo(i * 80 + 120, 95, i * 80 - 60, 140, i * 80 + 30, 256); context.stroke();
    }
  }
  const texture = new CanvasTexture(canvas); texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace; texture.repeat.set(pattern === 'tile' ? 1 / .6 : 1 / .88, pattern === 'wood' ? 1 / 2.4 : 1 / .6);
  texture.anisotropy = 4;
  return texture;
}

function LimestoneFloor({material, selected}: {material: MaterialDefinition; selected: boolean}) {
  const tile = useMemo(() => createSurfaceTexture('tile'), []);
  useEffect(() => () => tile?.dispose(), [tile]);
  return <meshStandardMaterial color={material.color} map={tile} roughness={material.roughness} emissive={selected?'#8b552b':'#000'} emissiveIntensity={.08}/>;
}

function RoomSurface({ room, material, ceilingHeight, showCeiling, selected, onSelect, floorOffset = .008 }: { room: Plan['rooms'][number]; material: MaterialDefinition; ceilingHeight: number; showCeiling: boolean; selected: boolean; onSelect: () => void; floorOffset?: number }) {
  const floor = useMemo(() => createRoomFloorGeometry(room), [room]);
  const slab = useMemo(() => createRoomSlabGeometry(room), [room]);
  useEffect(() => () => { floor.dispose(); slab.dispose(); }, [floor, slab]);
  return <group>
    <mesh geometry={slab} receiveShadow><meshStandardMaterial color="#c8c0af" roughness={1} /></mesh>
    <mesh name={`floor-${room.id}`} userData={{ roomId: room.id, materialId: material.id }} geometry={floor} position={[0, floorOffset, 0]} receiveShadow onClick={event => { event.stopPropagation(); onSelect(); }}>
      {material.id === 'ref-limestone' && material.pattern === 'tile' ? <LimestoneFloor material={material} selected={selected}/> : <PbrMaterial material={material} repeat={[.5,.5]} selected={selected}/>}
    </mesh>
    {/* Back faces show the ceiling from inside; it stays invisible from above. */}
    {showCeiling && <mesh castShadow receiveShadow name={`ceiling-${room.id}`} geometry={floor} position={[0, ceilingHeight, 0]}><PbrMaterial material={{id:'ceiling-plaster',name:'细砂乳胶漆',category:'wall',color:'#f3efe7',roughness:.95,pattern:'solid'}} repeat={[.5,.5]} side={BackSide}/></mesh>}
  </group>;
}

function Floors({ plan, showCeiling, selectedId, onSelect }: { plan: Plan; showCeiling: boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  const rooms: Plan['rooms'] = plan.rooms.length ? plan.rooms : [{ id: 'unassigned-floor', name: '未分区', ...planBounds(plan) }];
  const thresholds = useMemo(() => getWalkableDoorPortals(plan).map(portal => {
    const adjacent = plan.rooms.find(room => portal.polygon.some(point => pointInPolygon(point, roomPolygon(room)))) ?? plan.rooms[0];
    return { room: { id: `threshold-${portal.id}`, name: '门槛', polygon: portal.polygon, ...polygonBounds(portal.polygon) }, adjacent };
  }), [plan]);
  return <group>
    {rooms.map(room => <RoomSurface key={room.id} room={room} material={resolvePlanMaterial(plan, room.floorMaterialId, /卫|厨|阳台/.test(room.name) ? 'tile-warm' : 'oak-natural')} ceilingHeight={plan.ceilingHeight ?? 2.8} showCeiling={showCeiling && Boolean(plan.rooms.length)} selected={selectedId === room.id} onSelect={() => { if (plan.rooms.length) onSelect(room.id); }} />)}
    {thresholds.map(({ room, adjacent }) => <RoomSurface key={room.id} room={room} floorOffset={.006} material={resolvePlanMaterial(plan, adjacent?.floorMaterialId)} ceilingHeight={0} showCeiling={false} selected={false} onSelect={() => { if (adjacent) onSelect(adjacent.id); }} />)}
  </group>;
}

type SceneViewMode = 'bird' | 'oblique' | 'top';
interface ViewRequest { mode: SceneViewMode; roomId?: string; revision: number }
interface CameraPose { x: number; y: number; z: number; targetX: number; targetY: number; targetZ: number }

function frameReferenceCamera(camera: PerspectiveCamera, bounds: ReturnType<typeof planBounds>, target: Vector3, height: number, mode: SceneViewMode) {
  const elevation = (mode === 'oblique' ? 52 : mode === 'bird' ? 70 : 89.99) * Math.PI / 180;
  const sin = Math.sin(elevation), cos = Math.cos(elevation);
  const verticalTangent = Math.tan(camera.fov * Math.PI / 360);
  const horizontalTangent = verticalTangent * camera.aspect;
  let distance = 2;
  for (const edge of [bounds.y, bounds.y + bounds.depth]) {
    for (const elevationY of [-.2, height]) {
      const z = edge - target.z, y = elevationY - target.y;
      const towardsCamera = z * cos + y * sin;
      const screenY = y * cos - z * sin;
      distance = Math.max(distance,
        towardsCamera + bounds.width / (2 * horizontalTangent * .91),
        towardsCamera + Math.abs(screenY) / (verticalTangent * .77));
    }
  }
  camera.position.set(target.x, target.y + distance * sin, target.z + distance * cos);
}

function referenceSectionHeight(wall: Plan['walls'][number], bounds: ReturnType<typeof planBounds>) {
  const near = (a: number, b: number) => Math.abs(a - b) <= wall.thickness + .02;
  const onX = (x: number) => near(wall.start.x, x) && near(wall.end.x, x);
  const onZ = (z: number) => near(wall.start.y, z) && near(wall.end.y, z);
  if (onZ(bounds.y + bounds.depth)) return .98;
  if (onZ(bounds.y) || onX(bounds.x) || onX(bounds.x + bounds.width)) return wall.height;
  if (near(wall.start.y, wall.end.y)) return 1.2;
  return 1.57;
}

function createContactTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const dx = Math.max(0, Math.abs((x + .5) / 64 - 1) - .64);
      const dy = Math.max(0, Math.abs((y + .5) / 64 - 1) - .64);
      const offset = (y * 128 + x) * 4;
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 255;
      image.data[offset + 3] = Math.round(255 * Math.exp(-44 * (dx * dx + dy * dy)));
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function ContactPatch({texture, x, y, z, width, depth, rotation = 0, opacity}: {
  texture: CanvasTexture; x: number; y: number; z: number; width: number; depth: number; rotation?: number; opacity: number;
}) {
  return <group position={[x, y, z]} rotation={[0, -rotation * Math.PI / 180, 0]}>
    <mesh name="studio-contact-shadow" rotation={[-Math.PI/2, 0, 0]} raycast={() => {}}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial map={texture} color="#483629" opacity={opacity} transparent depthWrite={false} toneMapped={false}/>
    </mesh>
  </group>;
}

function SceneContents({ onCaptureReady,presentation,plan, onPlanChange, selectedId, onSelect, visibleLayers, cutaway, resetKey, capture, cameraSnapshot, onReferenceReady, walk, viewRequest, showCeiling, onCameraPose, hour, north, quality, environment, environmentState, buildingMode, onBuildingFloorSelect, onOpeningToggle, onRoomLightToggle }: SceneViewProps & { cutaway: boolean; resetKey: number; capture: { current: (() => void) | null }; cameraSnapshot:{current:(()=>{x:number;y:number;z:number;look_at:[number,number,number];fov:number})|null}; walk: (Omit<WalkControllerProps, 'plan'> & { active: boolean }) | null; viewRequest: ViewRequest; showCeiling: boolean; onCameraPose: (pose: CameraPose) => void; hour:number; north:number; quality:'balanced'|'high'; environment:EnvironmentSettings; environmentState:EnvironmentState; buildingMode:BuildingViewMode; onBuildingFloorSelect:(floor:number)=>void; onOpeningToggle?:(id:string)=>void; onRoomLightToggle?:(roomId:string)=>void }) {
  const { camera, size } = useThree();
  const reference = isReferencePlan(plan);
  const referenceAspect = reference ? size.width / Math.max(1, size.height) : null;
  const draft=presentation==='draft';
  const studio = !draft && reference && !environment.enabled;
  const contactTexture = useMemo(() => studio ? createContactTexture() : null, [studio]);
  useEffect(() => () => contactTexture?.dispose(), [contactTexture]);
  const extent = planBounds(plan);
  const activeFloor=plan.building?.activeFloor??1,totalFloors=plan.building?.totalFloors??1,floorHeight=plan.building?.floorHeight??3.2;
  const groundElevation=-(activeFloor-1)*floorHeight;
  const orbit = useRef<OrbitControlsType | null>(null);
  const drag = useRef<{id:string;floor:number;pointerId:number;dx:number;dy:number;startX:number;startY:number;x:number;y:number;object:Object3D}|null>(null);
  const floorPlane=useMemo(()=>new Plane(new Vector3(0,1,0),0),[]);
  const finishDrag=useCallback((commit:boolean)=>{
    const current=drag.current;drag.current=null;
    if(current)current.object.position.set(0,0,0);
    if(orbit.current)orbit.current.enabled=true;
    if(commit&&current&&current.floor===activeFloor&&onPlanChange&&Math.hypot(current.x-current.startX,current.y-current.startY)>.005){
      onPlanChange({...plan,furniture:plan.furniture.map(item=>item.id===current.id?{...item,x:current.x,y:current.y}:item),verified:false});
    }
  },[onPlanChange,plan,activeFloor]);
  useEffect(()=>{if(drag.current&&drag.current.floor!==activeFloor)finishDrag(false);},[activeFloor,finishDrag]);
  useEffect(()=>{const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape'&&drag.current){event.preventDefault();finishDrag(false);}};window.addEventListener('keydown',cancel);const blur=()=>{if(drag.current)finishDrag(false);};window.addEventListener('blur',blur);return()=>{window.removeEventListener('keydown',cancel);window.removeEventListener('blur',blur);};},[finishDrag]);
  function startDrag(event:ThreeEvent<PointerEvent>,item:Plan['furniture'][number]){
    if(presentation==='finished'||walking||!onPlanChange||event.button!==0)return;
    const hit=event.ray.intersectPlane(floorPlane,new Vector3());if(!hit)return;
    event.stopPropagation();onSelect(item.id);drag.current={id:item.id,floor:activeFloor,pointerId:event.pointerId,dx:hit.x-item.x,dy:hit.z-item.y,startX:item.x,startY:item.y,x:item.x,y:item.y,object:event.eventObject};
    if(orbit.current)orbit.current.enabled=false;
    (event.target as unknown as {setPointerCapture:(id:number)=>void}).setPointerCapture(event.pointerId);
  }
  function moveDrag(event:ThreeEvent<PointerEvent>){
    const current=drag.current;if(!current||event.pointerId!==current.pointerId)return;
    event.stopPropagation();const hit=event.ray.intersectPlane(floorPlane,new Vector3());if(!hit)return;
    const item=plan.furniture.find(f=>f.id===current.id);if(!item)return;
    const x=Math.round((hit.x-current.dx)*20)/20,y=Math.round((hit.z-current.dy)*20)/20;
    const angle=item.rotation*Math.PI/180;
    const footprint=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>({x:x+a*item.width/2*Math.cos(angle)-b*item.depth/2*Math.sin(angle),y:y+a*item.width/2*Math.sin(angle)+b*item.depth/2*Math.cos(angle)}));
    const bounds=planBounds(plan);const allowed=plan.rooms.length?plan.rooms.some(room=>polygonContainsPolygon(roomPolygon(room),footprint)):footprint.every(p=>p.x>=bounds.x&&p.x<=bounds.x+bounds.width&&p.y>=bounds.y&&p.y<=bounds.y+bounds.depth);
    if(!allowed)return;
    current.x=x;current.y=y;current.object.position.set(x-current.startX,0,y-current.startY);
  }
  function endDrag(event:ThreeEvent<PointerEvent>,commit:boolean){
    if(!drag.current||event.pointerId!==drag.current.pointerId)return;
    event.stopPropagation();const target=event.target as unknown as {hasPointerCapture:(id:number)=>boolean;releasePointerCapture:(id:number)=>void};if(target.hasPointerCapture(event.pointerId))target.releasePointerCapture(event.pointerId);finishDrag(commit);
  }
  const orbitTarget = useRef(new Vector3(extent.x + extent.width / 2, .4, extent.y + extent.depth / 2));
  const walking = Boolean(walk?.active);
  const reportTime = useRef(0);
  const lastCameraPose = useRef<CameraPose | null>(null);
  useFrame((_, delta) => {
    reportTime.current += delta;
    if (reportTime.current < .3) return;
    reportTime.current = 0;
    const target = walking ? camera.position.clone().add(camera.getWorldDirection(new Vector3())) : orbit.current?.target ?? orbitTarget.current;
    const next={ x: camera.position.x, y: camera.position.y, z: camera.position.z, targetX: target.x, targetY: target.y, targetZ: target.z };
    const last=lastCameraPose.current;
    if(!last || Math.hypot(next.x-last.x,next.y-last.y,next.z-last.z)>.005 || Math.hypot(next.targetX-last.targetX,next.targetY-last.targetY,next.targetZ-last.targetZ)>.005){lastCameraPose.current=next;onCameraPose(next);}
  });
  useEffect(() => {
    // Entering/exiting walk mode must preserve the existing orbit camera pose.
    if (walking) return;
    const room = buildingMode==='building' ? undefined : plan.rooms.find(item => item.id === viewRequest.roomId);
    const bounds = buildingMode==='building'?buildingBounds(plan):room ? polygonBounds(roomPolygon(room)) : extent;
    const center = room ? roomLabelPoint(room) : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.depth / 2 };
    const useReferenceCamera = reference && buildingMode !== 'building' && !room && camera instanceof PerspectiveCamera;
    const modelHeight = plan.ceilingHeight ?? 2.8;
    const targetY=buildingMode==='building'?groundElevation+totalFloors*floorHeight/2:useReferenceCamera?modelHeight*.4:.25;
    if (useReferenceCamera && viewRequest.mode !== 'top') center.y += bounds.depth * .035;
    const max = Math.max(2, bounds.width, bounds.depth, buildingMode==='building'?totalFloors*floorHeight:0);
    const fit = camera instanceof PerspectiveCamera ? Math.max(1, 1 / camera.aspect) : 1;
    if (useReferenceCamera) frameReferenceCamera(camera, bounds, new Vector3(center.x, targetY, center.y), modelHeight, viewRequest.mode);
    else if (viewRequest.mode === 'top') camera.position.set(center.x, targetY + max * 1.9 * fit, center.y + .001);
    else if (viewRequest.mode === 'bird') camera.position.set(center.x + max * .4 * fit, targetY + max * 1.9 * fit, center.y + max * .57 * fit);
    else camera.position.set(center.x + max * .95 * fit, targetY + max * fit, center.y + max * .95 * fit);
    camera.lookAt(center.x, targetY, center.y);
    orbitTarget.current.set(center.x, targetY, center.y);
    orbit.current?.target.copy(orbitTarget.current);
    orbit.current?.update();
    // The request is explicit: editing a material or furniture must keep this pose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extent.x, extent.y, extent.width, extent.depth, resetKey, viewRequest, camera, buildingMode, activeFloor, totalFloors, floorHeight, reference, referenceAspect]);
  const select = (id: string) => { if (!walking) onSelect(id); };
  return <>
    {(draft||(!environment.enabled&&!walking)) && <><color attach="background" args={[studio ? "#fff" : "#eeede5"]} /><mesh name="presentation-ground" rotation={[-Math.PI / 2, 0, 0]} position={[extent.x + extent.width / 2, groundElevation-(studio ? .202 : .24), extent.y + extent.depth / 2]} receiveShadow><planeGeometry args={[Math.max(200, extent.width * 3), Math.max(200, extent.depth * 3)]} />{studio ? <shadowMaterial transparent opacity={.18} /> : <meshStandardMaterial color="#eeede5" roughness={1} />}</mesh></>}
    {!draft && environment.enabled && <WorldEnvironment plan={plan} settings={environment} state={environmentState} quality={quality} groundElevation={groundElevation}/>}
    {contactTexture && <ContactPatch texture={contactTexture} x={extent.x+extent.width/2+.08} y={groundElevation-.201} z={extent.y+extent.depth/2+.14} width={extent.width*1.28} depth={extent.depth*1.29} opacity={.22}/>}
    {draft?<><hemisphereLight args={["#ffffff","#b7b9b6",2]}/><directionalLight position={[6,10,3]} intensity={2}/></>:<RealisticLighting photoStudio={!environment.enabled} plan={plan} hour={hour} north={north} quality={quality} settings={environment} state={studio ? {...environmentState, groundColor:'#bd9e80', skyHorizonColor:'#fff7e7', hemisphereIntensity:environmentState.hemisphereIntensity*.63, environmentIntensity:environmentState.environmentIntensity*.8, sunIntensity:environmentState.sunIntensity*.78} : environmentState} showFixtures={showCeiling||walking} onRoomLightToggle={onRoomLightToggle}/>}
    {!draft&&(walking||visibleLayers.includes("walls"))&&<><FinishRails plan={plan} ceiling={walking||showCeiling}/>{reference&&(walking||!cutaway)&&<ReferencePrint plan={plan}/>}</>}
    <BuildingShell plan={plan} mode={walking?'floor':buildingMode} selectedFloor={activeFloor} totalFloors={totalFloors} floorHeight={floorHeight} onSelectFloor={onBuildingFloorSelect}/>
    <Floors plan={plan} showCeiling={showCeiling||walking} selectedId={walking ? null : selectedId} onSelect={select} />
    {(walking || visibleLayers.includes("walls")) && plan.walls.map(wall => <WallMesh key={wall.id} wall={wall} openings={plan.openings} material={resolvePlanMaterial(plan, wall.materialId, 'plaster-warm')} cutaway={walking||buildingMode==='building' ? false : cutaway} sectionHeight={reference && cutaway && !walking && buildingMode!=='building' ? referenceSectionHeight(wall, extent) : undefined} selected={!walking && selectedId === wall.id} onSelect={() => select(wall.id)} onOpeningToggle={onOpeningToggle} />)}
    {(walking || visibleLayers.includes("furniture")) && plan.furniture.map(item => {
      const furnitureProps = {item, material:resolvePlanMaterial(plan, item.materialId, ['sofa', 'bed', 'chair'].includes(item.kind) ? 'linen-cream' : 'wood-oak'), selected:!walking && selectedId === item.id, onSelect:() => select(item.id)};
      const variant = item.id.split(':')[1];
      return <group key={item.id} onPointerDown={event=>startDrag(event,item)} onPointerMove={moveDrag} onPointerUp={event=>endDrag(event,true)} onPointerCancel={event=>endDrag(event,false)}>
        {contactTexture && variant !== 'rug' && variant !== 'curtain' && <ContactPatch texture={contactTexture} x={item.x+.018} y={.036} z={item.y+.028} width={item.width*1.28+.06} depth={item.depth*1.28+.06} rotation={item.rotation} opacity={.24}/>}
        {draft ? <FurnitureMesh {...furnitureProps}/> : reference && item.id.startsWith('ref:') ? <ReferenceFurniture {...furnitureProps} variant={variant}/> : <RealisticFurniture {...furnitureProps}/>}
      </group>;
    })}
    {plan.routes.filter(route => visibleLayers.includes(route.kind)).map(route => <RouteMesh key={route.id} route={route} selected={!walking && selectedId === route.id} onSelect={() => select(route.id)} />)}
    {plan.nodes.filter(node => visibleLayers.includes(nodeLayer(node.kind))).map(node => <group key={node.id} position={[node.x, Math.max(.08, node.height), node.y]} onClick={event => { event.stopPropagation(); select(node.id); }}>
      <mesh castShadow><boxGeometry args={node.kind === "panel" ? [.28, .4, .08] : [.12, .12, .05]} /><meshStandardMaterial color={colors[nodeLayer(node.kind)]} emissive={selectedId === node.id ? colors[nodeLayer(node.kind)] : "#000"} emissiveIntensity={.2} /></mesh>
    </group>)}
    {!walking && <OrbitControls ref={orbit} key={resetKey} makeDefault target={orbitTarget.current} onChange={() => { if (orbit.current) orbitTarget.current.copy(orbit.current.target); }} minDistance={2} maxDistance={Math.max(45, extent.width * 4, extent.depth * 4,totalFloors*floorHeight*4)} maxPolarAngle={Math.PI / 2.05} enableDamping dampingFactor={.08} />}
    {walk?.active && <WalkthroughController plan={plan} {...walk} />}
    <CaptureBridge onReady={onCaptureReady} capture={capture} cameraSnapshot={cameraSnapshot} onReferenceReady={onReferenceReady} download={false} />
    <ContactShadowPass enabled={!draft&&quality==='high'}/>
  </>;
}

export default function SceneView(props: SceneViewProps) {
  const {active:loadingAssets} = useProgress();
  const reference = isReferencePlan(props.plan);
  const [cutaway, setCutaway] = useState(true);
  const [ready, setReady] = useState<boolean | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [captured, setCaptured] = useState(false);
  const [passThrough,setPassThrough]=useState(true);
  const [walking, setWalking] = useState(false);
  const [spawn, setSpawn] = useState<WalkSpawn | null>(null);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState("");
  const [position, setPosition] = useState<WalkPosition | null>(null);
  const [viewRequest, setViewRequest] = useState<ViewRequest>({ mode: 'oblique', revision: 0 });
  const [showCeiling, setShowCeiling] = useState(false);
  const [sunOpen, setSunOpen] = useState(false);
  const [buildingOpen, setBuildingOpen] = useState(false);
  const [interactionOpen,setInteractionOpen]=useState(false);
  const [buildingMode,setBuildingMode]=useState<BuildingViewMode>('cutaway');
  const [defaultEnvironment]=useState<ProjectEnvironment>(()=>({...DEFAULT_ENVIRONMENT,date:localEnvironmentDate(),hour:12,north:0}));
  const [localEnvironment,setLocalEnvironment]=useState(defaultEnvironment);
  const environment=props.plan.environment??(props.onEnvironmentChange?defaultEnvironment:localEnvironment);
  const [playing,setPlaying]=useState(false);
  const [playbackHour,setPlaybackHour]=useState<number|null>(null);
  const sunHour=playing&&playbackHour!==null?playbackHour:environment.hour,north=environment.north;
  const environmentState=useMemo(()=>deriveEnvironment(environment,sunHour,north),[environment,sunHour,north]);
  const activeFloor=props.plan.building?.activeFloor??1,totalFloors=props.plan.building?.totalFloors??1;
  const updateEnvironment=(patch:Partial<ProjectEnvironment>)=>{const next={...environment,...patch};if(props.onEnvironmentChange)props.onEnvironmentChange(next);else setLocalEnvironment(next);};
  const changePlayback=(next:boolean)=>{if(next){setPlaybackHour(sunHour);setPlaying(true);}else{if(playing&&playbackHour!==null)updateEnvironment({hour:playbackHour});setPlaying(false);}};
  useEffect(()=>{if(!playing)return;const timer=window.setInterval(()=>{if(!document.hidden)setPlaybackHour(value=>((value??environment.hour)+.25)%24);},1000);return()=>window.clearInterval(timer);},[playing,environment.hour]);
  const [quality, setQuality] = useState<'balanced'|'high'>('balanced');
  const [softwareRenderer, setSoftwareRenderer] = useState(false);
  const [cameraPose, setCameraPose] = useState<CameraPose | null>(null);
  const [rayRequest, setRayRequest] = useState(0);
  const [raySamples, setRaySamples] = useState(0);
  const [rayBusy, setRayBusy] = useState(false);
  const [rayImage, setRayImage] = useState('');
  const [joystick, setJoystick] = useState({x:0,y:0});
  const directions = useRef(new Set<WalkDirection>());
  const lock = useRef<(() => void) | null>(null);
  const [captureReady,setCaptureReady]=useState(false);
  const panoCapture=useRef(false);
  const capture = useRef<(() => void) | null>(null);
  const cameraSnapshot = useRef<(()=>{x:number;y:number;z:number;look_at:[number,number,number];fov:number})|null>(null);
  const exitWalk = useCallback(() => { directions.current.clear(); setWalking(false); setLocked(false); }, []);
  const selectFloor=(floor:number)=>{exitWalk();setBuildingMode('cutaway');setShowCeiling(false);setCutaway(true);setViewRequest(previous=>({mode:'oblique',revision:previous.revision+1}));props.onFloorChange?.(floor);};
  useEffect(()=>{exitWalk();setViewRequest(previous=>({mode:'oblique',revision:previous.revision+1}));},[activeFloor,exitWalk]);
  useEffect(()=>{if(props.tourStart){setSpawn(props.tourStart);setWalking(true);}},[props.tourStart]);
  const changeBuildingMode=(mode:BuildingViewMode)=>{exitWalk();setBuildingMode(mode);setShowCeiling(false);setCutaway(true);setViewRequest(previous=>({mode:'oblique',revision:previous.revision+1}));};
  const startWalk = () => {
    let next = passThrough?findFreeWalkSpawn(props.plan,props.selectedId):findWalkthroughSpawn(props.plan, props.selectedId);
    if (!next) { setNotice("当前户型没有足够的可站立空间，请先调整墙体或家具。"); return; }
    // The supplied single-room showcase opens facing its furnished living area.
    if(props.plan.name==='写实单间 · 日光客厅'){
      const room=props.plan.rooms[0],sofa=props.plan.furniture.find(item=>item.kind==='sofa');
      if(room&&sofa){const b=polygonBounds(roomPolygon(room)),position={x:b.x+b.width*.23,y:b.y+b.depth*.78};
        if(isWalkthroughPositionFree(props.plan,position)){next={...next,position,yaw:Math.atan2(-(sofa.x-position.x),-(sofa.y-position.y))};}}
    }
    setNotice(""); setBuildingOpen(false);setSunOpen(false);setInteractionOpen(false);setSpawn(next); setWalking(true);
  };
  const enterRoom = (roomId?: string) => {
    const next = passThrough?findFreeWalkSpawn(props.plan,roomId??spawn?.roomId):findWalkthroughSpawn(props.plan, roomId ?? spawn?.roomId);
    if (!next) { setNotice("没有找到安全站立点，请先调整家具或墙体。"); return; }
    directions.current.clear(); setNotice(""); setSpawn(next);
  };
  const toggleOpening=useCallback((id:string)=>{
    const opening=props.plan.openings.find(item=>item.id===id);if(!opening||!props.onPlanChange)return;
    const isOpen=!openingIsOpen(opening);
    const next={...props.plan,openings:props.plan.openings.map(item=>item.id===id?{...item,isOpen}:item)};
    // HUD coordinates are throttled. Use the actual camera feet for door safety.
    const liveCamera=walking?cameraSnapshot.current?.():undefined;
    const feet=liveCamera?{x:liveCamera.x,y:liveCamera.y}:position;
    if(!passThrough&&walking&&feet&&opening.kind==='door'&&!isOpen&&!isWalkthroughPositionFree(next,feet)){setNotice('请先离开门口，再关闭这扇门。');return;}
    props.onPlanChange(next);setNotice('');
  },[props.plan,props.onPlanChange,passThrough,walking,position]);
  const toggleRoomLight=(roomId:string)=>props.onPlanChange?.({...props.plan,rooms:props.plan.rooms.map(room=>room.id===roomId?{...room,lightOn:!(room.lightOn??environmentState.indoorLightLevel>.01)}:room)});
  const nearestOpening=walking&&position?props.plan.openings.map(opening=>{
    const wall=props.plan.walls.find(item=>item.id===opening.wallId);if(!wall)return null;
    const x=wall.start.x+(wall.end.x-wall.start.x)*opening.position,y=wall.start.y+(wall.end.y-wall.start.y)*opening.position;
    return {opening,distance:Math.hypot(position.x-x,position.y-y)};
  }).filter((item):item is {opening:Plan['openings'][number];distance:number}=>!!item&&item.distance<2).sort((a,b)=>a.distance-b.distance)[0]?.opening:undefined;
  useEffect(()=>{
    if(!walking||!nearestOpening||!props.onPlanChange)return;
    const keydown=(event:KeyboardEvent)=>{if(event.code==='KeyE'&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!['INPUT','TEXTAREA','SELECT'].includes((event.target as HTMLElement)?.tagName)){event.preventDefault();toggleOpening(nearestOpening.id);}};
    window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown);
  },[walking,nearestOpening,toggleOpening,props.onPlanChange]);
  useEffect(() => {
    try { if (localStorage.getItem('roomcraft.3d-quality') === 'high') setQuality('high'); } catch { /* Storage is optional. */ }
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2");
      setReady(Boolean(context));
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch { setReady(false); }
  }, []);
  const buttonStyle: React.CSSProperties = { border: "1px solid #dcd8cd", background: "#fffdf5ed", color: "#665f51", fontSize: 11, display: "flex", alignItems: "center", gap: 6, borderRadius: 7, padding: "7px 10px", cursor: "pointer" };
  const heading = cameraPose ? Math.atan2(cameraPose.targetX-cameraPose.x,-(cameraPose.targetZ-cameraPose.z))*180/Math.PI : 0;
  const compassRotation = north-heading;
  if (ready === false) return <SceneFallback message="当前环境未提供 WebGL 2。请使用支持硬件加速的 Chrome 或 Edge 浏览器。" />;
  return <div data-testid="scene-view" data-presentation={props.presentation||"finished"} data-sun-hour={sunHour} data-north={north} data-weather={environment.weather} data-landscape={environment.landscape} data-active-floor={activeFloor} data-total-floors={totalFloors} data-building-mode={walking?'floor':buildingMode} data-walkthrough-active={walking} data-pass-through={passThrough} data-view-mode={viewRequest.mode} data-view-room={viewRequest.roomId ?? ''} data-camera-x={cameraPose?.x.toFixed(4)} data-camera-y={cameraPose?.y.toFixed(4)} data-camera-z={cameraPose?.z.toFixed(4)} data-target-x={cameraPose?.targetX.toFixed(4)} data-target-y={cameraPose?.targetY.toFixed(4)} data-target-z={cameraPose?.targetZ.toFixed(4)} data-ceiling-visible={showCeiling} style={{ width: "100%", height: "100%", minHeight: 420, position: "relative", background: "#eeede5", overflow: "hidden" }}>
    <style>{`@media(max-width:600px){.roomcraft-scene-headline{display:none!important}.roomcraft-walk-actions{flex-wrap:wrap;max-width:calc(100% - 30px)}.roomcraft-scene-navigation{top:92px!important;max-width:calc(100% - 32px);flex-wrap:wrap}.roomcraft-sun-panel{top:165px!important;max-width:calc(100% - 36px)}}`}</style>
    {ready && <SceneBoundary><Canvas shadows={props.presentation!=="draft"} dpr={quality==='high'?[1,1.6]:softwareRenderer?[.65,.8]:[1,1.15]} camera={{ fov: 35, near: .1, far: 5000 }} gl={{ antialias: true, preserveDrawingBuffer: true, alpha: false }} onCreated={({gl})=>{gl.toneMapping=ACESFilmicToneMapping;gl.toneMappingExposure=1;gl.shadowMap.type=PCFSoftShadowMap;const context=gl.getContext();const info=context.getExtension('WEBGL_debug_renderer_info');if(info){const renderer=String(context.getParameter(info.UNMASKED_RENDERER_WEBGL));setSoftwareRenderer(/swiftshader|llvmpipe|software rasterizer|microsoft basic render/i.test(renderer));}}} onPointerMissed={() => props.onSelect(null)} fallback={<SceneFallback message="三维画布暂不可用，请检查浏览器硬件加速设置。" />}>
      <Suspense fallback={null}>
      <WhiteModel.Provider value={props.presentation==="draft"}><SceneContents {...props} onCaptureReady={setCaptureReady} onReferenceReady={props.onPanoramaFrame?(image,cam)=>{if(panoCapture.current){panoCapture.current=false;props.onPanoramaFrame?.(image);}else props.onReferenceReady?.(image,cam);}:props.onReferenceReady} cutaway={cutaway} resetKey={resetKey} capture={capture} cameraSnapshot={cameraSnapshot} viewRequest={viewRequest} showCeiling={showCeiling} onCameraPose={setCameraPose} hour={sunHour} north={north} quality={quality} environment={environment} environmentState={environmentState} buildingMode={buildingMode} onBuildingFloorSelect={selectFloor} onOpeningToggle={props.onPlanChange?toggleOpening:undefined} onRoomLightToggle={props.onPlanChange?toggleRoomLight:undefined} walk={spawn ? { active: walking, passThrough, spawn, directions, lock, onExit: props.onTourExit??exitWalk, onPosition: setPosition, onLockChange: setLocked, onNotice: setNotice } : null} /></WhiteModel.Provider>
      <PathTracingBridge request={rayRequest} onProgress={setRaySamples} onBusy={setRayBusy} onError={message=>{setRayRequest(0);setNotice(message);}} onComplete={image=>{setRayRequest(0);setRayImage(image);}} />
      </Suspense>
    </Canvas></SceneBoundary>}
    {ready === null && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#8b8373", fontSize: 12 }}>正在构建三维空间…</div>}
    {loadingAssets && <div style={{position:'absolute',inset:0,zIndex:8,display:'grid',placeItems:'center',background:'#ece9df',color:'#5f6858',fontSize:12}}>正在加载写实材质与家具…</div>}
    <div className="roomcraft-scene-headline" style={{ position: "absolute", top: 17, left: 18, display: "flex", alignItems: "center", gap: 7, color: walking ? "#5b6350" : "#8e887a", fontSize: 11, pointerEvents: "none" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#8b9a79" }} />{walking ? `第 ${activeFloor} 层 · 第一人称漫游` : `第 ${activeFloor} / ${totalFloors} 层 · ${buildingMode==='building'?'整栋外观':cutaway?'楼层剖切':'完整墙高'}`}</div>
    <div className="roomcraft-walk-actions" style={{ position: "absolute", right: 16, top: 15, display: "flex", justifyContent: "flex-end", gap: 6 }}>
      {walking ? <>
        <button style={buttonStyle} aria-label="穿墙漫游" aria-pressed={passThrough} title="可穿过家具与墙体；关闭后恢复碰撞" onClick={()=>setPassThrough(v=>!v)}>{passThrough?"穿墙：开":"穿墙：关"}</button>
        {props.plan.rooms.length > 0 && <select aria-label="进入指定房间" value={spawn?.roomId ?? ""} onChange={event => { if (event.target.value) enterRoom(event.target.value); }} style={{ ...buttonStyle, maxWidth: 105, padding: "7px 5px" }}>
          <option value="" disabled>进入房间</option>
          {props.plan.rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select>}
        <button style={{ ...buttonStyle, padding: "7px 8px" }} onClick={() => enterRoom()} aria-label="重置安全出生点" title="回到当前房间安全站立点"><RotateCcw size={13} /></button>
        <button style={buttonStyle} onClick={() => lock.current?.()} disabled={locked} aria-label="锁定鼠标看向"><MousePointer2 size={13} />{locked ? "鼠标已锁定" : "锁定鼠标"}</button>
        <button style={{ ...buttonStyle, color: "#a4553f" }} onClick={props.onTourExit??exitWalk}><LogOut size={13} />{props.onTourExit?"返回效果图":props.presentation==="finished"?"退出漫游 · 看全屋":"退出漫游"}</button>
      </> : <>
        <button style={{ ...buttonStyle, color: "#a4553f" }} onClick={startWalk} disabled={!ready}><Footprints size={13} />进入漫游</button>
        <button style={buttonStyle} onClick={() => setCutaway(!cutaway)} title="切换剖视与完整墙高"><ScanLine size={13} />{cutaway ? "完整墙高" : "剖切查看"}</button>
        <button style={{ ...buttonStyle, padding: "7px 8px" }} aria-label="恢复三维视角" title="恢复视角" onClick={() => setResetKey(n => n + 1)}><RotateCcw size={13} /></button>
      </>}
    </div>
    {!walking && <div className="roomcraft-scene-navigation" role="group" aria-label="三维视角与房间导航" style={{ position: 'absolute', top: 53, left: 18, display: 'flex', gap: 5,flexWrap:'wrap',maxWidth:'calc(100% - 36px)' }}>
      {([['bird', '鸟瞰'], ['oblique', '斜视'], ['top', '俯视']] as const).map(([mode, label]) => <button key={mode} style={{ ...buttonStyle, padding: '6px 9px', background: viewRequest.mode === mode ? '#e7e8db' : '#fffdf5ed', borderColor: viewRequest.mode === mode ? '#9da68a' : '#dcd8cd' }} aria-label={`${label}视角`} aria-pressed={viewRequest.mode === mode} onClick={() => setViewRequest(previous => ({ ...previous, mode, revision: previous.revision + 1 }))}>{label}</button>)}
      {props.plan.rooms.length > 0 && <select aria-label="查看指定房间" value={viewRequest.roomId ?? ''} onChange={event => setViewRequest(previous => ({ ...previous, roomId: event.target.value || undefined, revision: previous.revision + 1 }))} style={{ ...buttonStyle, maxWidth: 112, padding: '6px 4px' }}>
        <option value="">全屋视角</option>{props.plan.rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
      </select>}
      <button style={{ ...buttonStyle, padding: '6px 8px' }} aria-label="切换天花显示" aria-pressed={showCeiling} onClick={() => setShowCeiling(value => !value)} title={`天花高度 ${props.plan.ceilingHeight ?? 2.8} m · 从室内仰视可见`}>{showCeiling ? '隐藏天花' : '显示天花'}</button>
      <button style={{ ...buttonStyle, padding: '6px 8px' }} aria-expanded={sunOpen} onClick={() => {setInteractionOpen(false);setBuildingOpen(false);setSunOpen(value => !value);}}><Sun size={13}/>日照与朝向</button>
      {props.onEditOpenings && <button style={{ ...buttonStyle, padding: '6px 8px' }} aria-label="编辑门窗" title="查看窗户数量，添加或修改门窗" onClick={props.onEditOpenings}>门窗 · {props.plan.openings.filter(item => item.kind === 'window').length} 窗</button>}
      {props.onFloorChange && <button style={{...buttonStyle,padding:'6px 8px',background:buildingOpen?'#e7e8db':'#fffdf5ed'}} aria-label="楼层与剖切" aria-expanded={buildingOpen} onClick={()=>{setInteractionOpen(false);setSunOpen(false);setBuildingOpen(value=>!value);}}><Layers3 size={13}/>楼层 {activeFloor}/{totalFloors}F</button>}
      {props.onPlanChange && <button style={{...buttonStyle,padding:'6px 8px'}} aria-label="交互开关" aria-expanded={interactionOpen} onClick={()=>{setSunOpen(false);setBuildingOpen(false);setInteractionOpen(value=>!value);}}><MousePointer2 size={13}/>交互开关</button>}
    </div>}
    {walking && <button style={{...buttonStyle,position:'absolute',top:57,left:18}} aria-expanded={sunOpen} onClick={()=>{setInteractionOpen(false);setBuildingOpen(false);setSunOpen(value=>!value);}}><Sun size={13}/>日照与朝向</button>}
    {walking && props.onPlanChange && <button style={{...buttonStyle,position:'absolute',top:57,left:135}} aria-label="交互开关" aria-expanded={interactionOpen} onClick={()=>{setSunOpen(false);setBuildingOpen(false);setInteractionOpen(value=>!value);}}><MousePointer2 size={13}/>交互开关</button>}
    {sunOpen && <EnvironmentPanel settings={environment} hour={sunHour} north={north} state={environmentState} onSettingsChange={updateEnvironment} onHourChange={hour=>{setPlaying(false);updateEnvironment({hour});}} onNorthChange={north=>updateEnvironment({north})} playing={playing} onPlayingChange={changePlayback} onClose={()=>setSunOpen(false)}/>}
    {buildingOpen && props.onFloorChange && props.onFloorCountChange && props.onFloorHeightChange && <BuildingControls plan={props.plan} mode={buildingMode} onModeChange={changeBuildingMode} onFloorChange={selectFloor} onCountChange={props.onFloorCountChange} onHeightChange={props.onFloorHeightChange} onClose={()=>setBuildingOpen(false)}/>}
    {interactionOpen && props.onPlanChange && <SceneInteractions plan={props.plan} automaticLightLevel={environmentState.indoorLightLevel} onOpeningToggle={toggleOpening} onLightToggle={toggleRoomLight} onLightReset={()=>props.onPlanChange?.({...props.plan,rooms:props.plan.rooms.map(room=>{const next={...room};delete next.lightOn;return next;})})} onClose={()=>setInteractionOpen(false)}/>}
    <div aria-label={`指南针，户型正北方向 ${north} 度`} title="指南针随三维视角旋转；正北可在日照与朝向中调整" style={{position:'absolute',right:18,top:walking?104:96,width:48,height:48,borderRadius:'50%',background:'#fffdf5e8',border:'1px solid #d5d8ca',display:'grid',placeItems:'center',pointerEvents:'none',color:'#667e58',boxShadow:'0 3px 12px #0001'}}><div style={{transform:`rotate(${compassRotation}deg)`,display:'grid',placeItems:'center',lineHeight:1}}><span style={{fontSize:10,fontWeight:700}}>N</span><Compass size={23}/></div></div>
    <select aria-label="三维画质" value={quality} title="流畅模式降低实时阴影开销；精细模式保留更多效果" onChange={event=>{const value=event.target.value==='high'?'high':'balanced';setQuality(value);try{localStorage.setItem('roomcraft.3d-quality',value);}catch{/* Storage is optional. */}}} style={{...buttonStyle,position:'absolute',right:18,top:walking?160:152,padding:'6px 7px'}}><option value="balanced">流畅模式</option><option value="high">精细模式</option></select>
    {softwareRenderer && <div role="status" title="当前浏览器使用软件渲染，可能卡顿；可在浏览器设置中开启硬件加速。" style={{position:'absolute',right:18,top:walking?198:190,maxWidth:190,padding:'7px 9px',borderRadius:7,background:'#fff9e9ee',color:'#80623f',fontSize:10,lineHeight:1.5}}>{reference && !walking ? '软件渲染' : '当前浏览器使用软件渲染，可能卡顿；可在浏览器设置中开启硬件加速。'}</div>}
    {notice && <div role="status" style={{ position: "absolute", top: 57, left: "50%", transform: "translateX(-50%)", maxWidth: "90%", padding: "9px 13px", borderRadius: 8, background: "#fffaf0ee", color: "#8b644d", border: "1px solid #e4d7bd", fontSize: 11, lineHeight: 1.6 }}>{notice}</div>}
    {walking && <>
      {nearestOpening&&props.onPlanChange&&<button style={{...buttonStyle,position:'absolute',left:18,bottom:160,background:'#fffdf2f2'}} aria-label="操作附近门窗" onClick={()=>toggleOpening(nearestOpening.id)}>E · {openingIsOpen(nearestOpening)?'关闭':'打开'}附近{nearestOpening.kind==='door'?'房门':'窗户'}</button>}
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: 4, height: 4, borderRadius: "50%", background: "#fffefa", boxShadow: "0 0 0 1px #5c5a5266", pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: 16, bottom: 63, display: "grid", gridTemplateColumns: "repeat(3, 34px)", gridTemplateRows: "repeat(2, 34px)", gap: 4 }} aria-label="漫游方向控制">
        {([['forward', '向前移动', ArrowUp, 2, 1], ['left', '向左移动', ArrowLeft, 1, 2], ['backward', '向后移动', ArrowDown, 2, 2], ['right', '向右移动', ArrowRight, 3, 2]] as const).map(([direction, label, Icon, col, row]) => <button key={direction} aria-label={label} title={label} style={{ ...buttonStyle, gridColumn: col, gridRow: row, padding: 0, justifyContent: "center", touchAction: "none", userSelect: "none" }} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); directions.current.add(direction); }} onPointerUp={event => { directions.current.delete(direction); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => directions.current.delete(direction)} onLostPointerCapture={() => directions.current.delete(direction)}><Icon size={15} /></button>)}
      </div>
      <div role="application" aria-label="触摸摇杆，拖动控制移动" style={{position:'absolute',left:145,bottom:64,width:78,height:78,borderRadius:'50%',background:'#fffaf099',border:'1px solid #d2c9b8',touchAction:'none'}} onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))return;const box=event.currentTarget.getBoundingClientRect();let x=(event.clientX-box.left-box.width/2)/(box.width/2),y=(event.clientY-box.top-box.height/2)/(box.height/2);const length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}setJoystick({x,y});directions.current.clear();if(x<-.22)directions.current.add('left');if(x>.22)directions.current.add('right');if(y<-.22)directions.current.add('forward');if(y>.22)directions.current.add('backward');}} onPointerUp={event=>{directions.current.clear();setJoystick({x:0,y:0});if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{directions.current.clear();setJoystick({x:0,y:0});}} onLostPointerCapture={()=>{directions.current.clear();setJoystick({x:0,y:0});}}><span style={{position:'absolute',left:`calc(50% + ${joystick.x*25}px)`,top:`calc(50% + ${joystick.y*25}px)`,transform:'translate(-50%,-50%)',width:30,height:30,borderRadius:'50%',background:'#70805f',boxShadow:'0 2px 8px #0003',pointerEvents:'none'}}/></div>
      <output data-testid="walkthrough-position" aria-label="漫游位置" data-x={position?.x.toFixed(4)} data-y={position?.y.toFixed(4)} data-yaw={position?.yaw.toFixed(4)} style={{ position: "absolute", bottom: 67, right: 17, borderRadius: 7, background: "#fffaf0db", padding: "7px 10px", color: "#8a8171", fontSize: 10, fontVariantNumeric: "tabular-nums", pointerEvents: "none" }}>{position ? `位置 ${position.x.toFixed(2)} / ${position.y.toFixed(2)} m · 眼高 ${WALK_EYE_HEIGHT} m` : "正在进入室内…"}</output>
    </>}
    <div style={{ position: "absolute", bottom: 16, left: 18, right: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <span style={{ color: "#8e8777", fontSize: 10, pointerEvents: "none", maxWidth: "65%", lineHeight: 1.7 }}>{walking ? "WASD / 方向键移动 · 拖动看向 · Shift 快走 · Esc 退出" : "拖动旋转 · 滚轮缩放 · 右键平移"}</span>
      <a href="/assets/realistic/NOTICE.txt" target="_blank" rel="noreferrer" style={{fontSize:10,color:'#777'}}>素材许可</a>
      {props.presentation!=="draft"&&<button style={buttonStyle} disabled={!ready||playing} title={playing?'暂停昼夜播放后出图':undefined} onClick={()=>{if(rayBusy){setRayRequest(0);setRayBusy(false);setNotice('已取消本次光线追踪');}else{setRayImage('');setRaySamples(0);setRayRequest(Date.now());}}}>{rayBusy?`停止光追 ${raySamples}/64`:'光线追踪出图'}</button>}
      {props.presentation!=="draft"&&props.onNewEraRender && <button style={buttonStyle} disabled={!ready||props.newEraRendering||playing||buildingMode==='building'} title="New Era 独立引擎；门窗开关与窗外环境请用本页光线追踪出图" onClick={()=>{const camera=cameraSnapshot.current?.();if(camera)props.onNewEraRender?.(camera);else setNotice('三维场景尚未加载完成');}}>{props.newEraRendering?'New Era 渲染中…':'New Era 光追'}</button>}
      {props.onPanoramaFrame&&<button style={buttonStyle} disabled={!ready||!captureReady||playing||loadingAssets} onClick={()=>{if(!capture.current){setNotice("三维场景仍在加载");return;}panoCapture.current=true;try{capture.current();}finally{panoCapture.current=false;}}}>AI 房间全景</button>}
      {props.presentation!=="draft"&&<button style={{ ...buttonStyle, color: "#a4553f", background: "#fffaf0" }} data-scene-output disabled={!ready||!captureReady||loadingAssets||playing} onClick={() => { if(!capture.current){setNotice("三维场景正在加载，请稍后出图");return;} capture.current(); setCaptured(true); window.setTimeout(() => setCaptured(false), 2000); }}><Camera size={13} />{captured ? "视角已捕获" : props.onReferenceReady ? "确认三维并出图" : "保存当前视角"}</button>}
    </div>
    {rayImage && <div style={{position:'absolute',inset:0,zIndex:20,background:'#161b17eF',display:'grid',placeItems:'center',padding:24}}><img src={rayImage} alt="光线追踪静帧" style={{maxWidth:'100%',maxHeight:'85%',objectFit:'contain'}}/><div style={{position:'absolute',right:28,top:24,display:'flex',gap:8}}><a href={rayImage} download="roomcraft-raytraced.png" style={{...buttonStyle,textDecoration:'none'}}>下载光追静帧</a><button style={buttonStyle} onClick={()=>setRayImage('')}>返回三维</button></div></div>}
  </div>;
}
