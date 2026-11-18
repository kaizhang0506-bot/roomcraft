"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Box, Check, CheckCheck,
  ChevronDown, ChevronRight, CircleHelp, Compass, Download, Droplets,
  Expand, FileCode2, FileImage, FilePlus2, FolderOpen, Grid2X2, Home,
  Image as ImageIcon, Layers2, Lightbulb, LoaderCircle, Maximize2,
  MousePointer2, MoveUpRight, PanelLeftClose, PencilRuler, Plus,
  Redo2, RotateCcw, Save, Settings2, SlidersHorizontal, Sofa, Sparkles,
  DoorOpen, Square, Undo2, Upload, WandSparkles, X, Zap, Share2, Palette, ScanLine,
} from "lucide-react";
import { SAMPLE_PLAN, STYLE_OPTIONS, clonePlan, type Plan, type Furniture, type Point } from "@/lib/plan";
import { importFloorplan, fileDataUrl } from "@/lib/import";
import { normalizePlan, resizeRoom, roomArea, roomPolygon, roomLabelPoint, polygonBounds, polygonContainsPolygon } from "@/lib/layout";
import { createProjectShareUrl, readSharedProject } from "@/lib/share";
import { furnishRealisticSample } from "@/lib/realistic-sample";
import RecognitionCorrection from "@/components/RecognitionCorrection";
import MaterialLibrary from "@/components/MaterialLibrary";
import PlanPicker from '@/components/PlanPicker';
import EffectImageViewer from "@/components/EffectImageViewer";
import { applyFurnitureDraft, type CapabilityAction } from "@/lib/design-capabilities";
import { validatePlan } from "@/lib/validation";
import { requiredFloorHeight, setBuildingFloorCount, setBuildingFloorHeight, switchBuildingFloor } from '@/lib/building';
import type { ProjectEnvironment } from '@/lib/environment';
import { downloadProject, exportDXF, downloadImage } from "@/lib/export";
import { loadGeneratedImages, saveGeneratedImage, type GeneratedImageRecord, type FrameCamera } from "@/lib/generation-store";
import "./effect-view.css";
import "./furniture-palette.css";

const PhotoStudy=dynamic(()=>import('@/components/PhotoStudy'),{ssr:false});
const PlanCanvas = dynamic(() => import("@/components/PlanCanvas"), { ssr: false, loading: () => <CanvasLoader label="正在加载户型编辑器" /> });
const StagedSpace = dynamic(() => import("@/components/StagedSpace"), { ssr: false, loading: () => <CanvasLoader label="正在构建三维空间" /> });
const PhotoTour = dynamic(() => import("@/components/PhotoTour"), { ssr: false, loading: () => <CanvasLoader label="正在加载全景预览" /> });
const ProfessionalEditor = dynamic(() => import("@/components/ProfessionalEditor"), { ssr: false, loading: () => <CanvasLoader label="正在加载专业编辑器" /> });
const DesignCapabilities = dynamic(() => import("@/components/DesignCapabilities"), { ssr: false, loading: () => <CanvasLoader label="正在加载设计能力" /> });

type View = "plan" | "space" | "photo" | "render" | "professional";
type Tool = "select" | "door" | "wall" | "socket" | "water" | "route-power" | "route-water";
type CatalogItem = { kind: Furniture["kind"]; name: string; size: [number, number, number]; symbol: string };
const FURNITURE_CATALOG: CatalogItem[] = [
  { kind: "chair", name: "餐椅", size: [.48, .52, .85], symbol: "◧" },
  { kind: "chair", name: "休闲椅", size: [.78, .78, .82], symbol: "◧" },
  { kind: "chair", name: "矮凳（简化）", size: [.42, .42, .46], symbol: "◧" },
  { kind: "chair", name: "吧椅（简化）", size: [.45, .45, .95], symbol: "◧" },
  { kind: "sofa", name: "三人沙发", size: [2.6, .95, .8], symbol: "▱" },
  { kind: "sofa", name: "双人沙发", size: [1.65, .85, .8], symbol: "▱" },
  { kind: "table", name: "餐桌", size: [1.6, .8, .75], symbol: "▭" },
  { kind: "table", name: "茶几", size: [1, .55, .42], symbol: "▭" },
  { kind: "table", name: "书桌", size: [1.2, .6, .75], symbol: "▭" },
  { kind: "bed", name: "双人床", size: [1.8, 2, .55], symbol: "▰" },
  { kind: "cabinet", name: "收纳柜", size: [1.8, .6, 2.4], symbol: "▥" },
  { kind: "plant", name: "室内绿植", size: [.5, .5, 1.3], symbol: "✳" },
];
type Modal = "photo-study" | "history-image" | "templates" | "files" | "library" | "settings" | "help" | "export" | "correction" | "openings" | "materials" | "share" | "capabilities" | null;
type Status = { imageConfigured: boolean; visionConfigured: boolean; cpuConfigured?: boolean; imageModel: string; visionModel: string; imageProtocol?: string; imageProvider?: string; message?: string };
type RenderResult = GeneratedImageRecord;
type PendingGeneration = { sourcePlanKey?:string; taskId: string; taskToken: string; model: string; style: string; room: string; createdAt: number; recordId: string };
const PENDING_IMAGE_KEY = "roomcraft.image.pending.v1";
class ImageTaskError extends Error { constructor(message: string, public definitive = false) { super(message); this.name = "ImageTaskError"; } }
function waitForPoll(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("停止等待", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException("停止等待", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
const LOCAL_KEY = "roomcraft.project.v1";
const BEFORE_SHARE_KEY = "roomcraft.project.before-share.v1";
const ROUTE_NAMES: Record<string, string> = { power: "电力线路", lighting: "照明线路", coldWater: "冷水管", hotWater: "热水管", drain: "排水管" };
const LAYERS = [
  { id: "walls", name: "墙体与门窗", color: "#474c48", icon: Home },
  { id: "furniture", name: "家具与软装", color: "#b39778", icon: Sofa },
  { id: "power", name: "插座与强电", color: "#d56c58", icon: Zap },
  { id: "lighting", name: "照明与开关", color: "#c59b44", icon: Lightbulb },
  { id: "coldWater", name: "冷水管线", color: "#6c9db5", icon: Droplets },
  { id: "hotWater", name: "热水管线", color: "#c67f72", icon: Droplets },
  { id: "drain", name: "排水管线", color: "#7d9a81", icon: Droplets },
];

function CanvasLoader({ label }: { label: string }) {
  return <div className="canvas-loader"><LoaderCircle size={24} className="spin" /><span>{label}</span></div>;
}
function uid() { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function formatArea(n: number) { return Number.isFinite(n) ? n.toFixed(1) : "—"; }
function localTime() { return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); }
function safeMessage(error: unknown) { return error instanceof Error ? error.message : "操作未完成，请重试"; }

function rectangleFootprint(center: Point, width: number, depth: number, rotation = 0): Point[] {
  const theta = rotation * Math.PI / 180, c = Math.cos(theta), s = Math.sin(theta);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x: center.x + x * width / 2 * c - y * depth / 2 * s, y: center.y + x * width / 2 * s + y * depth / 2 * c }));
}
function convexFootprintsOverlap(a: Point[], b: Point[]): boolean {
  const ab = polygonBounds(a), bb = polygonBounds(b);
  if (ab.x + ab.width <= bb.x || bb.x + bb.width <= ab.x || ab.y + ab.depth <= bb.y || bb.y + bb.depth <= ab.y) return false;
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], axis = { x: p.y - q.y, y: q.x - p.x };
    const pa = a.map(v => v.x * axis.x + v.y * axis.y), pb = b.map(v => v.x * axis.x + v.y * axis.y);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-8 || Math.max(...pb) <= Math.min(...pa) + 1e-8) return false;
  }
  return true;
}
function findFurniturePlacement(plan: Plan, width: number, depth: number, preferredRoomId: string) {
  const blockers = [...plan.walls.map(wall => rectangleFootprint({ x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 }, Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) + .08, wall.thickness + .08, Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * 180 / Math.PI)), ...plan.furniture.map(item => rectangleFootprint(item, item.width + .08, item.depth + .08, item.rotation))];
  const regions = [...plan.rooms].sort((a, b) => Number(b.id === preferredRoomId) - Number(a.id === preferredRoomId));
  if (!regions.length) regions.push({ id: "all", name: "当前空间", x: 0, y: 0, width: plan.width, depth: plan.depth });
  for (const room of regions) {
    const polygon = roomPolygon(room), bounds = polygonBounds(polygon), center = roomLabelPoint(room);
    const minX = bounds.x + width / 2 + .04, maxX = bounds.x + bounds.width - width / 2 - .04, minY = bounds.y + depth / 2 + .04, maxY = bounds.y + bounds.depth - depth / 2 - .04;
    if (maxX < minX || maxY < minY) continue;
    const columns = Math.min(40, Math.max(1, Math.ceil((maxX - minX) / .25))), rows = Math.min(40, Math.max(1, Math.ceil((maxY - minY) / .25)));
    const candidates: Point[] = [center];
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) candidates.push({ x: minX + (maxX - minX) * x / columns, y: minY + (maxY - minY) * y / rows });
    candidates.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y));
    for (const point of candidates) {
      const footprint = rectangleFootprint(point, width + .06, depth + .06);
      if (polygonContainsPolygon(polygon, footprint) && !blockers.some(blocker => convexFootprintsOverlap(footprint, blocker))) return { point, room };
    }
  }
  return null;
}

export default function Workspace() {
  const [plan, setPlan] = useState<Plan>(() => normalizePlan(clonePlan(SAMPLE_PLAN)));
  const [view, setView] = useState<View>("plan");
  const [effectMode, setEffectMode] = useState<"scene" | "image">("scene");
  const [newEraRendering, setNewEraRendering] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState("all");
  const [tool, setTool] = useState<Tool>("select");
  const [layers, setLayers] = useState(["walls", "furniture"]);
  const [rightTab, setRightTab] = useState<"design" | "properties" | "catalog">("design");
  const [catalogTab, setCatalogTab] = useState<"furniture" | "materials">("furniture");
  const [styleId, setStyleId] = useState(STYLE_OPTIONS[0]?.id || "modern");
  const [prompt, setPrompt] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [sharing, setSharing] = useState(false);
  const [drawingRoomId, setDrawingRoomId] = useState('');
  const [drawingBusy, setDrawingBusy] = useState(false);
  const [drawingWarnings, setDrawingWarnings] = useState<string[]>([]);
  const [beforeSharePlan, setBeforeSharePlan] = useState<Plan | null>(null);
  const [autosavePaused, setAutosavePaused] = useState(false);
  const [recognitionProvider, setRecognitionProvider] = useState<"cpu" | "vision" | "house">("cpu");
  const [knownWidthInput, setKnownWidthInput] = useState("");
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [backgroundImage, setBackgroundImage] = useState<string>();
  const [referenceImage, setReferenceImage] = useState<string>();
  const [uploadName, setUploadName] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState<"import" | "analyze" | "generate" | "design" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState<RenderResult[]>([]);
  const [activeResult, setActiveResult] = useState(0);
  const [pendingGeneration, setPendingGeneration] = useState<PendingGeneration | null>(null);
  const [imagePhase, setImagePhase] = useState<"starting" | "processing">("starting");
  const stoppedWaitingRef = useRef(false);
  const [savedAt, setSavedAt] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [history, setHistory] = useState<Plan[]>([]);
  const [future, setFuture] = useState<Plan[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const planRef = useRef(plan);
  const stageRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = setTimeout(() => setToast(null), error ? 9000 : 4500);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error("服务状态暂不可用");
      setStatus(await response.json()); setStatusError(false);
    } catch { setStatusError(true); }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      let restored: Plan | null = null;
      let shared = false;
      let previousLocal: Plan | null = null;
      let previousBackup: Plan | null = null;
      let backupError = false;
      try { restored = await readSharedProject(); shared = !!restored; }
      catch (error) { if (active) notify(`分享链接未能打开：${safeMessage(error)}`, true); }
      try {
        const saved = localStorage.getItem(LOCAL_KEY);
        if (saved) { try { previousLocal = validatePlan(JSON.parse(saved)); } catch { /* Ignore invalid project data. */ } }
        const backup = localStorage.getItem(BEFORE_SHARE_KEY);
        if (backup) { try { previousBackup = validatePlan(JSON.parse(backup)); } catch { /* Ignore invalid backup data. */ } }
        if (shared && previousLocal) {
          try { localStorage.setItem(BEFORE_SHARE_KEY, JSON.stringify(previousLocal)); previousBackup = previousLocal; }
          catch { previousBackup = previousLocal; backupError = true; }
        }
      } catch { if (shared) backupError = true; }
      if (!restored) restored = previousLocal;
      if (!active) return;
      setBeforeSharePlan(previousBackup);
      if (backupError) {
        setAutosavePaused(true);
      }
      if (restored) { setPlan(normalizePlan(restored)); setSavedAt(localTime()); }
      if (shared) {
        notify(backupError ? "分享项目已打开，但本机备份失败，自动保存已暂停；原本机项目仍保留，请先下载当前项目" : previousLocal ? "已打开分享项目，原本机项目已备份，可在项目文件中恢复" : "已打开分享的可编辑项目；图片和模型密钥不会随链接传递", backupError);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      setHydrated(true);
      void refreshStatus();
    })();
    return () => { active = false; abortRef.current?.abort(); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [refreshStatus, notify]);

  useEffect(() => {
    let active = true;
    void loadGeneratedImages().then(records => {
      if (active) setResults(items => [...new Map([...records, ...items].map(item => [item.id, item])).values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4));
    }).catch(() => { if (active) notify("无法读取浏览器中的效果图记录；新结果请及时下载保存", true); });
    try {
      const saved = localStorage.getItem(PENDING_IMAGE_KEY);
      if (saved) {
        const task = JSON.parse(saved) as Partial<PendingGeneration>;
        if (typeof task.taskId === "string" && task.taskId.length > 0 && typeof task.taskToken === "string" && task.taskToken.length > 0 && typeof task.model === "string" && typeof task.style === "string" && typeof task.room === "string" && Number.isFinite(task.createdAt)) {
          setPendingGeneration({ ...task, recordId: typeof task.recordId === "string" ? task.recordId : uid() } as PendingGeneration);
        } else notify("上次生图等待记录无效，请检查服务生成记录后再提交", true);
      }
    } catch { notify("无法恢复上次生图任务，请检查浏览器存储权限", true); }
    return () => { active = false; };
  }, [notify]);

  useEffect(() => { planRef.current = plan; }, [plan]);
  useEffect(() => {
    if (!hydrated || autosavePaused) return;
    const timer = setTimeout(() => {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(plan)); setSavedAt(localTime()); }
      catch { notify("浏览器存储不可用，请下载项目文件保存设计", true); }
    }, 700);
    return () => clearTimeout(timer);
  }, [plan, hydrated, autosavePaused, notify]);
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const timer = setInterval(() => setElapsed(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const updatePlan = useCallback((next: Plan, options?: { preserveReview?: boolean; replaceProject?: boolean }) => {
    if(next.building){const required=requiredFloorHeight(next);if(required>12){notify('多层建筑的墙体与天花高度最多 12 米',true);return;}if(required>next.building.floorHeight)next={...next,building:{...next.building,floorHeight:required}};}
    const previous=clonePlan(planRef.current);
    setHistory(items => options?.replaceProject ? [] : [...items.slice(-29), previous]);
    setFuture([]);
    const normalized=normalizePlan({ ...next, verified: options?.preserveReview ? next.verified : false, ...(next.recognition && !options?.preserveReview ? { recognition: { ...next.recognition, needsReview: true } } : {}) });
    planRef.current=normalized;
    setPlan(normalized);
    setReferenceImage(undefined);
  }, [notify]);
  const updateEnvironment=useCallback((environment:ProjectEnvironment)=>{
    const previous=planRef.current;
    const snapshot=clonePlan(previous);
    setHistory(items=>[...items.slice(-29),snapshot]);setFuture([]);
    // Time and weather do not rebuild the editable geometry or invalidate its review.
    const next={...previous,environment};planRef.current=next;setPlan(next);setReferenceImage(undefined);
  },[]);
  const changeFloor=useCallback((floor:number)=>{
    if(floor===(planRef.current.building?.activeFloor??1))return;
    try{updatePlan(switchBuildingFloor(planRef.current,floor),{preserveReview:true});setSelectedId(null);setRoomId('all');setDrawingRoomId('');setTool('select');}
    catch(error){notify(error instanceof Error?error.message:'切换楼层失败',true);}
  },[updatePlan,notify]);
  const changeFloorCount=useCallback((count:number)=>{
    try{updatePlan(setBuildingFloorCount(planRef.current,count),{preserveReview:true});setSelectedId(null);setRoomId('all');}
    catch(error){notify(error instanceof Error?error.message:'修改楼层数失败',true);}
  },[updatePlan,notify]);
  const changeFloorHeight=useCallback((height:number)=>{
    try{updatePlan(setBuildingFloorHeight(planRef.current,height),{preserveReview:true});}
    catch(error){notify(error instanceof Error?error.message:'修改层高失败',true);}
  },[updatePlan,notify]);
  const undo = useCallback(() => {
    if (!history.length) return;
    setFuture(items => [...items, clonePlan(planRef.current)]);
    const restored=clonePlan(history[history.length - 1]);planRef.current=restored;setPlan(restored);
    setHistory(items => items.slice(0, -1));
    setReferenceImage(undefined);
  }, [history]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setHistory(items => [...items, clonePlan(planRef.current)]);
    const restored=clonePlan(future[future.length - 1]);planRef.current=restored;setPlan(restored);
    setFuture(items => items.slice(0, -1));
    setReferenceImage(undefined);
  }, [future]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setModal(null); setTool("select"); return; }
      const tag = (event.target as HTMLElement)?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); downloadProject(planRef.current); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [redo, undo]);

  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const elements = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(element => element.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { cancelAnimationFrame(timer); document.removeEventListener("keydown", trap); previous?.focus(); };
  }, [modal]);

  const room = plan.rooms.find(item => item.id === roomId);
  const selectedDrawingRoomId = plan.rooms.some(item => item.id === drawingRoomId) ? drawingRoomId : room?.id || plan.rooms[0]?.id || '';
  const selectedWall = plan.walls.find(item => item.id === selectedId);
  const selectedFurniture = plan.furniture.find(item => item.id === selectedId);
  const selectedNode = plan.nodes.find(item => item.id === selectedId);
  const selectedRoom = plan.rooms.find(item => item.id === selectedId);
  const selectedRoute = plan.routes.find(item => item.id === selectedId);
  const style = STYLE_OPTIONS.find(item => item.id === styleId) || STYLE_OPTIONS[0];
  const sceneKey = useMemo(()=>JSON.stringify([plan,[...layers].sort()],(_,v)=>v && typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v),[plan,layers]);
  const currentResult = results.find(item=>item.model==='scene-frame' && (item.draftKey??item.sceneKey)===sceneKey);
  const archiveResult=results[activeResult];
  const totalArea = plan.rooms.length ? plan.rooms.reduce((sum, item) => sum + roomArea(item), 0) : plan.width * plan.depth;
  const selectItem = useCallback((id: string | null) => { setSelectedId(id); if (id) setRightTab("properties"); }, []);
  const receiveReference = useCallback((image:string,camera:FrameCamera,finishedPlan:Plan)=>{
    const record:RenderResult={id:uid(),model:'scene-frame',image,sceneKey:JSON.stringify([finishedPlan,[...layers].sort()]),draftKey:sceneKey,camera,style:'三维原景',room:plan.name,time:localTime(),createdAt:Date.now()};
    setResults(items=>[record,...items].slice(0,4));setActiveResult(0);setReferenceImage(image);
    setView('render');setTool('select');setEffectMode('image');setRightTab('design');
    void saveGeneratedImage(record).catch(()=>notify('效果图已生成，但本机存储不足，请下载原图',true));
  },[sceneKey,plan.name,layers,notify]);
  const setToolFromCanvas = useCallback((next: string) => setTool(next as Tool), []);

  const setViewSafe = (next: View) => { setView(next); setTool("select"); };
  function toggleLayer(id: string) { setLayers(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]); }

  async function handleUpload(file?: File) {
    if (!file || busy) return;
    setBusy("import");
    try {
      const imported = await importFloorplan(file);
      if (imported.plan) { updatePlan(imported.plan, { replaceProject: true }); setSelectedId(null); setRoomId("all"); }
      if (imported.backgroundImage && !imported.plan) {
        updatePlan({ version: 1, name: file.name.replace(/\.[^.]+$/, ""), width: 12, depth: 10, rooms: [], walls: [], openings: [], furniture: [], nodes: [], routes: [], verified: false }, { replaceProject: true });
        setSelectedId(null); setRoomId("all");
      }
      setBackgroundImage(imported.backgroundImage);
      setUploadName(file.name);
      setWarnings(imported.warnings || []);
      setReferenceImage(undefined);
      setViewSafe("plan"); setModal(null);
      notify(imported.plan ? "户型已导入，请核对尺寸与门窗位置" : "参考图已导入，可描图或使用 AI 识别");
    } catch (error) { notify(safeMessage(error), true); }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function analyze() {
    if (!backgroundImage || busy) return;
    if (recognitionProvider === "vision" && !status?.visionConfigured) { setModal("settings"); return; }
    const controller = new AbortController(); abortRef.current = controller;
    setBusy("analyze");
    const timeout = setTimeout(() => controller.abort(), 240000);
    try {
      const response = await fetch("/api/recognize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: backgroundImage, provider: recognitionProvider, ...(Number(knownWidthInput) > 0 ? { knownWidthMeters: Number(knownWidthInput) } : {}) }), signal: controller.signal });
      const data = await response.json() as { error?: string; plan?: unknown; warnings?: string[]; image?: string; model?: string };
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "户型识别失败，请稍后重试");
      if (!data.plan) throw new Error("未获得可编辑的户型，请手工描图");
      updatePlan(validatePlan(data.plan)); setSelectedId(null); setRoomId("all"); setWarnings(data.warnings || ["AI 识别结果须核对比例、尺寸和门窗位置"]);
      setModal("correction");
      notify("识别已转换成可编辑数据，请校正尺寸、门窗与房间边界");
    } catch (error) { notify(error instanceof Error && error.name === "AbortError" ? "识别已取消或超时，原设计已保留" : safeMessage(error), true); }
    finally { clearTimeout(timeout); setBusy(null); abortRef.current = null; }
  }

  async function designLayout() {
    if (busy) return;
    if (!plan.rooms.length || !plan.walls.length) {
      notify("请先识别或描绘户型，并标记房间，再生成家具布置", true);
      return;
    }
    if (!status?.visionConfigured) { setModal("settings"); return; }
    const controller = new AbortController(); abortRef.current = controller;
    setBusy("design");
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const response = await fetch("/api/design", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, style: styleId, prompt }), signal: controller.signal,
      });
      const data = await response.json() as { error?: string; plan?: unknown; summary?: string; model?: string };
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "AI 家具布置失败，请稍后重试");
      if (!data.plan) throw new Error("未获得有效设计方案，原方案已保留");
      const nextPlan = validatePlan(data.plan);
      updatePlan(nextPlan);
      setSelectedId(null);
      setLayers(items => items.includes("furniture") ? items : [...items, "furniture"]);
      setViewSafe("space");
      notify(typeof data.summary === "string" && data.summary.trim() ? data.summary.trim().slice(0, 180) : "AI 家具布置已完成，可在三维空间查看并继续调整");
    } catch (error) {
      notify(error instanceof Error && error.name === "AbortError" ? "AI 布置已取消或超时，原方案已保留" : safeMessage(error), true);
    } finally { clearTimeout(timeout); setBusy(null); abortRef.current = null; }
  }

  function persistPending(task: PendingGeneration) {
    setPendingGeneration(task);
    try { localStorage.setItem(PENDING_IMAGE_KEY, JSON.stringify(task)); }
    catch { notify("无法保存等待进度，请保持页面开启，收到图片后立即下载", true); }
  }
  function clearPending() {
    setPendingGeneration(null);
    try { localStorage.removeItem(PENDING_IMAGE_KEY); }
    catch { notify("图片已收到，但等待记录无法清理；请下载原图保存", true); }
  }
  function stopImageWaiting() {
    stoppedWaitingRef.current = true;
    abortRef.current?.abort();
  }
  async function acceptGeneratedImage(image: string, model: string, task: PendingGeneration | null, requestStyle: string, requestRoom: string, sourcePlanKey?:string) {
    const record: RenderResult = { sourcePlanKey:task?.sourcePlanKey??sourcePlanKey,id: task?.recordId || uid(), image, model, style: task?.style || requestStyle, room: task?.room || requestRoom, time: localTime(), createdAt: Date.now() };
    setResults(items => [record, ...items.filter(item => item.id !== record.id)].slice(0, 4));
    setActiveResult(0); setModal("history-image");
    if (task) clearPending();
    try { await saveGeneratedImage(record); notify("图片已保存在本机历史记录中"); }
    catch { notify("效果图已生成，但浏览器保存失败，请立即下载原图", true); }
  }
  async function renderWithNewEra(camera:{x:number;y:number;z:number;look_at:[number,number,number];fov:number},renderPlan?:Plan) {
    if(newEraRendering||busy)return;
    const source=JSON.stringify(planRef.current);setNewEraRendering(true);notify('正在用 New Era 路径追踪当前视角，通常需要几分钟');
    try {
      const response=await fetch('/api/newera-render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan:renderPlan??JSON.parse(source),camera,quality:'good'}),signal:AbortSignal.timeout(12*60*1000)});
      const data=await response.json() as {image?:string;error?:string;warnings?:string[]};
      if(!response.ok||!data.image)throw new Error(data.error||'New Era 光追未能完成');
      const stale=JSON.stringify(planRef.current)!==source;
      if (stale) {
        const record: RenderResult = { id: uid(), image: data.image, model: 'newera-render-photo', style: 'New Era 光追 · 旧方案', room: room?.name || '提交时视角', time: localTime(), createdAt: Date.now() };
        setResults(items => [record, ...items].slice(0, 4));
        try { await saveGeneratedImage(record); notify('渲染期间方案已变化，旧方案图片已保存到最近生成记录。', true); }
        catch { notify('旧方案图片未能保存，请重新出图。', true); }
        return;
      }
      await acceptGeneratedImage(data.image,'newera-render-photo',null,'New Era 路径追踪',room?.name||'当前视角');
      notify(data.warnings?.[0]||'已生成 New Era 光追静帧，请核对模型和材质。',!!data.warnings?.length);
    }catch(error){notify(safeMessage(error),true);}finally{setNewEraRendering(false);}
  }
  async function downloadRoomsmithDrawing(selectedRoomId:string) {
    if (drawingBusy) return;
    setDrawingBusy(true); setDrawingWarnings([]);
    try {
      const response=await fetch('/api/roomsmith-drawing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan:planRef.current,roomId:selectedRoomId}),signal:AbortSignal.timeout(30000)});
      const result=await response.json() as {svg?:string;room?:string;warnings?:string[];error?:string};
      if(!response.ok||!result.svg)throw new Error(result.error||'单房间尺寸图生成失败');
      const url=URL.createObjectURL(new Blob([result.svg],{type:'image/svg+xml;charset=utf-8'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=`筑境-${(result.room||'房间').replace(/[\\/:*?"<>|]/g,'_')}-尺寸草图.svg`;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),10000);
      setDrawingWarnings(result.warnings||[]);notify('单房间尺寸草图已下载，请核对墙体、门窗和尺寸');
    }catch(error){notify(safeMessage(error),true);}finally{setDrawingBusy(false);}
  }
  async function generate(existingTask?: PendingGeneration) {
    if (busy) return;
    let task = existingTask || pendingGeneration;
    if (!task && !status?.imageConfigured) { setModal("settings"); return; }
    const controller = new AbortController(); abortRef.current = controller;
    stoppedWaitingRef.current = false;
    let timedOut = false;
    const startedAt = Date.now();
    const renderPlan=referenceImage&&currentResult?.sceneKey?validatePlan(JSON.parse(currentResult.sceneKey)[0]):plan;
    const renderSource=JSON.stringify([renderPlan,[...layers].sort()]);
    const requestStyle = style?.name || styleId;
    const requestRoom = room?.name || "全屋方案";
    setImagePhase(task ? "processing" : "starting");
    setBusy("generate");
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 8 * 60 * 1000);
    try {
      if (!task) {
        const response = await fetch("/api/generate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan:renderPlan, style: styleId, roomId: roomId === "all" ? undefined : roomId, prompt, referenceImage }), signal: controller.signal,
        });
        const data = await response.json() as { error?: string; image?: string; model?: string; status?: string; taskId?: string; taskToken?: string };
        if (!response.ok) throw new ImageTaskError(typeof data.error === "string" ? data.error : "效果生成请求未被受理，请检查服务状态", true);
        if (typeof data.image === "string" && data.image.startsWith("data:image/")) {
          await acceptGeneratedImage(data.image, data.model || status?.imageModel || "gpt-image-2", null, requestStyle, requestRoom,renderSource);
          return;
        }
        if ((response.status === 202 || data.status === "processing") && typeof data.taskId === "string" && typeof data.taskToken === "string" && data.taskId && data.taskToken) {
          task = { sourcePlanKey:renderSource,taskId: data.taskId, taskToken: data.taskToken, model: data.model || status?.imageModel || "gpt-image-2", style: requestStyle, room: requestRoom, createdAt: Date.now(), recordId: uid() };
          persistPending(task); setImagePhase("processing");
        } else throw new ImageTaskError("服务未返回图片或有效任务凭据，请检查生成记录后再提交", true);
      }
      while (task && !controller.signal.aborted) {
        await waitForPoll(Date.now() - startedAt < 15000 ? 3000 : 5000, controller.signal);
        const response = await fetch(`/api/generate?taskId=${encodeURIComponent(task.taskId)}`, { cache: "no-store", headers: { "X-Roomcraft-Task-Token": task.taskToken }, signal: controller.signal });
        let data: { error?: string; image?: string; model?: string; status?: string; warning?: string };
        try { data = await response.json() as typeof data; }
        catch { throw new ImageTaskError("连接暂时中断，任务可能仍在生成。请点击“继续等待”恢复。"); }
        if (!response.ok || data.status === "failed") {
          const definitive = data.status === "failed" || [400, 403, 404, 410, 422].includes(response.status);
          const message = typeof data.error === "string" ? data.error.replaceAll(task.taskToken, "[任务凭据]") : "暂时无法查询生成任务，请稍后继续等待";
          throw new ImageTaskError(message, definitive);
        }
        if (typeof data.image === "string" && data.image.startsWith("data:image/")) {
          await acceptGeneratedImage(data.image, data.model || task.model, task, requestStyle, requestRoom);
          if (data.warning) notify(data.warning);
          return;
        }
        if (data.status !== "processing" && data.status !== "pending" && data.status !== "queued") throw new ImageTaskError("任务状态暂不可用，请稍后继续等待");
      }
    } catch (error) {
      if (task && error instanceof ImageTaskError && error.definitive) {
        clearPending(); notify(error.message, true);
      } else if (task) {
        persistPending(task);
        notify(stoppedWaitingRef.current ? "已停止等待；后台任务可能继续，可点击“继续等待”恢复" : timedOut ? "已等待 8 分钟，任务已保留；可稍后继续等待，无需重复提交" : error instanceof ImageTaskError ? error.message : "连接中断，后台任务可能继续；已保留任务，可继续等待", true);
      } else {
        notify(stoppedWaitingRef.current ? "已停止等待，尚未收到任务凭据；服务端可能仍在处理，请先检查生成记录" : error instanceof ImageTaskError ? error.message : "连接中断，尚未收到任务凭据，请检查服务记录后再提交，避免重复费用", true);
      }
    } finally { clearTimeout(timeout); setBusy(null); abortRef.current = null; }
  }

  async function shareProject() {
    setSharing(true);
    try {
      const url = await createProjectShareUrl(validatePlan(planRef.current));
      setShareUrl(url); setModal("share");
      try { await navigator.clipboard.writeText(url); notify("可编辑项目分享链接已复制"); }
      catch { notify("链接已生成，可在窗口中选择并复制"); }
    } catch (error) { notify(safeMessage(error), true); }
    finally { setSharing(false); }
  }
  async function loadRecognizedSample() {
    if (busy) return;
    const controller = new AbortController(); abortRef.current = controller; setBusy("analyze");
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch("/api/recognize/sample", { signal: controller.signal });
      const data = await response.json() as { plan?: unknown; warnings?: string[]; sourceImage?: string; error?: string };
      if (!response.ok || !data.plan) throw new Error(data.error || "样例识别服务暂不可用");
      const nextPlan = validatePlan(data.plan);
      let image = data.sourceImage;
      if (image && !image.startsWith("data:")) {
        const source = await fetch(image, { signal: controller.signal });
        if (!source.ok) throw new Error("样例原图暂时无法载入");
        const blob = await source.blob(); image = await fileDataUrl(new File([blob], "prototype-floorplan.png", { type: blob.type || "image/png" }));
      }
      updatePlan(nextPlan, { replaceProject: true }); setSelectedId(null); setRoomId("all"); setWarnings(data.warnings || []);
      setBackgroundImage(image); setUploadName("原型样例户型 · CPU 识别"); setViewSafe("space");
      setModal(null); notify("样例已通过识别服务转换为可编辑结构，可进入漫游或校正数据");
    } catch (error) { notify(error instanceof Error && error.name === "AbortError" ? "样例识别已取消或超时，原方案保持不变" : safeMessage(error), true); }
    finally { clearTimeout(timeout); setBusy(null); abortRef.current = null; }
  }
  async function loadRealisticSample() {
    if (busy) return;
    const controller = new AbortController(); abortRef.current = controller; setBusy("analyze");
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const source = await fetch("/samples/realistic-room.png", { signal: controller.signal });
      if (!source.ok) throw new Error("写实样例原图暂时无法载入");
      const blob = await source.blob();
      const image = await fileDataUrl(new File([blob], "realistic-room.png", { type: blob.type || "image/png" }));
      const response = await fetch("/api/recognize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, provider: "cpu", knownWidthMeters: 6, name: "写实单间样例" }), signal: controller.signal });
      const data = await response.json() as { plan?: unknown; warnings?: string[]; error?: string };
      if (!response.ok || !data.plan) throw new Error(data.error || "写实样例识别未成功，原项目保持不变");
      const nextPlan = validatePlan(furnishRealisticSample(validatePlan(data.plan)));
      updatePlan(nextPlan, { replaceProject: true }); setSelectedId(null); setRoomId("all"); setWarnings(data.warnings || []);
      setBackgroundImage(image); setUploadName("写实单间样例 · CPU 实际识别"); setModal(null); setViewSafe("space");
      notify("单间已实际识别，并布置写实家具，可在三维空间自由漫游");
    } catch (error) { notify(error instanceof Error && error.name === "AbortError" ? "样例识别已取消或超时，原方案保持不变" : safeMessage(error), true); }
    finally { clearTimeout(timeout); setBusy(null); abortRef.current = null; }
  }
  function applyTemplate(template: Plan, reference: boolean) {
    const next = validatePlan(template);
    updatePlan(next); setRoomId('all'); setSelectedId(null); setDrawingRoomId('');
    setBackgroundImage(undefined); setUploadName(''); setWarnings([]); setReferenceImage(undefined);
    setLayers(['walls','furniture']); setModal(null); setViewSafe(reference ? 'space' : 'plan');
    if(reference)setStyleId('chinese');
    notify(`已打开${next.name}，可撤销回原方案`);
  }
  function newProject() {
    updatePlan({ version: 1, name: "未命名住宅", width: 12, depth: 10, rooms: [], walls: [], openings: [], furniture: [], nodes: [], routes: [], verified: false }, { replaceProject: true });
    setSelectedId(null); setRoomId("all"); setBackgroundImage(undefined); setUploadName(""); setWarnings([]); setResults([]); setModal(null); setViewSafe("plan");
    notify("新项目已建立，点击「画墙」开始绘制");
  }
  function loadSample() {
    updatePlan(clonePlan(SAMPLE_PLAN), { replaceProject: true }); setSelectedId(null); setRoomId("all"); setBackgroundImage(undefined); setUploadName(""); setWarnings([]); setResults([]); setModal(null); setViewSafe("plan");
    notify("已打开示例项目");
  }
  function addFurniture(kind: Furniture["kind"], name: string, size?: [number, number, number], stayInScene = false) {
    const defaults: Record<Furniture["kind"], [number, number, number]> = { sofa: [2.6, 0.95, 0.8], table: [1.6, 0.8, 0.75], bed: [1.8, 2, 0.55], cabinet: [1.8, 0.6, 2.4], chair: [0.55, 0.55, 0.85], plant: [0.5, 0.5, 1.3] };
    const [width, depth, height] = size || defaults[kind];
    const placement = findFurniturePlacement(plan, width, depth, roomId);
    if (!placement) { notify("房间内没有足够的空位放下这件家具，请调整尺寸或移动现有物件后再添加", true); return; }
    const furniture: Furniture = { id: uid(), kind, name, ...placement.point, width, depth, height, rotation: 0 };
    updatePlan({ ...plan, furniture: [...plan.furniture, furniture] });
    if (stayInScene) { setSelectedId(furniture.id); setRightTab("catalog"); } else { selectItem(furniture.id); setViewSafe("plan"); }
    setRoomId(placement.room.id); setLayers(items => items.includes("furniture") ? items : [...items, "furniture"]); setModal(null);
    notify(`已在${placement.room.name}的空位添加${name}`);
  }
  function restoreBeforeShare() {
    if (!beforeSharePlan) return;
    updatePlan(clonePlan(beforeSharePlan), { preserveReview: true, replaceProject: true }); setAutosavePaused(false);
    setSelectedId(null); setRoomId("all"); setBackgroundImage(undefined); setUploadName(""); setWarnings(beforeSharePlan.recognition?.warnings || []); setModal(null); setViewSafe("plan");
    notify("已恢复打开分享前的本机项目");
  }
  function addRoom() {
    const width = Math.min(3, plan.width), depth = Math.min(3, plan.depth);
    const nextRoom = { id: uid(), name: `新空间 ${plan.rooms.length + 1}`, x: Math.max(0, (plan.width - width) / 2), y: Math.max(0, (plan.depth - depth) / 2), width, depth };
    updatePlan({ ...plan, rooms: [...plan.rooms, nextRoom] });
    setRoomId(nextRoom.id); selectItem(nextRoom.id); setViewSafe("plan");
    notify("房间标注已添加，请在属性面板调整范围与名称；墙体需单独绘制");
  }
  function removeSelected() {
    if (!selectedId) return;
    try {
      updatePlan(validatePlan({ ...plan, walls: plan.walls.filter(item => item.id !== selectedId), openings: plan.openings.filter(item => item.id !== selectedId && item.wallId !== selectedId), furniture: plan.furniture.filter(item => item.id !== selectedId), nodes: plan.nodes.filter(item => item.id !== selectedId), routes: plan.routes.filter(item => item.id !== selectedId), rooms: plan.rooms.filter(item => item.id !== selectedId) }));
      if (roomId === selectedId) setRoomId("all");
      setSelectedId(null); setTool("select");
      notify("对象已删除，可使用撤销恢复");
    } catch { notify("当前项目参数无效，请先核对项目名称和尺寸", true); }
  }
  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (event.defaultPrevented || busy || modal || !selectedId || !["Delete", "Backspace"].includes(event.key)) return;
      const target = event.target as HTMLElement;
      if (target?.matches("input,textarea,select,[contenteditable=true]") || target?.closest('[role="dialog"]')) return;
      event.preventDefault(); removeSelected();
    };
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [plan, selectedId, busy, modal]);

  function markVerified() {
    setHistory(items => [...items.slice(-29), clonePlan(plan)]);
    setFuture([]); setPlan({ ...plan, verified: !plan.verified, ...(plan.recognition ? { recognition: { ...plan.recognition, needsReview: plan.verified } } : {}) });
    notify(plan.verified ? "已恢复为待核对状态" : "已标记尺寸核对；导出图纸仍为设计草稿");
  }

  function openCapability(action: CapabilityAction) {
    if (busy) return;
    if (action === 'upload' || action === 'house') {
      if (action === 'house') setRecognitionProvider('house');
      setModal(null); setPanelOpen(true); setViewSafe('plan');
      if (action === 'upload' || !backgroundImage) fileRef.current?.click();
      else notify('已选择 House 墙线识别，请校准总宽后点击“识别户型结构”');
      return;
    }
    if (action === 'furniture') { setModal('library'); return; }
    if (['correction', 'materials', 'export', 'settings'].includes(action)) { setModal(action as Modal); return; }
    setModal(null); setViewSafe(action as View);
    if (action === 'render') setEffectMode(currentResult ? 'image' : 'scene');
  }

  function applyCapabilityDraft(draft: Plan, source: string) {
    if (busy) throw new Error('请等待当前任务结束。');
    updatePlan(applyFurnitureDraft(planRef.current, source, draft));
    setSelectedId(null); setRoomId('all'); setModal(null);
    setLayers(items => items.includes('furniture') ? items : [...items, 'furniture']);
    setViewSafe('space');
    notify('新家具方案已应用，可逐件调整；点击撤销可恢复原布置');
  }

  return (
    <main className="workspace-shell">
      <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.dxf,.json" className="sr-only" aria-label="上传户型或打开项目" onChange={event => void handleUpload(event.target.files?.[0])} />
      <nav className="app-rail" aria-label="主导航">
        <a className="brand-symbol" href="/" aria-label="筑境设计工作台"><span /><span /><span /></a>
        <div className="rail-links">
          <button className={!modal ? "rail-button active" : "rail-button"} onClick={() => setModal(null)} title="设计工作台" aria-label="设计工作台"><PencilRuler size={21} /></button>
          <button className={modal === "files" ? "rail-button active" : "rail-button"} onClick={() => setModal("files")} title="项目文件" aria-label="项目文件"><FolderOpen size={21} /></button>
          <button className={modal === "library" ? "rail-button active" : "rail-button"} onClick={() => setModal("library")} title="家具素材" aria-label="家具素材"><Box size={21} /></button>
          <button className={modal === "capabilities" ? "rail-button active" : "rail-button"} onClick={() => setModal("capabilities")} title="设计能力" aria-label="设计能力"><Sparkles size={21} /></button>
        </div>
        <div className="rail-bottom">
          <button className="rail-button" onClick={() => setModal("help")} title="使用指南" aria-label="使用指南"><CircleHelp size={20} /></button>
          <button className="rail-button" onClick={() => setModal("settings")} title="服务设置" aria-label="服务设置"><Settings2 size={20} /></button>
          <div className="avatar" title="本地设计工作区">筑</div>
        </div>
      </nav>

      <div className="app-content">
        <header className="topbar">
          <div className="wordmark"><strong>筑境</strong><span>ROOMCRAFT</span><i>BETA</i></div>
          <div className="breadcrumb"><span>设计工作台</span><ChevronRight size={13} /><strong>{plan.name}</strong><span className="project-version">方案 A</span></div>
          <div className="topbar-actions">
            <span className="save-state"><span className="status-dot" />{autosavePaused ? "本机自动保存暂停" : savedAt ? `${savedAt} 已保存到本机` : "本地工作区"}</span>
            <button className="button button-light top-share" onClick={() => void shareProject()} disabled={sharing} aria-label="分享可编辑项目"><Share2 size={15} /><span>{sharing ? "生成链接" : "分享"}</span></button>
            <button className="button button-light top-save" onClick={() => { downloadProject(plan); notify("项目文件已下载"); }}><Save size={15} /><span>保存项目</span></button>
            <button className="button button-dark" onClick={() => setModal("export")}><ArrowDownToLine size={15} /><span>导出方案</span><ChevronDown size={13} /></button>
          </div>
        </header>

        {autosavePaused && <div className="autosave-paused-banner" role="status"><span>本机备份未能保存，自动保存已暂停。请下载当前项目，或恢复原本机项目。</span><button onClick={() => setModal("files")}>处理本机保存<ArrowRight size={12} /></button></div>}
        <div className={`workspace-body ${panelOpen ? "" : "project-panel-closed"}`}>
          <aside className="project-panel">
            <div className="project-panel-heading"><span className="eyebrow">YOUR SPACE, REIMAGINED</span><button className="icon-button" onClick={() => setPanelOpen(false)} aria-label="收起项目侧栏" title="收起侧栏"><PanelLeftClose size={16} /></button></div>
            <button className="project-title" onClick={() => setModal("files")}><div><h1>{plan.name}</h1><span>住宅空间 · 室内方案</span></div><ChevronDown size={16} /></button>
            <div className="project-stats"><span><strong>{formatArea(totalArea)}</strong> m²</span><i /><span>{plan.rooms.length} 个空间</span></div>

            <button className="upload-button" onClick={() => fileRef.current?.click()} disabled={!!busy}><Upload size={17} /><span>上传户型图</span><Plus size={15} /></button>
            <p className="format-hint">图片、PDF、DXF 或项目文件</p><button className="prototype-sample-button" onClick={() => setModal("templates")} disabled={!!busy}><Grid2X2 size={15}/><span>选常见户型</span><ArrowRight size={13}/></button>
            <button className="prototype-sample-button" onClick={() => void loadRecognizedSample()} disabled={!!busy}><ScanLine size={14} /><span>载入样例并识别</span><ArrowRight size={13} /></button>
            <button className="prototype-sample-button" onClick={()=>setModal("photo-study")}><Compass size={14}/><span>走进日光客厅</span><ArrowRight size={13}/></button>
            <button className="prototype-sample-button" onClick={() => void loadRealisticSample()} disabled={!!busy}><Sofa size={14} /><span>写实单间样例</span><ArrowRight size={13} /></button>
            {uploadName && <div className="imported-file"><FileImage size={14} /><span title={uploadName}>{uploadName}</span></div>}
            {backgroundImage && <><div className="recognition-method"><label><span>识别方式</span><select aria-label="识别方式" value={recognitionProvider} onChange={event => setRecognitionProvider(event.target.value as "cpu" | "vision" | "house")}><option value="cpu">CPU 轮廓识别</option><option value="vision">视觉模型识别</option><option value="house">House 墙线识别</option></select></label><label><span>外墙总宽 (m，可选)</span><input aria-label="识别校准外墙总宽" type="number" step=".1" min=".1" placeholder="按图上标注填写" value={knownWidthInput} onChange={event => setKnownWidthInput(event.target.value)} /></label></div>{recognitionProvider === 'house' && <p className="format-hint">仅识别候选墙线和门窗；房间需要手动校正。</p>}<button className="recognize-button" disabled={!!busy} onClick={() => void analyze()}>{busy === "analyze" ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}识别户型结构</button></>}
            <button className="correction-entry" disabled={!!busy} onClick={() => setModal("correction")}><RulerCorrectionIcon /><span>校正墙体、门窗与房间</span></button>

            {plan.building && <label style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,margin:'14px 0 2px',fontSize:11,color:'#6c7c5c'}}>装修楼层<select aria-label="当前编辑楼层" value={plan.building.activeFloor} onChange={event=>changeFloor(Number(event.target.value))} style={{maxWidth:110,padding:'6px',border:'1px solid #d7dfca',background:'#fbfcf6',borderRadius:5,color:'#526748'}}>{Array.from({length:plan.building.totalFloors},(_,i)=><option key={i+1} value={i+1}>第 {i+1} / {plan.building!.totalFloors} 层</option>)}</select></label>}
            <div className="section-label"><span>空间列表{plan.building?` · ${plan.building.activeFloor}F`:''}</span><div className="room-list-actions"><span className="small-count">{plan.rooms.length.toString().padStart(2, "0")}</span><button className="icon-button" title="添加房间标注区域" aria-label="添加房间标注区域" onClick={addRoom}><Plus size={13} /></button></div></div>
            <div className="room-list">
              <button className={roomId === "all" ? "room-button selected" : "room-button"} onClick={() => { setRoomId("all"); setSelectedId(null); }}><Grid2X2 size={16} /><span>全屋总览</span><ChevronRight size={13} /></button>
              {plan.rooms.map((item, index) => <button key={item.id} className={roomId === item.id ? "room-button selected" : "room-button"} onClick={() => { setRoomId(item.id); setSelectedId(item.id); }}><span className="room-number">{String(index + 1).padStart(2, "0")}</span><span>{item.name}</span><small>{formatArea(roomArea(item))} m²</small></button>)}
              {!plan.rooms.length && <p className="empty-room-hint">导入户型或绘制墙体，开始设计。</p>}
            </div>

            <div className="section-label layer-label"><span>图层管理</span><Layers2 size={14} /></div>
            <div className="layer-list">{LAYERS.map(item => <label key={item.id} className="layer-row"><input type="checkbox" checked={layers.includes(item.id)} onChange={() => toggleLayer(item.id)} /><span className="custom-checkbox">{layers.includes(item.id) && <Check size={10} />}</span><span className="layer-color" style={{ background: item.color }} /><span>{item.name}</span><item.icon size={13} /></label>)}</div>

            <div className="sidebar-bottom"><div className="draft-status"><span className={plan.verified ? "status-dot" : "status-dot amber"} />{plan.verified ? "已标记尺寸核对" : "设计草案 · 待尺寸核对"}</div><button onClick={markVerified}>{plan.verified ? "撤销核对标记" : "标记尺寸已核对"}<CheckCheck size={13} /></button></div>
          </aside>

          <section className="design-area" aria-label="设计画布">
            <div className="design-area-top"><div><div className="canvas-kicker"><span className="tiny-line" />DESIGN STUDIO</div><h2>{room?.name || "让空间，成为理想的生活。"}</h2></div><div className="design-area-actions"><button className="button button-light compact ai-layout-button" onClick={() => void designLayout()} disabled={!!busy} title="根据户型与所选风格，真实生成可编辑的家具布置；保留墙体、门窗与水电"><Sparkles size={14} />AI 布置</button><button className="button button-light compact" onClick={() => { if (view === "space" || (view === "render" && effectMode === "scene")) { setRightTab("catalog"); setCatalogTab("materials"); } else setModal("materials"); }}><Palette size={14} />材质库</button><button className="button button-light compact" onClick={() => { if (view === "space" || (view === "render" && effectMode === "scene")) { setRightTab("catalog"); setCatalogTab("furniture"); } else setModal("library"); }}><Plus size={14} />添加家具</button></div></div>

            <div className="canvas-stage" ref={stageRef}>
              <div className="canvas-topbar">
                <div className="view-tabs" role="tablist" aria-label="设计视图">
                  {([{ id: "plan", label: "平面设计", icon: Grid2X2 }, { id: "space", label: "三维空间", icon: Box }, { id: "photo", label: "全景预览", icon: Compass }, { id: "render", label: "AI 效果", icon: Sparkles }, { id: "professional", label: "专业编辑", icon: PencilRuler }] as const).map(item => <button key={item.id} role="tab" aria-selected={view === item.id} className={view === item.id ? "view-tab active" : "view-tab"} onClick={() => { if (item.id === "render") setEffectMode("scene"); if (item.id === "space" && view !== "space") setRightTab("catalog"); setViewSafe(item.id); }}><item.icon size={14} /><span>{item.label}</span></button>)}
                </div>
                <div className="canvas-top-actions"><button className="icon-button" title="撤销 Ctrl+Z" aria-label="撤销" onClick={undo} disabled={!history.length}><Undo2 size={16} /></button><button className="icon-button" title="重做 Ctrl+Shift+Z" aria-label="重做" onClick={redo} disabled={!future.length}><Redo2 size={16} /></button><span className="toolbar-divider" /><button className="icon-button" title="全屏画布" aria-label="全屏画布" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void stageRef.current?.requestFullscreen().catch(() => notify("当前浏览器不支持全屏，可使用浏览器缩放", true)); }}><Expand size={16} /></button></div>
              </div>

              <div className={`canvas-content canvas-content-${view}`}>
                {view === "plan" && <><PlanCanvas plan={plan} onChange={updatePlan} selectedId={selectedId} onSelect={selectItem} visibleLayers={layers} tool={tool} onToolChange={setToolFromCanvas} backgroundImage={backgroundImage} /><div className="canvas-identity"><span className="drawing-number">A—01</span><span>{room?.name || "原始结构与空间布置"}</span><span className="identity-unit">单位：米</span></div><div className="drawing-tools" aria-label="绘图工具">{([{ id: "select", label: "选择 / 移动", icon: MousePointer2 }, { id: "wall", label: "画墙", icon: PencilRuler }, { id: "door", label: "开门洞", icon: DoorOpen }, { id: "socket", label: "放置插座", icon: Zap }, { id: "water", label: "放置水点", icon: Droplets }, { id: "route-power", label: "绘制电路", icon: MoveUpRight }, { id: "route-water", label: "绘制水路", icon: SlidersHorizontal }] as const).map(item => <button key={item.id} title={item.label} aria-label={item.label} className={tool === item.id ? "drawing-tool active" : "drawing-tool"} onClick={() => { setTool(item.id); if(item.id==="door"){setSelectedId(null);setLayers(items=>items.includes("walls")?items:[...items,"walls"]);} if (["socket", "route-power"].includes(item.id)) setLayers(items => items.includes("power") ? items : [...items, "power"]); if (["water", "route-water"].includes(item.id)) setLayers(items => items.includes("coldWater") ? items : [...items, "coldWater"]); }}><item.icon size={18} /><span>{item.label}</span></button>)}</div></>}
                {view === "space" && <StagedSpace imageAvailable={!!status?.imageConfigured} onConfigure={()=>setModal("settings")} draftKey={sceneKey} styleId={styleId} brief={prompt} aiAvailable={!!status?.visionConfigured} onFinishedFrame={receiveReference} plan={plan} selectedId={selectedId} onSelect={selectItem} visibleLayers={layers} onPlanChange={updatePlan} onEnvironmentChange={updateEnvironment} onFloorChange={changeFloor} onFloorCountChange={changeFloorCount} onFloorHeightChange={changeFloorHeight} onNewEraRender={renderWithNewEra} newEraRendering={newEraRendering} onEditOpenings={() => setModal('openings')} />}
                {view === "photo" && <PhotoTour plan={plan} styleId={styleId} prompt={prompt} selectedRoomId={roomId} imageConfigured={!!status?.imageConfigured} onConfigure={() => setModal("settings")} />}
                {view === "professional" && <div className="professional-wrap"><div className="professional-notice"><PencilRuler size={14} /><span>可将当前户型导入 Pascal 专业编辑；导入后独立保存，尚不自动回写。</span></div><ProfessionalEditor plan={plan} /></div>}
                {view === "render" && <div className="effect-view"><div className="effect-toolbar"><div className="effect-switch" role="group" aria-label="效果查看方式"><button aria-pressed={effectMode === "scene"} onClick={() => setEffectMode("scene")}><Box size={13} />可编辑三维</button><button aria-pressed={effectMode === "image"} onClick={() => setEffectMode("image")}><ImageIcon size={13} />效果图对照{currentResult && <span className="effect-ready" />}</button></div><span>{effectMode === "scene" ? "拖动家具调整位置 · 拖动画布旋转视角" : currentResult ? "当前方案 · 已确认视角" : "等待三维出图"}</span></div><p className="effect-disclosure">完成三维设计、调好视角后，点击「确认三维并出图」。<button className="effect-template-link" onClick={()=>setModal("templates")}>选择户型或效果图样板</button></p>{effectMode === "scene" ? <div className="effect-scene"><StagedSpace imageAvailable={!!status?.imageConfigured} onConfigure={()=>setModal("settings")} draftKey={sceneKey} styleId={styleId} brief={prompt} aiAvailable={!!status?.visionConfigured} onFinishedFrame={receiveReference} plan={plan} selectedId={selectedId} onSelect={selectItem} visibleLayers={layers} onPlanChange={updatePlan} onEnvironmentChange={updateEnvironment} onFloorChange={changeFloor} onFloorCountChange={changeFloorCount} onFloorHeightChange={changeFloorHeight} onNewEraRender={renderWithNewEra} newEraRendering={newEraRendering} onEditOpenings={() => setModal('openings')} /></div> : <div className="render-stage effect-image-stage">{currentResult ? <EffectImageViewer imageConfigured={!!status?.imageConfigured} onConfigure={()=>setModal("settings")} key={currentResult.id} record={currentResult} image={currentResult.image} imageId={currentResult.id} alt={`${currentResult.room} · 已确认的三维视角`} styleLabel={currentResult.style} roomLabel={currentResult.room} onEdit={() => setEffectMode("scene")} onDownload={() => downloadImage(currentResult.image, `筑境-${currentResult.style}-${currentResult.id}.png`)} /> : <><div className="scene-empty"><Box size={30}/><h3>当前方案还没有效果图</h3><p>先完成三维布置，再从选好的视角出图。</p><button className="button button-dark" onClick={()=>setEffectMode("scene")}>返回三维设计</button></div></>}</div>}</div>}
                {busy && <div className="busy-overlay"><div className="busy-card"><div className="generation-orbit"><Sparkles size={24} /></div><h3>{busy === "generate" ? imagePhase === "processing" ? "设计任务已受理，正在生成" : "正在提交你的空间设计" : busy === "design" ? "正在设计家具与空间布置" : busy === "analyze" ? "正在读取户型结构" : "正在导入设计资料"}</h3><p>{busy === "generate" ? imagePhase === "processing" ? "后台正在生成真实效果，复杂空间可能需要几分钟。停止等待后仍可恢复。" : "提交一次真实生图请求，请稍候。" : busy === "design" ? "根据户型与风格规划可编辑家具，保留墙体、门窗及水电。" : busy === "analyze" ? "提取墙体、门窗与房间，请稍候。" : "解析文件内容与图纸数据，请稍候。"}</p><span className="elapsed-time">已等待 {elapsed} 秒</span>{busy !== "import" && <button className="text-button" onClick={() => busy === "generate" ? stopImageWaiting() : abortRef.current?.abort()}>{busy === "generate" ? "停止等待" : "取消当前请求"}</button>}</div></div>}
              </div>

              <div className="canvas-statusbar"><span><span className="status-dot" />{view === "plan" ? tool === "select" ? "点选墙体 / 线路即可删除 · 拖动家具可移动" : tool === "wall" ? "点击起点与终点 · 自动切回选择 · Shift 连续" : tool.startsWith("route-") ? "点击起点与终点 · 自动完成 · Shift 连续" : "点击画布放置点位" : view === "space" ? "拖动旋转 · 滚轮缩放 · 右键平移" : view === "photo" ? "全景图片环顾 · 房间节点切换 · 自由行走请使用三维空间" : view === "professional" ? "使用独立专业编辑器工具进行建模" : effectMode === "scene" ? "选中并拖动家具 · 拖动画布旋转" : "已确认视角 · 静帧对照"}</span><span>{view === "plan" ? "2D / 精确编辑" : view === "space" ? "3D / 实时预览" : view === "photo" ? "360° / 全景预览" : view === "render" ? "AI / 空间效果" : "3D / 专业建模"}<i />{formatArea(plan.width)} × {formatArea(plan.depth)} m</span></div>
            </div>

            <div className="workspace-footer"><div><span className="footer-brand">R.</span><span>好设计，始于每一处细节。</span></div><button onClick={() => setModal("capabilities")}>设计能力与技能<ArrowUpRightIcon /></button></div>
          </section>

          <aside className="inspector-panel" aria-label="设计面板">
            <div className="inspector-tabs three-tabs"><button className={rightTab === "design" ? "active" : ""} onClick={() => setRightTab("design")}><Sparkles size={14} />设计</button><button className={rightTab === "catalog" ? "active" : ""} onClick={() => setRightTab("catalog")}><Sofa size={14} />家具材质</button><button className={rightTab === "properties" ? "active" : ""} onClick={() => setRightTab("properties")}><SlidersHorizontal size={14} />属性</button></div>
            <div className="inspector-scroll">
              {rightTab === "catalog" ? <div className="scene-catalog">
                <div className="inspector-intro"><span className="eyebrow">FURNITURE & MATERIALS</span><h2>布置你的空间</h2><p>选择家具放入房间，或为对象更换材质。</p></div>
                <div className="catalog-tabs" role="group" aria-label="素材类别"><button aria-pressed={catalogTab === "furniture"} onClick={() => setCatalogTab("furniture")}><Sofa size={14} />家具</button><button aria-pressed={catalogTab === "materials"} onClick={() => setCatalogTab("materials")}><Palette size={14} />材质</button></div>
                {catalogTab === "furniture" ? <><label className="catalog-room"><span>放置到</span><select aria-label="家具放置房间" value={roomId} onChange={event => setRoomId(event.target.value)}><option value="all">自动寻找空位</option>{plan.rooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><p className="catalog-hint">点击添加，系统优先寻找所选房间空位；可在三维中拖动调整。</p><div className="catalog-grid">{FURNITURE_CATALOG.map(item => <button key={item.name} title={`添加${item.name}`} onClick={() => addFurniture(item.kind, item.name, item.size, true)}><span className={`catalog-symbol symbol-${item.kind}`}>{item.symbol}</span><strong>{item.name}</strong><small>{item.size[0]} × {item.size[1]} m</small><span className="catalog-plus"><Plus size={13} /></span></button>)}</div><p className="catalog-hint">家具为可调整尺寸的简化模型；矮凳、吧椅沿用座椅造型。</p></> : <MaterialLibrary inline key={`${selectedId || roomId}`} plan={plan} selectedId={selectedId || (roomId === "all" ? null : roomId)} onApply={next => updatePlan(next)} />}
              </div> : rightTab === "design" ? <>
                <div className="inspector-intro"><span className="eyebrow">DESIGN, WITH INTELLIGENCE</span><h2>把灵感，变成空间。</h2><p>保留空间逻辑，让每一种风格找到归属。</p></div>
                <label className="field-label" htmlFor="render-room">设计范围<span>01</span></label>
                <div className="select-wrap"><Home size={15} /><select id="render-room" value={roomId} onChange={event => setRoomId(event.target.value)}><option value="all">全屋空间</option>{plan.rooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></div>
                <label className="field-label style-label">选择空间风格<span>02</span></label>
                <div className="style-grid">{STYLE_OPTIONS.map((item, index) => <button key={item.id} className={styleId === item.id ? "style-card active" : "style-card"} onClick={() => setStyleId(item.id)} aria-pressed={styleId === item.id}><div className={`material-scene material-scene-${index % 6}`} style={{ "--style-accent": item.color } as React.CSSProperties}><span className="material-wall" /><span className="material-window" /><span className="material-sofa" /><span className="material-table" />{styleId === item.id && <span className="style-check"><Check size={10} /></span>}</div><strong>{item.name}</strong></button>)}</div>
                <p className="style-description">{style?.description}</p>
                <label className="field-label" htmlFor="design-prompt">告诉我你的想法<span>03</span></label>
                <div className="prompt-field"><textarea id="design-prompt" placeholder="例如：温暖的原木与微水泥，保留通透的客餐厅，让自然光充分进入……" value={prompt} onChange={event => setPrompt(event.target.value.slice(0, 2000))} rows={4} /><div><span>设计偏好 · 材质 · 氛围</span><span>{prompt.length}/2000</span></div></div>
                {pendingGeneration && <div className="pending-image-card" role="status"><div><Sparkles size={14} /><strong>有一个已受理的生图任务</strong></div><p>{pendingGeneration.style} · {pendingGeneration.room}<br />{new Date(pendingGeneration.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 提交</p><span>后台可能仍在生成。继续等待会查询原任务，不会再次提交。</span>{busy !== "generate" && <button className="button button-light" onClick={() => void generate(pendingGeneration)} disabled={!!busy}><RotateCcw size={13} />继续等待</button>}</div>}
                <button className="generate-button" onClick={()=>{if(view==='space'||(view==='render'&&effectMode==='scene')){const trigger=document.querySelector<HTMLButtonElement>('[data-scene-output]');if(trigger&&!trigger.disabled)trigger.click();else notify('请先打开质感空间，待三维加载完成后出图');}else{setEffectMode('scene');setViewSafe('render');}}}><Box size={17}/><span>{view==='space'||(view==='render'&&effectMode==='scene')?'确认三维并出图':'去三维设计并取景'}</span><ArrowRight size={16}/></button>
                <p className="generation-note">使用当前家具、门窗、材质与镜头。需要模拟光照时，可在三维中选择「光线追踪出图」。</p>
                {referenceImage&&currentResult&&<button className="button button-light" disabled={!!busy} onClick={()=>void generate()}>另做 AI 风格参考（可能改变布置）</button>}                {results.length > 0 && <div className="result-history"><div className="section-label"><span>最近生成记录 · 本机保存</span><span>{results.length}</span></div>{results.map((item, index) => <button key={item.id} className={activeResult === index ? "history-result active" : "history-result"} onClick={() => { setActiveResult(index); setModal("history-image"); }}><img src={item.image} alt="" /><span><strong>{item.style}</strong><small>{item.room} · {item.time}</small></span><ChevronRight size={13} /></button>)}</div>}
              </> : <>
                <div className="inspector-intro"><span className="eyebrow">EVERY DETAIL MATTERS</span><h2>空间细节</h2><p>选中画布中的对象，精确调整设计参数。</p></div>
                {!selectedWall && !selectedFurniture && !selectedNode && !selectedRoom && !selectedRoute ? <div className="empty-inspector"><MousePointer2 size={30} strokeWidth={1.2} /><strong>选择一个设计对象</strong><p>在平面图或三维空间中，点击墙体、家具或水电点位。</p><button className="button button-light" onClick={() => setViewSafe("plan")}>返回平面设计<ArrowRight size={13} /></button></div> : <>
                  <div className="object-heading"><span>{selectedWall ? "墙体" : selectedRoute ? "水电线路" : selectedFurniture ? "家具" : selectedNode ? "设备点位" : "房间"}</span><strong>{selectedFurniture?.name || selectedRoom?.name || (selectedRoute ? ROUTE_NAMES[selectedRoute.kind] || "水电线路" : selectedWall ? `墙体 ${plan.walls.findIndex(item => item.id === selectedId) + 1}` : selectedNode?.kind === "socket" ? "插座点位" : selectedNode?.kind === "light" ? "照明点位" : "水电点位")}</strong></div>
                  {selectedFurniture && <><TextField label="对象名称" value={selectedFurniture.name} onChange={name => updatePlan({ ...plan, furniture: plan.furniture.map(item => item.id === selectedId ? { ...item, name } : item) })} /><div className="property-grid">{(["x", "y", "width", "depth", "height", "rotation"] as const).map(key => <NumberField key={key} label={{ x: "X 位置", y: "Y 位置", width: "宽度", depth: "深度", height: "高度", rotation: "旋转" }[key]} value={selectedFurniture[key]} unit={key === "rotation" ? "°" : "m"} min={["width", "depth", "height"].includes(key) ? 0.05 : undefined} onChange={value => updatePlan({ ...plan, furniture: plan.furniture.map(item => item.id === selectedId ? { ...item, [key]: value } : item) })} />)}</div></>}
                  {selectedWall && <><div className="property-grid"><NumberField label="墙厚" value={selectedWall.thickness} min={0.05} onChange={thickness => updatePlan({ ...plan, walls: plan.walls.map(item => item.id === selectedId ? { ...item, thickness } : item) })} /><NumberField label="墙高" value={selectedWall.height} min={0.1} onChange={height => updatePlan({ ...plan, walls: plan.walls.map(item => item.id === selectedId ? { ...item, height } : item) })} />{(["start", "end"] as const).flatMap(point => (["x", "y"] as const).map(axis => <NumberField key={point + axis} label={`${point === "start" ? "起点" : "终点"} ${axis.toUpperCase()}`} value={selectedWall[point][axis]} onChange={value => updatePlan({ ...plan, walls: plan.walls.map(item => item.id === selectedId ? { ...item, [point]: { ...item[point], [axis]: value } } : item) })} />))}</div><div className="property-readout"><span>墙体长度</span><strong>{Math.hypot(selectedWall.end.x - selectedWall.start.x, selectedWall.end.y - selectedWall.start.y).toFixed(2)} m</strong></div></>}
                  {selectedNode && <div className="property-grid">{(["x", "y", "height"] as const).map(key => <NumberField key={key} label={{ x: "X 位置", y: "Y 位置", height: "离地高度" }[key]} value={selectedNode[key]} min={key === "height" ? 0 : undefined} onChange={value => updatePlan({ ...plan, nodes: plan.nodes.map(item => item.id === selectedId ? { ...item, [key]: value } : item) })} />)}</div>}
                  {selectedRoute && <><div className="property-readout"><span>线路类型</span><strong>{ROUTE_NAMES[selectedRoute.kind] || selectedRoute.kind}</strong></div><NumberField label="走线离地高度" value={selectedRoute.height} min={0} onChange={height => updatePlan({ ...plan, routes: plan.routes.map(item => item.id === selectedId ? { ...item, height } : item) })} /><TextField label="回路 / 线路备注" value={selectedRoute.circuit || ""} onChange={circuit => updatePlan({ ...plan, routes: plan.routes.map(item => item.id === selectedId ? { ...item, circuit } : item) })} /><div className="property-readout"><span>线路长度 / 节点</span><strong>{selectedRoute.points.reduce((sum, point, index, points) => index ? sum + Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) : sum, 0).toFixed(2)} m / {selectedRoute.points.length}</strong></div><p className="field-help">点击线段任意位置可选中。删除仅移除此条线路，不影响其他线路或设备点位。</p></>}
                  {selectedRoom && <><TextField label="空间名称" value={selectedRoom.name} onChange={name => updatePlan({ ...plan, rooms: plan.rooms.map(item => item.id === selectedId ? { ...item, name } : item) })} /><div className="property-grid">{(["x", "y", "width", "depth"] as const).map(key => <NumberField key={key} label={{ x: "X 位置", y: "Y 位置", width: "宽度", depth: "进深" }[key]} value={selectedRoom[key]} min={key === "width" || key === "depth" ? 0.1 : undefined} onChange={value => updatePlan({ ...plan, rooms: plan.rooms.map(item => item.id === selectedId ? resizeRoom(item, { [key]: value }) : item) })} />)}</div><p className="field-help">房间多边形是地面与面积依据；这里同步缩放多边形，墙体需单独校正。</p><button className="button button-light" onClick={() => setModal("correction")}><ScanLine size={13} />编辑边界顶点与门窗</button></>}
                  <button className="delete-object" data-testid="inspector-delete" onClick={removeSelected}><X size={13} />删除{selectedRoute ? ROUTE_NAMES[selectedRoute.kind] || "当前线路" : selectedWall ? "当前墙体" : "当前对象"}<span>Delete</span></button>
                </>}
                <details className="line-object-list" open={!!selectedWall || !!selectedRoute}><summary><span>墙体与线路列表</span><small>{plan.walls.length + plan.routes.length}</small></summary><p>线条重叠时，可从列表精确选中并删除。</p><div>{plan.walls.map((item, index) => <button key={item.id} className={selectedId === item.id ? "active" : ""} data-testid={`list-select-${item.id}`} onClick={() => { setSelectedId(item.id); setTool("select"); setViewSafe("plan"); setLayers(items => items.includes("walls") ? items : [...items, "walls"]); }}><PencilRuler size={12} /><span>墙体 {String(index + 1).padStart(2, "0")}</span><small>{Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y).toFixed(2)} m</small></button>)}{plan.routes.map((item, index) => <button key={item.id} className={selectedId === item.id ? "active" : ""} data-testid={`list-select-${item.id}`} onClick={() => { setSelectedId(item.id); setTool("select"); setViewSafe("plan"); setLayers(items => items.includes(item.kind) ? items : [...items, item.kind]); }}><span className="route-list-dot" style={{ background: LAYERS.find(layer => layer.id === item.kind)?.color || "#999" }} /><span>{ROUTE_NAMES[item.kind] || "线路"} {String(index + 1).padStart(2, "0")}</span><small>{item.points.reduce((sum, point, index, points) => index ? sum + Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) : sum, 0).toFixed(2)} m</small></button>)}</div></details>
                <div className="inspector-divider" /><div className="field-label">项目参数</div><TextField label="项目名称" value={plan.name} onChange={name => updatePlan({ ...plan, name })} /><div className="property-grid"><NumberField label="项目宽度" value={plan.width} min={1} onChange={width => updatePlan({ ...plan, width })} /><NumberField label="项目进深" value={plan.depth} min={1} onChange={depth => updatePlan({ ...plan, depth })} /></div>
              </>}
              {warnings.length > 0 && <div className="warning-panel"><strong>导入核对事项</strong>{warnings.slice(0, 6).map((warning, index) => <p key={index}>{warning}</p>)}</div>}
            </div>
            <div className="inspector-bottom"><span className="small-asterisk">✳</span><span>你负责创意，筑境帮你落笔。</span></div>
          </aside>
        </div>
        {!panelOpen && <button className="restore-panel icon-button" onClick={() => setPanelOpen(true)} title="展开项目侧栏" aria-label="展开项目侧栏"><FolderOpen size={17} /></button>}
      </div>

      {toast && <div className={toast.error ? "toast error" : "toast"} role={toast.error ? "alert" : "status"}>{toast.error ? <CircleHelp size={16} /> : <Check size={16} />}<span>{toast.text}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button></div>}

      {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}><section className={`workspace-modal modal-${modal === 'openings' ? 'correction' : modal}`} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><span className="eyebrow">ROOMCRAFT WORKSPACE</span><h2 id="modal-title">{({ "photo-study":"日光客厅 · 照片空间示例", "history-image":"历史出图 · 生成时的方案", templates: "选择常见户型", files: "你的设计项目", library: "家具与空间构件", settings: "AI 服务设置", help: "从户型，到理想空间", export: "导出设计方案", correction: "识别与几何校正", openings: "门窗设置", materials: "材质库", share: "分享可编辑项目", capabilities: "设计能力" })[modal]}</h2></div><button className="icon-button" onClick={() => setModal(null)} aria-label="关闭窗口"><X size={20} /></button></header>
        {modal === 'history-image' && archiveResult && <div className="effect-view archive-frame-view"><EffectImageViewer imageConfigured={!!status?.imageConfigured} onConfigure={()=>setModal("settings")} key={archiveResult.id} record={archiveResult} image={archiveResult.image} imageId={archiveResult.id} alt={archiveResult.room+' · 历史效果图'} styleLabel={archiveResult.style} roomLabel={archiveResult.room} onEdit={()=>{setModal(null);setEffectMode('scene');setViewSafe('render');}} onDownload={()=>downloadImage(archiveResult.image,`筑境-${archiveResult.id}.png`)} /></div>}

        {modal === 'photo-study' && <div style={{position:'relative',height:'min(66vh,680px)',minHeight:280}}><PhotoStudy image='/images/photo-tour-demo-v1.png' sample onExit={()=>setModal(null)} /></div>}
        {modal === 'templates' && <PlanPicker onApply={applyTemplate} />} 
        {modal === 'capabilities' && <DesignCapabilities plan={plan} styleId={styleId} initialBrief={prompt} hasImage={!!backgroundImage} busy={!!busy} onAction={openCapability} onApply={applyCapabilityDraft} />}
        {(modal === "correction" || modal === 'openings') && <RecognitionCorrection plan={plan} sourceImage={backgroundImage} warnings={warnings} initialSection={modal === 'openings' ? 'openings' : 'walls'} initialWallId={plan.walls.some(item => item.id === selectedId) ? selectedId! : undefined} onApply={next => { updatePlan(next, { preserveReview: true }); setWarnings(next.recognition?.warnings || warnings); setSelectedId(null); setModal(null); notify("校正数据已保存，二维与三维将同步重建"); }} />}
        {modal === "export" && <div style={{padding:'12px',margin:'12px 0',border:'1px solid #dfe5d6',borderRadius:8}}><strong>单房间尺寸草图</strong><p className="field-help">基于当前房间轮廓和家具生成 SVG 草图；门窗、比例及家具位置需核对，不是施工图。</p><div style={{display:'flex',gap:8,alignItems:'center'}}><select aria-label="尺寸草图房间" value={selectedDrawingRoomId} onChange={event=>setDrawingRoomId(event.target.value)} disabled={!plan.rooms.length} style={{flex:1,minWidth:0,padding:8,border:'1px solid #d8dfcd',borderRadius:6}}>{plan.rooms.length?plan.rooms.map(item=><option key={item.id} value={item.id}>{item.name}</option>):<option value="">请先添加房间</option>}</select><button className="button button-light" disabled={!selectedDrawingRoomId||drawingBusy} onClick={()=>void downloadRoomsmithDrawing(selectedDrawingRoomId)}><Download size={14}/>{drawingBusy?'正在生成':'下载 SVG'}</button></div>{drawingWarnings.length>0&&<p className="field-help" role="status">{drawingWarnings.join(' ')}</p>}</div>}
        {modal === "materials" && <MaterialLibrary plan={plan} selectedId={selectedId || (roomId === "all" ? null : roomId)} onApply={next => updatePlan(next)} />}
        {modal === "share" && <div className="project-share"><p className="modal-description">链接携带可编辑的户型、家具和材质数据；不包含模型密钥、原始户型图片或生成图片。接收方打开链接后可继续编辑。</p><label><span>项目分享链接</span><textarea aria-label="项目分享链接" readOnly value={shareUrl} rows={4} onFocus={event => event.target.select()} /></label><button className="button button-dark" onClick={() => { void navigator.clipboard.writeText(shareUrl).then(() => notify("分享链接已复制")).catch(() => notify("请选中上方链接并手动复制", true)); }}><Share2 size={14} />复制分享链接</button>{/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(shareUrl) && <p className="share-local-note">当前是本地地址，其他设备无法直接访问。部署或提供可访问的站点地址后，同样的分享数据才可跨设备打开。</p>}<p className="field-help">任何获得完整链接的人都能读取其中的设计数据，请只分享给需要的接收方。</p></div>}
        {modal === "files" && <><p className="modal-description">设计自动保存在当前浏览器。下载项目文件，可继续编辑或带到另一台设备。</p><div className="project-file-card"><span className="file-icon"><Home size={24} /></span><div><strong>{plan.name}</strong><span>{formatArea(totalArea)} m² · {plan.rooms.length} 个空间 · 当前项目</span></div><button className="button button-light" onClick={() => downloadProject(plan)}><Save size={14} />保存</button></div>{beforeSharePlan && <div className="before-share-backup"><div><strong>打开分享前的本机项目</strong><span>{beforeSharePlan.name}</span></div><button className="button button-light" onClick={restoreBeforeShare}><RotateCcw size={14} />恢复本机项目</button></div>}{autosavePaused && <p className="share-local-note">打开分享前的备份未能写入，本机自动保存已暂停以保留原项目。请下载当前分享项目，或先恢复本机项目。</p>}<div className="file-actions"><button onClick={newProject}><FilePlus2 size={24} /><strong>新建空白项目</strong><span>从墙体与空间开始</span><ArrowRight size={16} /></button><button onClick={() => fileRef.current?.click()}><FolderOpen size={24} /><strong>打开设计资料</strong><span>图片 / PDF / DXF / JSON</span><ArrowRight size={16} /></button><button onClick={loadSample}><Compass size={24} /><strong>探索示例项目</strong><span>体验完整空间与水电图层</span><ArrowRight size={16} /></button></div></>}
        {modal === "library" && <><p className="modal-description">添加参数化家具，在平面图中拖动，或在属性面板精确设置尺寸与角度。</p><div className="furniture-library">{([{ kind: "sofa", name: "三人沙发", detail: "2.6 × 0.95 m", symbol: "▱" }, { kind: "table", name: "长形餐桌", detail: "1.6 × 0.8 m", symbol: "▭" }, { kind: "bed", name: "双人床", detail: "1.8 × 2.0 m", symbol: "▰" }, { kind: "cabinet", name: "收纳柜", detail: "1.8 × 0.6 m", symbol: "▥" }, { kind: "chair", name: "单人座椅", detail: "0.55 × 0.55 m", symbol: "◧" }, { kind: "plant", name: "室内绿植", detail: "0.5 × 0.5 m", symbol: "✳" }] as const).map(item => <button key={item.kind} onClick={() => addFurniture(item.kind, item.name)}><span className={`furniture-symbol symbol-${item.kind}`}>{item.symbol}</span><strong>{item.name}</strong><small>{item.detail}</small><span className="furniture-add"><Plus size={14} /></span></button>)}</div></>}
        {modal === "settings" && <><p className="modal-description">模型连接由服务端管理。密钥不会出现在浏览器或设计文件中。</p><div className="service-card"><span className="service-icon"><Sparkles size={21} /></span><div><strong>室内效果生成</strong><span>{status?.imageModel || "OpenAI 图像生成模型"}</span></div><span className={status?.imageConfigured ? "service-badge connected" : "service-badge"}>{status?.imageConfigured ? "已配置" : "未配置"}</span></div><div className="service-card"><span className="service-icon"><ScanLine size={21} /></span><div><strong>本地 CPU 户型识别</strong><span>几何轮廓识别 · 无需模型密钥</span></div><span className={status?.cpuConfigured ? "service-badge connected" : "service-badge"}>{status?.cpuConfigured ? "已配置" : "未配置"}</span></div><div className="service-card"><span className="service-icon"><PencilRuler size={21} /></span><div><strong>视觉模型户型识别</strong><span>{status?.visionModel || "视觉识别模型"}</span></div><span className={status?.visionConfigured ? "service-badge connected" : "service-badge"}>{status?.visionConfigured ? "已配置" : "未配置"}</span></div><div className="settings-note"><strong>{statusError ? "暂时无法连接服务" : status?.imageConfigured ? "生图服务已就绪" : "生图服务尚未连接"}</strong><p>{status?.imageConfigured ? "上传户型、选择风格，即可发起真实生成。模型账户的额度和权限由服务端控制。异步任务受理后可停止等待，稍后继续查询同一任务。" : "请由部署者在服务器配置图像服务地址、模型与 API 密钥，再刷新连接状态。当前可正常编辑户型、查看三维并导出设计。"}</p></div><div className="settings-variable-help"><strong>服务端环境变量</strong><code>IMAGE_API_KEY · IMAGE_BASE_URL · IMAGE_MODEL</code><span>{status?.imageProtocol === "conflux_async" ? "当前使用中转站异步生图接口" : "当前使用标准图像生成接口"}{status?.imageProvider ? ` · ${status.imageProvider}` : ""}</span></div><button className="button button-dark" onClick={() => void refreshStatus()}><RotateCcw size={14} />刷新连接状态</button><p className="field-help">“已配置”表示服务端已提供连接参数，实际模型访问权限将在请求时核验。</p></>}
        {modal === "help" && <><p className="modal-description">一份空间数据，贯穿设计、预览与交付。</p><div className="help-steps">{[{ number: "01", title: "上传与校正户型", text: "点击“载入样例并识别”体验 CPU 识别到三维；也可上传图片、PDF 或 DXF。选择 CPU 或视觉识别后，在校正界面对照原图调整比例、墙体、门窗及房间多边形。" }, { number: "02", title: "设计每一个细节", text: "使用画墙、家具、插座和水点工具。点选后调整尺寸或删除；材质库可应用地面、墙面和家具材质。新增家具会优先寻找当前房间的可用空位。" }, { number: "03", title: "看见不同风格", text: "切换三维空间并截取参考视角，选取装修风格和材质偏好，使用真实模型生成效果图。" }, { number: "04", title: "核对后导出方案", text: "打开水电图层查看走线，下载 JSON 或通过链接分享可编辑项目。打开分享前会备份原本机项目，可在“项目文件”中恢复。导出 DXF 后仍需专业校核。" }].map(item => <div key={item.number}><span>{item.number}</span><section><h3>{item.title}</h3><p>{item.text}</p></section></div>)}</div><div className="keyboard-hints"><span><kbd>Ctrl</kbd> + <kbd>Z</kbd> 撤销</span><span><kbd>Ctrl</kbd> + <kbd>S</kbd> 下载项目</span><span><kbd>Esc</kbd> 退出工具</span></div></>}
        {modal === "export" && <><p className="modal-description">保存你的设计成果。水电走线和尺寸需结合现场条件校核后使用。</p><div className="export-options"><button onClick={() => { downloadProject(plan); notify("可编辑项目已下载"); }}><span className="export-icon"><FileCode2 size={23} /></span><div><strong>可编辑项目</strong><span>JSON · 保留全部空间、家具与图层数据</span></div><Download size={17} /></button><button onClick={() => { try { exportDXF(plan); notify("DXF 设计草稿已导出，请在 CAD 软件中复核"); } catch (error) { notify(safeMessage(error), true); } }}><span className="export-icon"><PencilRuler size={23} /></span><div><strong>CAD 平面设计草稿</strong><span>DXF · 墙体、家具、水电分层与尺寸，非完整施工图</span></div><Download size={17} /></button><button disabled={!currentResult} onClick={() => currentResult && downloadImage(currentResult.image, `筑境-${currentResult.style}.png`)}><span className="export-icon"><ImageIcon size={23} /></span><div><strong>三维效果原图</strong><span>{currentResult ? `${currentResult.style} · ${currentResult.room}` : "完成一次真实生成后可下载"}</span></div><Download size={17} /></button></div><div className="export-status"><span className={plan.verified ? "status-dot" : "status-dot amber"} /><span>{plan.verified ? "尺寸已核对 · 设计草稿" : "当前方案为待核对的设计草稿"}</span><button className="text-button" onClick={markVerified}>{plan.verified ? "撤销标记" : "标记尺寸核对"}</button></div></>}
      </section></div>}
    </main>
  );
}

function RulerCorrectionIcon() { return <ScanLine size={14} />; }
function ArrowUpRightIcon() { return <MoveUpRight size={12} />; }
function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="property-field"><span>{label}</span><input value={value} maxLength={80} onChange={event => onChange(event.target.value)} /></label>;
}
function NumberField({ label, value, onChange, unit = "m", min }: { label: string; value: number; onChange: (value: number) => void; unit?: string; min?: number }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  useEffect(() => { setDraft(String(Number(value.toFixed(3)))); }, [value]);
  return <label className="property-field"><span>{label}</span><div className="number-input"><input type="number" step={unit === "°" ? 5 : 0.05} min={min} value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => { const next = Number(draft); if (draft.trim() && Number.isFinite(next) && (min === undefined || next >= min) && Math.abs(next) <= 10000) { if (next !== value) onChange(next); } else setDraft(String(Number(value.toFixed(3)))); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /><small>{unit}</small></div></label>;
}
