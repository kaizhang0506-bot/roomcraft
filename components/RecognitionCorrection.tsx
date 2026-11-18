"use client";

import { useState } from "react";
import { Check, Plus, Ruler, Trash2 } from "lucide-react";
import { clonePlan, type Plan, type Point, type Room } from "@/lib/plan";
import { normalizePlan, roomArea, roomPolygon, scalePlan } from "@/lib/layout";
import { validatePlan } from "@/lib/validation";

type Props = { plan: Plan; sourceImage?: string; warnings: string[]; onApply: (plan: Plan) => void; initialSection?: 'walls' | 'openings' | 'rooms'; initialWallId?: string };
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
function describeError(error: unknown) {
  if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
    return error.issues.slice(0, 4).map((issue: { path?: (string | number)[]; message?: string }) => `${issue.path?.join(".") || "户型"}：${issue.message || "数据无效"}`).join("；");
  }
  return error instanceof Error ? error.message : "数据未通过校验，请检查后重试";
}
function Numeric({ label, value, onChange, min, max, step = .05 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const display = String(Number(value.toFixed(3)));
  const [text, setText] = useState(display);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  return <label className="correction-number"><span>{label}</span><input aria-label={label} type="number" value={editing ? text : display} step={step} min={min} max={max} onFocus={() => { setText(String(value)); setEditing(true); setDirty(false); }} onChange={event => { setText(event.target.value); setDirty(true); }} onBlur={() => { setEditing(false); const next = Number(text); if (dirty && text.trim() && Number.isFinite(next) && next !== value) onChange(next); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
}
function CorrectionPreview({ plan, selectedId, onSelect }: { plan: Plan; selectedId: string; onSelect: (kind: "walls" | "rooms" | "openings", id: string) => void }) {
  const points = [...plan.walls.flatMap(item => [item.start, item.end]), ...plan.rooms.flatMap(roomPolygon)];
  const minX = Math.min(0, ...points.map(item => item.x)) - .35, minY = Math.min(0, ...points.map(item => item.y)) - .35;
  const width = Math.max(plan.width, ...points.map(item => item.x)) - minX + .35, depth = Math.max(plan.depth, ...points.map(item => item.y)) - minY + .35;
  return <div className="correction-preview"><span>可编辑结构预览 · 点击选择</span><svg viewBox={`${minX} ${minY} ${width} ${depth}`} aria-label="校正中的墙体及房间结构">{plan.rooms.map(item => <polygon key={item.id} points={roomPolygon(item).map(p => `${p.x},${p.y}`).join(" ")} fill={selectedId === item.id ? "#cfdec2" : "#e8ecdf"} stroke="#9dad8b" strokeWidth={.035} onClick={() => onSelect("rooms", item.id)} />)}{plan.walls.map(item => <line key={item.id} x1={item.start.x} y1={item.start.y} x2={item.end.x} y2={item.end.y} stroke={selectedId === item.id ? "#b17d50" : "#5b6650"} strokeWidth={Math.max(.09, item.thickness)} strokeLinecap="round" onClick={() => onSelect("walls", item.id)} />)}{plan.openings.map(item => { const wall = plan.walls.find(w => w.id === item.wallId); if (!wall) return null; const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y, length = Math.hypot(dx, dy); if (!length) return null; const half = item.width / (2 * length), start = Math.max(0, item.position - half), end = Math.min(1, item.position + half); return <line key={item.id} x1={wall.start.x + dx * start} y1={wall.start.y + dy * start} x2={wall.start.x + dx * end} y2={wall.start.y + dy * end} stroke={selectedId === item.id ? "#bc8152" : item.kind === "door" ? "#d6c5a5" : "#8bb9c0"} strokeWidth={Math.max(.13, wall.thickness + .04)} onClick={() => onSelect("openings", item.id)} />; })}</svg></div>;
}

export default function RecognitionCorrection({ plan, sourceImage, warnings, onApply, initialSection = 'walls', initialWallId }: Props) {
  const initialOpenings = initialWallId ? plan.openings.filter(item => item.wallId === initialWallId) : plan.openings;
  const initialOpening = (initialSection === 'openings' ? initialOpenings.find(item => item.kind === 'window') : undefined) || initialOpenings[0];
  const [draft, setDraft] = useState(() => normalizePlan(clonePlan(plan)));
  const [section, setSection] = useState<"walls" | "openings" | "rooms">(initialSection);
  const [wallId, setWallId] = useState(initialWallId || (initialSection === 'openings' ? initialOpening?.wallId : undefined) || plan.walls[0]?.id || "");
  const [openingId, setOpeningId] = useState(initialOpening?.id || "");
  const [roomId, setRoomId] = useState(plan.rooms[0]?.id || "");
  const [knownWidth, setKnownWidth] = useState(plan.width);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const wall = draft.walls.find(item => item.id === wallId);
  const opening = draft.openings.find(item => item.id === openingId);
  const room = draft.rooms.find(item => item.id === roomId);
  const issues = [...new Set([...warnings, ...(plan.recognition?.warnings || [])])];
  const edit = (next: Plan) => { setDraft(normalizePlan({ ...next, verified: false })); setReviewed(false); setError(""); };
  const editWallPoint = (point: "start" | "end", axis: "x" | "y", value: number) => edit({ ...draft, walls: draft.walls.map(item => item.id === wallId ? { ...item, [point]: { ...item[point], [axis]: value } } : item) });
  function editRoomPolygon(polygon: Point[]) { edit({ ...draft, rooms: draft.rooms.map(item => item.id === roomId ? { ...item, polygon } : item) }); }
  function addWall() { const id = makeId("wall"); edit({ ...draft, walls: [...draft.walls, { id, start: { x: .3, y: .3 }, end: { x: 1.3, y: .3 }, thickness: .18, height: draft.ceilingHeight || 2.8 }] }); setWallId(id); }
  function addOpening(kind: "door" | "window") {
    const target = wall || draft.walls[0]; if (!target) { setError("请先添加一面墙，再放置门窗"); return; }
    const id = makeId(kind); const width = Math.min(kind === "door" ? .9 : 1.2, Math.hypot(target.end.x - target.start.x, target.end.y - target.start.y) * .7);
    edit({ ...draft, openings: [...draft.openings, { id, wallId: target.id, kind, position: .5, width: Math.max(.1, width), height: kind === "door" ? 2.1 : 1.2, sill: kind === "door" ? 0 : .8 }] }); setOpeningId(id);
  }
  function addRoom() { const id = makeId("room"); const width = Math.min(3, draft.width), depth = Math.min(3, draft.depth); const item: Room = { id, name: `空间 ${draft.rooms.length + 1}`, x: 0, y: 0, width, depth, polygon: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }] }; edit({ ...draft, rooms: [...draft.rooms, item] }); setRoomId(id); }
  function save() {
    try {
      const candidate = validatePlan({ ...draft, verified: reviewed, recognition: draft.recognition ? { ...draft.recognition, needsReview: !reviewed } : { provider: "manual", needsReview: !reviewed, warnings: issues } });
      onApply(candidate);
    } catch (error) { setError(describeError(error)); }
  }
  return <div className="recognition-correction">
    <p className="modal-description">对照原图修改墙段、门窗及房间多边形。保存后二维、三维和漫游都从这些可编辑数据重新生成。输入框以米显示，最多展示三位小数。</p>
    <div className="correction-layout">
      <aside className="correction-reference"><div className="correction-reference-image">{sourceImage ? <img src={sourceImage} alt="用于人工校正的原始户型图" /> : <div><Ruler size={30} /><p>未附原图，可直接校正结构数据。<br />上传户型图片后会在这里保留参考图。</p></div>}</div><div className="correction-summary"><span>墙体 {draft.walls.length}</span><span>门窗 {draft.openings.length}</span><span>房间 {draft.rooms.length}</span><strong>单位：米 · Schema 2</strong></div><CorrectionPreview plan={draft} selectedId={section === "walls" ? wallId : section === "openings" ? openingId : roomId} onSelect={(kind, id) => { setSection(kind); if (kind === "walls") setWallId(id); else if (kind === "openings") setOpeningId(id); else setRoomId(id); }} />{issues.length > 0 && <div className="correction-warnings"><strong>待核对事项</strong>{issues.slice(0, 12).map((issue, index) => <p key={index}>{issue}</p>)}</div>}</aside>
      <section className="correction-editor">
        <div className="correction-calibration"><h3>比例与层高</h3><p>外墙总宽应与原图尺寸标注一致。应用比例会同步缩放平面几何；门窗高度与层高独立校核。</p><div className="correction-calibration-row"><Numeric label="实际外墙总宽 (m)" value={knownWidth} min={.1} onChange={setKnownWidth} /><button className="button button-light" onClick={() => { try { edit(scalePlan(draft, knownWidth / draft.width)); } catch (error) { setError(describeError(error)); } }}>应用比例</button><Numeric label="默认层高 (m)" value={draft.ceilingHeight || 2.8} min={1.8} max={12} onChange={value => edit({ ...draft, ceilingHeight: value, walls: draft.walls.map(item => Math.abs(item.height - (draft.ceilingHeight || 2.8)) < .001 ? { ...item, height: value } : item) })} /></div></div>
        <div className="correction-tabs" role="tablist" aria-label="校正对象">{([{ id: "walls", text: "墙体" }, { id: "openings", text: "门窗" }, { id: "rooms", text: "房间边界" }] as const).map(item => <button key={item.id} role="tab" aria-selected={section === item.id} onClick={() => setSection(item.id)}>{item.text}</button>)}</div>
        {section === "walls" && <div className="correction-object"><div className="correction-object-picker"><select aria-label="选择校正墙体" value={wallId} onChange={event => setWallId(event.target.value)}><option value="">选择墙体</option>{draft.walls.map((item, index) => <option key={item.id} value={item.id}>墙体 {index + 1} · {Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y).toFixed(2)} m</option>)}</select><button className="button button-light" onClick={addWall}><Plus size={13} />新增墙段</button></div>{wall && <><div className="correction-number-grid">{(["start", "end"] as const).flatMap(point => (["x", "y"] as const).map(axis => <Numeric key={point + axis} label={`${point === "start" ? "起点" : "终点"} ${axis.toUpperCase()} (m)`} value={wall[point][axis]} onChange={value => editWallPoint(point, axis, value)} />))}<Numeric label="墙体厚度 (m)" value={wall.thickness} min={.05} onChange={value => edit({ ...draft, walls: draft.walls.map(item => item.id === wallId ? { ...item, thickness: value } : item) })} /><Numeric label="墙体高度 (m)" value={wall.height} min={.1} onChange={value => edit({ ...draft, walls: draft.walls.map(item => item.id === wallId ? { ...item, height: value } : item) })} /></div><button className="correction-delete" onClick={() => { edit({ ...draft, walls: draft.walls.filter(item => item.id !== wallId), openings: draft.openings.filter(item => item.wallId !== wallId) }); setWallId(""); }}><Trash2 size={13} />删除这面墙及其关联门窗</button></>}</div>}
        {section === "openings" && <div className="correction-object"><div className="correction-object-picker"><select aria-label="选择校正门窗" value={openingId} onChange={event => setOpeningId(event.target.value)}><option value="">选择门窗</option>{draft.openings.map((item, index) => <option key={item.id} value={item.id}>{item.kind === "door" ? "门" : "窗"} {index + 1}</option>)}</select><button className="button button-light" onClick={() => addOpening("door")}><Plus size={13} />添加门</button><button className="button button-light" onClick={() => addOpening("window")}><Plus size={13} />添加窗</button></div>{opening && <><label className="correction-select"><span>关联墙体</span><select aria-label="门窗关联墙体" value={opening.wallId} onChange={event => edit({ ...draft, openings: draft.openings.map(item => item.id === openingId ? { ...item, wallId: event.target.value } : item) })}>{draft.walls.map((item, index) => <option key={item.id} value={item.id}>墙体 {index + 1}</option>)}</select></label><div className="correction-number-grid"><Numeric label="沿墙中心位置 (%)" value={opening.position * 100} min={0} max={100} step={1} onChange={value => edit({ ...draft, openings: draft.openings.map(item => item.id === openingId ? { ...item, position: value / 100 } : item) })} />{(["width", "height", "sill"] as const).map(key => <Numeric key={key} label={{ width: "门窗宽度 (m)", height: "门窗高度 (m)", sill: "窗台 / 门槛高度 (m)" }[key]} value={opening[key]} min={key === "sill" ? 0 : .1} onChange={value => edit({ ...draft, openings: draft.openings.map(item => item.id === openingId ? { ...item, [key]: value } : item) })} />)}</div><button className="correction-delete" onClick={() => { edit({ ...draft, openings: draft.openings.filter(item => item.id !== openingId) }); setOpeningId(""); }}><Trash2 size={13} />删除这个门窗</button></>}</div>}
        {section === "rooms" && <div className="correction-object"><div className="correction-object-picker"><select aria-label="选择校正房间" value={roomId} onChange={event => setRoomId(event.target.value)}><option value="">选择房间</option>{draft.rooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="button button-light" onClick={addRoom}><Plus size={13} />添加房间</button></div>{room && <><label className="correction-select"><span>房间名称</span><input aria-label="校正房间名称" value={room.name} maxLength={100} onChange={event => edit({ ...draft, rooms: draft.rooms.map(item => item.id === roomId ? { ...item, name: event.target.value } : item) })} /></label><div className="polygon-heading"><strong>边界顶点 · 按顺序连接</strong><span>{roomArea(room).toFixed(2)} m²</span></div><div className="polygon-vertices">{roomPolygon(room).map((point, index, points) => <div key={index}><span>{String(index + 1).padStart(2, "0")}</span><Numeric label={`顶点 ${index + 1} X`} value={point.x} onChange={value => editRoomPolygon(points.map((p, i) => i === index ? { ...p, x: value } : p))} /><Numeric label={`顶点 ${index + 1} Y`} value={point.y} onChange={value => editRoomPolygon(points.map((p, i) => i === index ? { ...p, y: value } : p))} /><button aria-label={`删除顶点 ${index + 1}`} disabled={points.length <= 3} onClick={() => editRoomPolygon(points.filter((_, i) => i !== index))}><Trash2 size={13} /></button></div>)}</div><button className="text-button" onClick={() => { const points = roomPolygon(room), a = points[points.length - 1], b = points[0]; editRoomPolygon([...points, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }]); }}><Plus size={13} />添加边界顶点</button><p className="field-help">房间多边形是地面和面积的依据。边界不能自交；墙体位置需在“墙体”中单独校核。</p><button className="correction-delete" onClick={() => { edit({ ...draft, rooms: draft.rooms.filter(item => item.id !== roomId) }); setRoomId(""); }}><Trash2 size={13} />删除房间边界</button></>}</div>}
      </section>
    </div>
    {error && <p className="correction-error" role="alert">{error}</p>}
    <div className="correction-footer"><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /><span>我已逐项核对尺寸、墙体、门窗及房间边界（不代表施工图审核）</span></label><button className="button button-dark" onClick={save}><Check size={15} />保存校正数据</button></div>
  </div>;
}
