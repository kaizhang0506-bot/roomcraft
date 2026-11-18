"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Check, Maximize2, Minus, Plus, RotateCw, Trash2 } from "lucide-react";
import type { Plan, Point } from "@/lib/plan";
import { validatePlan } from "@/lib/validation";
import { roomArea, roomLabelPoint, roomPolygon } from "@/lib/layout";
import { getMaterial } from "@/lib/materials";
import { locateDoor, doorInterior } from '@/lib/door-placement';
import { planBounds } from "@/lib/plan-bounds";

export interface PlanCanvasProps {
  plan: Plan;
  onChange: (plan: Plan) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  visibleLayers: string[];
  tool: string;
  onToolChange: (tool: string) => void;
  backgroundImage?: string;
}

const routeColors: Record<string, string> = {
  power: "#cb6851", lighting: "#ba9344", coldWater: "#4b8eaf", hotWater: "#c86c76", drain: "#777b85",
};
const objectNames: Record<string, string> = { door: "房门", window: "窗户", socket: "插座", water: "给水点", drain: "排水点", switch: "开关", light: "灯位", panel: "配电箱", power: "电力线路", lighting: "照明线路", coldWater: "冷水管", hotWater: "热水管" };
const toolNames: Record<string, string> = {
  door: "点击墙线放置门洞 · Esc 取消", select: "点击墙体或线路可选中删除", wall: "点击起点与终点 · 自动完成 · Shift 连续绘制", socket: "点击放置插座", water: "点击放置给水点",
  "route-power": "点击起点与终点绘制电路 · Shift 连续绘制", "route-water": "点击起点与终点绘制水管 · Shift 连续绘制",
};
const snap = (n: number) => Math.round(n * 20) / 20;
const id = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 7)}`;
const copy = (plan: Plan): Plan => JSON.parse(JSON.stringify(plan));
const nodeLayer = (kind: string) => kind === "water" ? "coldWater" : kind === "drain" ? "drain" : kind === "light" ? "lighting" : "power";

function FurnitureSymbol({ item, selected }: { item: Plan["furniture"][number]; selected: boolean }) {
  const { width: w, depth: d } = item;
  const line = selected ? "#bd634c" : "#8b8377";
  const fill = selected ? "#efe1d0" : "#e8e1d5";
  return <g transform={`translate(${item.x} ${item.y}) rotate(${item.rotation ?? 0})`}>
    {selected && <rect x={-w / 2 - .08} y={-d / 2 - .08} width={w + .16} height={d + .16} rx=".04" fill="none" stroke="#bd634c" strokeWidth=".018" strokeDasharray=".07 .04" />}
    {item.kind === "plant" ? <>
      <circle r={Math.min(w, d) / 2} fill="#dae0cf" stroke="#91a080" strokeWidth=".025" />
      <path d={`M0 ${-d * .35}Q${w * .5} 0 0 ${d * .35}Q${-w * .5} 0 0 ${-d * .35}M${-w * .35} 0Q0 ${d * .5} ${w * .35} 0Q0 ${-d * .5} ${-w * .35} 0`} fill="#a8b494" stroke="#859475" strokeWidth=".015" />
    </> : item.kind === "bed" ? <>
      <rect x={-w / 2} y={-d / 2} width={w} height={d} rx=".05" fill="#ddd3c1" stroke={line} strokeWidth=".025" />
      <rect x={-w / 2 + .07} y={-d / 2 + .08} width={w - .14} height={d - .16} rx=".04" fill="#f4f0e6" stroke={line} strokeWidth=".015" />
      <rect x={-w / 2 + .13} y={-d / 2 + .14} width={w * .36} height={d * .19} rx=".05" fill="#fffaf0" stroke={line} strokeWidth=".012" />
      <rect x={w * .01} y={-d / 2 + .14} width={w * .36} height={d * .19} rx=".05" fill="#fffaf0" stroke={line} strokeWidth=".012" />
      <path d={`M${-w / 2 + .07} ${-d * .05}H${w / 2 - .07}`} stroke={line} strokeWidth=".015" />
      <rect x={-w / 2 + .07} y={d * .18} width={w - .14} height={d * .2} fill="#c7b79d" opacity=".55" />
    </> : item.kind === "sofa" ? <>
      <rect x={-w / 2} y={-d / 2} width={w} height={d} rx=".1" fill={fill} stroke={line} strokeWidth=".025" />
      <rect x={-w / 2 + .12} y={-d / 2 + .15} width={w - .24} height={d - .27} rx=".06" fill="#f3ede1" stroke={line} strokeWidth=".018" />
      <path d={`M${-w / 6} ${-d / 2 + .16}V${d / 2 - .12}M${w / 6} ${-d / 2 + .16}V${d / 2 - .12}`} stroke={line} strokeWidth=".015" />
      <path d={`M${-w / 2 + .12} ${-d / 2 + .15}V${d / 2 - .12}M${w / 2 - .12} ${-d / 2 + .15}V${d / 2 - .12}`} stroke={line} strokeWidth=".035" />
    </> : item.kind === "table" ? <>
      <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={Math.min(w, d) * .2} fill="#d8c5a9" stroke={line} strokeWidth=".025" />
      <circle cx={w * .15} cy={-d * .05} r={Math.min(w, d) * .13} fill="#ece4d3" stroke={line} strokeWidth=".012" />
      <rect x={-w * .22} y={-d * .13} width={w * .17} height={d * .23} rx=".01" fill="#a7ad9a" />
    </> : item.kind === "chair" ? <>
      <rect x={-w / 2} y={-d / 2} width={w} height={d} rx=".09" fill={fill} stroke={line} strokeWidth=".025" />
      <path d={`M${-w / 2 + .07} ${-d / 2 + .08}H${w / 2 - .07}`} stroke={line} strokeWidth=".08" />
    </> : <>
      <rect x={-w / 2} y={-d / 2} width={w} height={d} rx=".02" fill="#d6c8b3" stroke={line} strokeWidth=".025" />
      <path d={`M0 ${-d / 2}V${d / 2}`} stroke={line} strokeWidth=".014" />
      <path d={`M-.06 -.07V.07M.06 -.07V.07`} stroke={line} strokeWidth=".02" />
    </>}
    {selected && [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y], i) => <rect key={i} x={x - .035} y={y - .035} width=".07" height=".07" fill="white" stroke="#bd634c" strokeWidth=".018" />)}
  </g>;
}

export default function PlanCanvas({ plan, onChange, selectedId, onSelect, visibleLayers, tool, onToolChange, backgroundImage }: PlanCanvasProps) {
  const patternPrefix = useId().replace(/:/g, "");
  const bounds = planBounds(plan);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; kind: "furniture" | "node"; dx: number; dy: number; pointerId: number; x:number; y:number; startX:number; startY:number } | null>(null);
  const lastHoverUpdate = useRef(0);
  const [dragPreview, setDragPreview] = useState<{id:string; x:number; y:number} | null>(null);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showBackground, setShowBackground] = useState(true);
  const [editError, setEditError] = useState("");
  const [placeOut,setPlaceOut]=useState(false);
  const movingDoor = tool === "door" ? plan.openings.find(o=>o.id===selectedId && o.kind==="door") : undefined;
  const previewDoor = tool === "door" && cursor ? locateDoor(plan,cursor,movingDoor) : null;
  const selectedDoor=plan.openings.find(o=>o.id===selectedId&&o.kind==='door');
  const selectedWall=selectedDoor&&plan.walls.find(w=>w.id===selectedDoor.wallId);
  const interior=selectedWall&&selectedDoor?doorInterior(plan,selectedWall,selectedDoor.position):null;
  const selectedOut=!!(selectedDoor&&interior&&(selectedDoor.swingSide??1)!==interior.side);
  function changeSwing(out:boolean) {
    if(!selectedDoor||!interior)return;
    onChange({...plan,verified:false,openings:plan.openings.map(o=>o.id===selectedDoor.id?{...o,swingSide:out?(interior.side===1?-1:1):interior.side}:o)});
  }
  const selected = plan.openings.find(o=>o.id===selectedId) ?? plan.furniture.find(f => f.id === selectedId) ?? plan.nodes.find(n => n.id === selectedId) ?? plan.walls.find(w => w.id === selectedId) ?? plan.routes.find(r => r.id === selectedId);

  const finish = useCallback(() => { setAnchor(null); setCursor(null); onToolChange("select"); }, [onToolChange]);
  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    const next = copy(plan);
    next.furniture = next.furniture.filter(f => f.id !== selectedId);
    next.nodes = next.nodes.filter(n => n.id !== selectedId);
    next.walls = next.walls.filter(w => w.id !== selectedId);
    next.openings = next.openings.filter(o => o.id !== selectedId && o.wallId !== selectedId);
    next.routes = next.routes.filter(r => r.id !== selectedId);
    next.verified = false;
    try { onChange(validatePlan(next)); onSelect(null); finish(); setEditError(""); }
    catch { setEditError("当前项目数据无效，请先核对项目名称与尺寸"); }
  }, [plan, selectedId, onChange, onSelect, finish]);
  useEffect(() => { setAnchor(null); setCursor(null); setEditError(""); }, [tool]);
  useEffect(() => {
    const cancelDrag=()=>{ const current=drag.current; drag.current=null; setDragPreview(null); if(current&&svgRef.current?.hasPointerCapture(current.pointerId))svgRef.current.releasePointerCapture(current.pointerId); };
    window.addEventListener("blur",cancelDrag);
    return ()=>window.removeEventListener("blur",cancelDrag);
  }, []);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || target?.matches("input,textarea,select,[contenteditable=true]") || target?.closest('[role="dialog"]')) return;
      if (event.key === "Escape") {
        const current=drag.current; drag.current=null; setDragPreview(null);
        if (current && svgRef.current?.hasPointerCapture(current.pointerId)) svgRef.current.releasePointerCapture(current.pointerId);
        finish();
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) { event.preventDefault(); removeSelected(); }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [finish, removeSelected, selectedId]);

  function point(event: ReactPointerEvent<SVGElement>): Point {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    const matrix = svg.getScreenCTM();
    const local = matrix ? p.matrixTransform(matrix.inverse()) : p;
    return { x: snap(local.x), y: snap(local.y) };
  }
  function startDrag(event: ReactPointerEvent<SVGElement>, item: { id: string; x: number; y: number }, kind: "furniture" | "node") {
    if (tool !== "select") return;
    event.stopPropagation(); event.preventDefault();
    const p = point(event);
    drag.current = { id: item.id, kind, dx: p.x - item.x, dy: p.y - item.y, pointerId: event.pointerId, x:item.x, y:item.y, startX:item.x, startY:item.y };
    svgRef.current?.setPointerCapture(event.pointerId);
    onSelect(item.id);
  }
  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const p = point(event);
    if (tool === "select") { onSelect(null); return; }
    if(tool==='door') {
      const target=locateDoor(plan,p,movingDoor);
      if(target.error||!target.w){setEditError(target.error||'请点击墙线');return;}
      const inward=doorInterior(plan,target.w,target.t).side; const swingSide=placeOut?(inward===1?-1:1):inward;
      const door={...(movingDoor??{id:id('door'),kind:'door' as const,width:.9,height:2.1,sill:0}),swingSide:swingSide as 1|-1,wallId:target.w.id,position:target.t};
      try {onChange(validatePlan({...plan,openings:[...plan.openings.filter(o=>o.id!==door.id),door],verified:false}));finish();onSelect(door.id);setEditError('');}catch{setEditError('无法保存门洞，请核对户型。');}return;
    }
    if (p.x < bounds.x || p.y < bounds.y || p.x > bounds.x + bounds.width || p.y > bounds.y + bounds.depth) return;
    const next = copy(plan);
    if (tool === "socket" || tool === "water") {
      const newId = id(tool);
      next.nodes.push({ id: newId, kind: tool === "socket" ? "socket" : "water", ...p, height: tool === "socket" ? .3 : .6 });
      next.verified = false; onChange(next); onSelect(newId); return;
    }
    if (!anchor) { setAnchor(p); return; }
    if (Math.hypot(p.x - anchor.x, p.y - anchor.y) < .1) return;
    let createdId: string | null = null;
    if (tool === "wall") {
      createdId = id("wall");
      next.walls.push({ id: createdId, start: anchor, end: p, height: plan.ceilingHeight ?? 2.8, thickness: .12, materialId: "plaster-warm" });
    } else if (tool === "route-power" || tool === "route-water") {
      createdId = id("route");
      next.routes.push({ id: createdId, kind: tool === "route-power" ? "power" : "coldWater", points: [anchor, p], height: tool === "route-power" ? .3 : .2, circuit: tool === "route-power" ? "待分配回路" : undefined });
    }
    if (!createdId) return;
    next.verified = false;
    try {
      onChange(validatePlan(next)); onSelect(createdId); setEditError("");
      if (event.shiftKey) setAnchor(p); else finish();
    } catch { setEditError("无法添加线条，请检查项目尺寸与构件数量"); }
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (!state && !anchor) {
      const now=performance.now();
      if(now-lastHoverUpdate.current<120)return;
      lastHoverUpdate.current=now;
      const p=point(event); setCursor(previous=>previous?.x===p.x&&previous.y===p.y?previous:p);
      return;
    }
    const p = point(event);
    if (anchor) setCursor(previous => previous?.x === p.x && previous.y === p.y ? previous : p);
    if (!state || state.pointerId !== event.pointerId) return;
    const x = Math.max(bounds.x, Math.min(bounds.x + bounds.width, snap(p.x - state.dx)));
    const y = Math.max(bounds.y, Math.min(bounds.y + bounds.depth, snap(p.y - state.dy)));
    if (state.x === x && state.y === y) return;
    state.x = x; state.y = y; setDragPreview({id:state.id,x,y});
  }
  function pointerUp(event: ReactPointerEvent<SVGSVGElement>, commit = true) {
    if (drag.current?.pointerId === event.pointerId) {
      if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
      const state = drag.current; drag.current = null; setDragPreview(null);
      if (commit && (state.x !== state.startX || state.y !== state.startY)) {
        const next = copy(plan);
        const item = (state.kind === "furniture" ? next.furniture : next.nodes).find(x => x.id === state.id);
        if (item) { item.x=state.x; item.y=state.y; next.verified=false; onChange(next); }
      }
    }
  }
  function rotateSelected() {
    const next = copy(plan); const item = next.furniture.find(f => f.id === selectedId);
    if (item) { item.rotation = ((item.rotation ?? 0) + 45) % 360; next.verified = false; onChange(next); }
  }

  const margin = 1.1;
  const vw = (bounds.width + margin * 2) / zoom;
  const vh = (bounds.depth + margin * 2) / zoom;
  const viewBox = `${bounds.x + bounds.width / 2 - vw / 2} ${bounds.y + bounds.depth / 2 - vh / 2} ${vw} ${vh}`;
  const buttonStyle: React.CSSProperties = { border: "1px solid #dedbd2", background: "#fffefa", color: "#5c5a52", width: 31, height: 31, display: "grid", placeItems: "center", borderRadius: 7, cursor: "pointer" };
  const imageTransform = plan.recognition?.imageTransform;

  return <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 420, overflow: "hidden", background: "#f3f2ec" }}>
    <svg ref={svgRef} viewBox={viewBox} role="img" aria-label="可编辑户型平面图" style={{ display: "block", width: "100%", height: "100%", minHeight: 420, touchAction: "none", cursor: tool === "select" ? "default" : "crosshair", userSelect: "none" }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event=>pointerUp(event)} onPointerCancel={event=>pointerUp(event,false)} onDoubleClick={() => { if (anchor) finish(); }}>
      <defs>
        <pattern id="roomcraft-grid" width=".25" height=".25" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r=".009" fill="#c9c8bf" /></pattern>
        {plan.rooms.map((room, index) => {
          const material = plan.materials?.find(m => m.id === room.floorMaterialId) ?? getMaterial(room.floorMaterialId, /卫|厨|阳台/.test(room.name) ? "tile-warm" : "oak-natural");
          const wood = material.pattern === "wood", size = wood ? .22 : .6;
          return <pattern key={room.id} id={`${patternPrefix}-floor-${index}`} width={size} height={wood ? 1.2 : size} patternUnits="userSpaceOnUse">
            <rect width={size} height={wood ? 1.2 : size} fill={material.color} />
            {(wood || material.pattern === "tile") && <path d={wood ? "M.22 0V1.2M0 1.2H.22" : "M.6 0V.6H0"} fill="none" stroke="#433b30" strokeOpacity=".18" strokeWidth=".008" />}
            {material.pattern === "stone" && <path d="M0 .48Q.2 .18 .3 .27T.6 .05M.2 .6Q.22 .35 .4 .3" fill="none" stroke="#6f6a64" strokeOpacity=".14" strokeWidth=".012" />}
            {material.pattern === "carpet" && <path d="M.04 .03h.03M.18 .2h.03M.4 .35h.025M.08 .49h.03M.5 .14h.02" stroke="#433b30" strokeOpacity=".14" strokeWidth=".015" />}
          </pattern>;
        })}
      </defs>
      <rect x={bounds.x + bounds.width / 2 - vw / 2} y={bounds.y + bounds.depth / 2 - vh / 2} width={vw} height={vh} fill="url(#roomcraft-grid)" />
      {backgroundImage && showBackground && <image data-testid="floorplan-background" href={backgroundImage} x={imageTransform ? -imageTransform.originPixels.x * imageTransform.metersPerPixel : 0} y={imageTransform ? -imageTransform.originPixels.y * imageTransform.metersPerPixel : 0} width={imageTransform ? imageTransform.imageWidth * imageTransform.metersPerPixel : plan.width} height={imageTransform ? imageTransform.imageHeight * imageTransform.metersPerPixel : plan.depth} preserveAspectRatio={imageTransform ? "none" : "xMidYMid meet"} opacity=".55" pointerEvents="none" />}
      {plan.rooms.map((room, index) => {
        const label = roomLabelPoint(room);
        return <g key={room.id} data-room-id={room.id} onPointerDown={event => { if (tool === "select") { event.stopPropagation(); onSelect(room.id); } }}>
          <polygon data-testid={`room-polygon-${room.id}`} data-material-id={room.floorMaterialId} points={roomPolygon(room).map(p => `${p.x},${p.y}`).join(" ")} fill={`url(#${patternPrefix}-floor-${index})`} opacity={backgroundImage && showBackground ? .52 : .9} stroke={selectedId === room.id ? "#bd634c" : "#ddd6c8"} strokeWidth={selectedId === room.id ? .045 : .015} />
          <text x={label.x} y={label.y - .08} textAnchor="middle" fontFamily="Arial, PingFang SC, Microsoft YaHei, sans-serif" fontSize=".19" fontWeight="500" fill="#6a655b">{room.name}</text>
          <text x={label.x} y={label.y + .17} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize=".145" fill="#655e53">{roomArea(room).toFixed(1)} m²</text>
        </g>;
      })}
      {visibleLayers.includes("furniture") && plan.furniture.map(item => <g key={item.id} onPointerDown={e => startDrag(e, item, "furniture")} style={{ cursor: tool === "select" ? "grab" : "inherit" }}><FurnitureSymbol item={dragPreview?.id===item.id ? {...item,x:dragPreview.x,y:dragPreview.y} : item} selected={item.id === selectedId} /></g>)}
      {visibleLayers.includes("walls") && <g>
        {plan.walls.map(wall => <g key={wall.id} data-object-kind="wall" data-object-id={wall.id} role="button" aria-label={`选择墙体 ${plan.walls.findIndex(w => w.id === wall.id) + 1}`} style={{ cursor: tool === "select" ? "pointer" : "inherit" }} onPointerDown={event => { if (tool === "select") { event.stopPropagation(); onSelect(wall.id); } }}>
          <line x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y} stroke={wall.id === selectedId ? "#bc654f" : "#494940"} strokeWidth={wall.thickness || .12} strokeLinecap="square" />
          <line x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y} data-testid={`wall-hit-${wall.id}`} stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" pointerEvents="stroke" strokeLinecap="round" />
        </g>)}
        {plan.openings.map(opening => {
          const wall = plan.walls.find(w => w.id === opening.wallId); if (!wall) return null;
          const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
          const along = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) * opening.position;
          const x = wall.start.x + Math.cos(angle) * along;
          const y = wall.start.y + Math.sin(angle) * along;
          const w = opening.width;
          return <g key={opening.id} data-opening-id={opening.id} data-opening-open={opening.isOpen??opening.kind==='door'} transform={`translate(${x} ${y}) rotate(${angle * 180 / Math.PI})`} pointerEvents={tool==="select"?"all":"none"} onPointerDown={e=>{if(tool==="select"){e.stopPropagation();onSelect(opening.id);}}}>
            <rect x={-w / 2} y={-wall.thickness / 2 - .012} width={w} height={wall.thickness + .024} fill="#f4f1e8" />
            {opening.kind === "window" ? <>
              <rect x={-w / 2} y={-wall.thickness / 2} width={w} height={wall.thickness} fill="#dce8e7" stroke="#7d9e9e" strokeWidth=".018" />
              <line x1={-w / 2} x2={w / 2} y1="0" y2="0" stroke="#7d9e9e" strokeWidth=".014" />
              <line x1="0" x2="0" y1={-wall.thickness / 2} y2={wall.thickness / 2} stroke="#7d9e9e" strokeWidth=".018" />
              {opening.isOpen && <path d={`M${-w/2} 0 l${w*.2} ${w*.45} M${w/2} 0 l${-w*.2} ${w*.45}`} fill="none" stroke="#7d9e9e" strokeWidth=".025"/>}
            </> : opening.isOpen===false ? <line x1={-w/2} y1="0" x2={w/2} y2="0" stroke="#988978" strokeWidth=".045"/> : <g data-swing-side={opening.swingSide??1} transform={`scale(1 ${opening.swingSide??1})`}>
              <line x1={-w / 2} y1="0" x2={-w / 2} y2={w} stroke="#988978" strokeWidth=".035" />
              <path d={`M${w / 2} 0 A${w} ${w} 0 0 1 ${-w / 2} ${w}`} fill="none" stroke="#a99d89" strokeWidth=".018" />
            </g>}
          </g>;
        })}
      </g>}
      {plan.routes.filter(route => visibleLayers.includes(route.kind)).map(route => <g key={route.id} data-object-kind="route" data-object-id={route.id} role="button" aria-label={`选择${objectNames[route.kind] ?? "水电线路"}`} style={{ cursor: tool === "select" ? "pointer" : "inherit" }} onPointerDown={event => { if (tool === "select") { event.stopPropagation(); onSelect(route.id); } }}>
        <polyline points={route.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={selectedId === route.id ? "#b25239" : routeColors[route.kind] ?? "#888"} strokeWidth={selectedId === route.id ? .10 : .045} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={route.kind === "lighting" ? ".12 .07" : undefined} />
        <polyline data-testid={`route-hit-${route.id}`} points={route.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" pointerEvents="stroke" strokeLinecap="round" strokeLinejoin="round" />
        {route.points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={selectedId === route.id ? .065 : .038} fill={selectedId === route.id ? "#b25239" : routeColors[route.kind]} pointerEvents="none" />)}
      </g>)}
      {plan.nodes.filter(node => visibleLayers.includes(nodeLayer(node.kind))).map(node => <g key={node.id} transform={`translate(${dragPreview?.id===node.id?dragPreview.x:node.x} ${dragPreview?.id===node.id?dragPreview.y:node.y})`} onPointerDown={event => startDrag(event, node, "node")} style={{ cursor: tool === "select" ? "grab" : "inherit" }}>
        {selectedId === node.id && <circle r=".2" fill="none" stroke="#bd634c" strokeWidth=".02" strokeDasharray=".04 .025" />}
        <circle r=".12" fill="#fffcf5" stroke={routeColors[nodeLayer(node.kind)]} strokeWidth=".025" />
        {node.kind === "light" ? <path d="M-.06 -.06L.06 .06M.06 -.06L-.06 .06" stroke={routeColors.lighting} strokeWidth=".025" /> : node.kind === "water" || node.kind === "drain" ? <text y=".055" textAnchor="middle" fontSize=".16" fill={routeColors[nodeLayer(node.kind)]} fontFamily="Arial">{node.kind === "water" ? "W" : "D"}</text> : <path d="M-.045 -.04V.035M.045 -.04V.035M-.06 .07H.06" stroke={routeColors.power} strokeWidth=".025" />}
      </g>)}
      <g pointerEvents="none" fill="none" stroke="#b8b5a9" strokeWidth=".012">
        <path d={`M0 -.35V-.65M${plan.width} -.35V-.65M0 -.5H${plan.width}M-.35 0H-.65M-.35 ${plan.depth}H-.65M-.5 0V${plan.depth}`} />
        {[0, plan.width].map(x => <path key={x} d={`M${x - .06} -.44L${x + .06} -.56`} />)}
        {[0, plan.depth].map(y => <path key={y} d={`M-.56 ${y + .06}L-.44 ${y - .06}`} />)}
        <text x={plan.width / 2} y="-.57" textAnchor="middle" fill="#8c887b" stroke="none" fontSize=".14" fontFamily="Arial">{Math.round(plan.width * 1000)} mm</text>
        <text transform={`translate(-.6 ${plan.depth / 2}) rotate(-90)`} textAnchor="middle" fill="#8c887b" stroke="none" fontSize=".14" fontFamily="Arial">{Math.round(plan.depth * 1000)} mm</text>
      </g>
      {anchor && <g pointerEvents="none">
        <circle cx={anchor.x} cy={anchor.y} r=".065" fill="#bc654f" />
        {cursor && <><line x1={anchor.x} y1={anchor.y} x2={cursor.x} y2={cursor.y} stroke={tool === "route-water" ? routeColors.coldWater : "#bd634c"} strokeWidth={tool === "wall" ? .1 : .04} strokeDasharray=".09 .05" opacity=".7" /><text x={(anchor.x + cursor.x) / 2} y={(anchor.y + cursor.y) / 2 - .12} fill="#a65340" fontSize=".15" textAnchor="middle">{Math.hypot(cursor.x - anchor.x, cursor.y - anchor.y).toFixed(2)} m</text></>}
      </g>}
      {previewDoor?.w && <g pointerEvents="none" transform={`translate(${previewDoor.x} ${previewDoor.y}) rotate(${previewDoor.angle})`}><line x1={-previewDoor.width/2} x2={previewDoor.width/2} stroke={previewDoor.error?'#bc4e37':'#4c8753'} strokeWidth=".19" strokeLinecap="round"/><path d={`M${-previewDoor.width/2} 0 v${previewDoor.width*doorInterior(plan,previewDoor.w,previewDoor.t).side*(placeOut?-1:1)}`} stroke={previewDoor.error?"#bc4e37":"#4c8753"} strokeWidth=".05"/></g>}
    </svg>
    <div style={{ position: "absolute", top: 17, right: 17, display: "flex", gap: 5 }}>
      {backgroundImage && <button style={{ ...buttonStyle, width: "auto", padding: "0 10px", fontSize: 11 }} onClick={() => setShowBackground(!showBackground)}>{showBackground ? "隐藏底图" : "显示底图"}</button>}
      <button style={buttonStyle} title="缩小" aria-label="缩小平面图" onClick={() => setZoom(z => Math.max(.5, z - .2))}><Minus size={14} /></button>
      <button style={buttonStyle} title="放大" aria-label="放大平面图" onClick={() => setZoom(z => Math.min(3, z + .2))}><Plus size={14} /></button>
      <button style={buttonStyle} title="适应画布" aria-label="恢复平面图视角" onClick={() => setZoom(1)}><Maximize2 size={13} /></button>
    </div>
    {tool==='door' && <div className="door-swing-placement" role="group" aria-label="新位置开门方向"><span>开门方向</span>{[false,true].map(out=><button key={String(out)} aria-pressed={placeOut===out} onClick={()=>setPlaceOut(out)}>{out?'向外开':'向内开'}</button>)}<small>{previewDoor?.w ? doorInterior(plan,previewDoor.w,previewDoor.t).name||'按图示侧' : '点墙放置'}</small></div>}
    {selected && tool === "select" && <div data-testid="selection-actions" role="toolbar" aria-label="选中对象操作" style={{ position: "absolute", left: 16, top: 60, maxWidth: "calc(100% - 32px)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 9px 8px 13px", border: "1px solid #d6b59b", borderRadius: 8, background: "#fffefa", boxShadow: "0 4px 20px #39352b18", fontSize: 12, zIndex: 10 }}>
      <span style={{ color: "#666156" }}>{"name" in selected ? selected.name : "kind" in selected ? objectNames[selected.kind] ?? "节点" : `墙体 ${plan.walls.findIndex(wall => wall.id === selectedId) + 1}`}</span>
      {selectedDoor&&interior&&<div className="door-swing-setting" role="group" aria-label="开门方向"><small>{interior.name?`以${interior.name}为内`:'按图示侧'}</small>{[false,true].map(out=><button key={String(out)} aria-pressed={out===selectedOut} onClick={()=>changeSwing(out)}>{out?'向外开':'向内开'}</button>)}</div>}
      {plan.openings.some(o=>o.id===selectedId && o.kind==="door") && <button className="button button-light" onClick={()=>{setPlaceOut(selectedOut);onToolChange("door");}}>移动门洞</button>}
      {plan.furniture.some(f => f.id === selectedId) && <button aria-label="旋转家具45度" title="旋转45°" style={{ ...buttonStyle, width: 27, height: 27 }} onClick={rotateSelected}><RotateCw size={13} /></button>}
      <button data-testid="delete-selection" aria-label="删除选中对象" title="删除对象 · Delete / Backspace" style={{ ...buttonStyle, width: "auto", height: 31, padding: "0 11px", display: "flex", gap: 6, borderColor: "#e7c7b7", color: "#a8422e", background: "#fff1e9", fontWeight: 600 }} onClick={removeSelected}><Trash2 size={14} />删除</button><span style={{ color: "#a69988", fontSize: 9 }}>Delete / Backspace</span>
    </div>}
    {editError && <div role="alert" style={{ position: "absolute", left: 16, right: 16, top: 112, padding: 10, background: "#fff3e7", color: "#9c4e35", borderRadius: 5, fontSize: 11, zIndex: 11 }}>{editError}</div>}
    <div style={{ position: "absolute", left: 18, bottom: 15, right: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, pointerEvents: "none" }}>
      <span style={{ color: "#8d897d", fontSize: 10 }}>{toolNames[tool] ?? "选择 / 拖动家具"}{tool === "select" ? " · 5 cm 网格吸附" : ""}</span>
      {anchor ? <button style={{ ...buttonStyle, width: "auto", height: 28, padding: "0 10px", display: "flex", gap: 5, pointerEvents: "auto", fontSize: 11 }} onClick={finish}><Check size={12} />完成绘制</button> : <span style={{ color: "#979184", fontSize: 10, fontVariantNumeric: "tabular-nums" }}>{Math.round(zoom * 100)}%{cursor ? ` · ${cursor.x.toFixed(2)}, ${cursor.y.toFixed(2)}` : ""}</span>}
    </div>
  </div>;
}
