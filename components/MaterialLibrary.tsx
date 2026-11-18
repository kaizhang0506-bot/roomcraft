"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import type { MaterialDefinition, Plan } from "@/lib/plan";
import { MATERIAL_LIBRARY } from "@/lib/materials";

type Props = { plan: Plan; selectedId: string | null; onApply: (plan: Plan) => void; inline?: boolean };
export default function MaterialLibrary({ plan, selectedId, onApply, inline = false }: Props) {
  const [category, setCategory] = useState<MaterialDefinition["category"]>(() => plan.walls.some(item => item.id === selectedId) ? "wall" : plan.furniture.some(item => item.id === selectedId) ? "furniture" : "floor");
  const [requestedTargetId, setTargetId] = useState(selectedId || plan.rooms[0]?.id || "");
  const [lastApplied, setLastApplied] = useState("");
  const materials = [...(plan.materials || MATERIAL_LIBRARY)];
  const targets = useMemo(() => category === "floor" ? plan.rooms.map(item => ({ id: item.id, name: item.name, materialId: item.floorMaterialId })) : category === "wall" ? [{ id: "all-walls", name: "全部墙体", materialId: "" }, ...plan.walls.map((item, index) => ({ id: item.id, name: `墙体 ${index + 1}`, materialId: item.materialId }))] : [{ id: "all-furniture", name: "全部家具", materialId: "" }, ...plan.furniture.map(item => ({ id: item.id, name: item.name, materialId: item.materialId }))], [category, plan.rooms, plan.walls, plan.furniture]);
  const targetId = targets.some(item => item.id === requestedTargetId) ? requestedTargetId : targets.find(item => item.id === selectedId)?.id || targets[0]?.id || "";
  const target = targets.find(item => item.id === targetId);
  function apply(material: MaterialDefinition) {
    const next = { ...plan, materials: materials.some(item => item.id === material.id) ? materials.map(item => item.id === material.id ? material : item) : [...materials, material], verified: false };
    if (category === "floor") next.rooms = plan.rooms.map(item => item.id === targetId ? { ...item, floorMaterialId: material.id } : item);
    else if (category === "wall") next.walls = plan.walls.map(item => targetId === "all-walls" || item.id === targetId ? { ...item, materialId: material.id } : item);
    else next.furniture = plan.furniture.map(item => targetId === "all-furniture" || item.id === targetId ? { ...item, materialId: material.id } : item);
    onApply(next); setLastApplied(`${target?.name || "当前对象"}：${material.name}`);
  }
  return <div className="material-library"><p className="modal-description">材质保存在项目结构中，应用后二维与三维同步更新；可继续编辑几何，不依赖生成图片。</p><div className="correction-tabs" role="tablist" aria-label="材质类别">{([{ id: "floor", name: "地面" }, { id: "wall", name: "墙面" }, { id: "furniture", name: "家具" }] as const).map(item => <button key={item.id} role="tab" aria-selected={category === item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div><label className="material-target"><span>应用到</span><select aria-label="材质应用对象" value={targetId} onChange={event => setTargetId(event.target.value)}>{targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{!targets.length && <p className="field-help">请先创建房间或家具，再应用材质。</p>}<div className="material-library-grid">{materials.filter(item => item.category === category).map(item => <button key={item.id} className={target?.materialId === item.id ? "material-option selected" : "material-option"} disabled={!targetId || (category === "furniture" && !plan.furniture.length) || (category === "wall" && !plan.walls.length)} onClick={() => apply(item)}><span className={`material-swatch pattern-${item.pattern}`} style={{ backgroundColor: item.color }} />{target?.materialId === item.id && <span className="material-selected"><Check size={12} /></span>}<strong>{item.name}</strong><small>{({ solid: "纯色", wood: "木纹", tile: "砖缝", stone: "石纹", carpet: "织物" })[item.pattern]} · 粗糙度 {item.roughness.toFixed(2)}</small></button>)}</div>{lastApplied && <p className="material-applied" role="status"><Check size={14} />已应用 {lastApplied}，{inline ? "三维空间已同步更新。" : "关闭窗口即可查看三维。"}</p>}</div>;
}
