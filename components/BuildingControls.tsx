"use client";

import { useState } from 'react';
import { Building2, Layers3, X } from 'lucide-react';
import type { Plan } from '@/lib/plan';
import './building-controls.css';

export type BuildingViewMode = 'floor' | 'cutaway' | 'building';
type Props = {
  plan: Plan; mode: BuildingViewMode;
  onModeChange: (mode: BuildingViewMode) => void;
  onFloorChange: (floor: number) => void;
  onCountChange: (count: number) => void;
  onHeightChange: (height: number) => void;
  onClose: () => void;
};

function DimensionInput({label,value,min,max,step=1,onCommit}:{label:string;value:number;min:number;max:number;step?:number;onCommit:(value:number)=>void}) {
  const [draft,setDraft]=useState<string|null>(null);
  const commit=()=>{const next=Number(draft);setDraft(null);if(draft!==null&&draft.trim()&&Number.isFinite(next)&&next>=min&&next<=max&&(step!==1||Number.isInteger(next)))onCommit(next);};
  return <label>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={draft??value} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape'){setDraft(null);event.currentTarget.blur();}}}/></label>;
}

export default function BuildingControls({plan,mode,onModeChange,onFloorChange,onCountChange,onHeightChange,onClose}:Props) {
  const total=plan.building?.totalFloors??1,active=plan.building?.activeFloor??1,height=plan.building?.floorHeight??3.2;
  return <section className="roomcraft-building-panel" role="group" aria-label="楼层与剖切设置">
    <header><strong><Building2 size={15}/>楼层与剖切</strong><button aria-label="关闭楼层设置" onClick={onClose}><X size={16}/></button></header>
    <div className="building-dimensions"><DimensionInput label="总楼层数" value={total} min={1} max={50} onCommit={onCountChange}/><DimensionInput label="每层高度（米）" value={height} min={2} max={12} step={.1} onCommit={onHeightChange}/></div>
    <label className="building-floor-select">正在装修<select aria-label="选择装修楼层" value={active} onChange={event=>onFloorChange(Number(event.target.value))}>{Array.from({length:total},(_,i)=><option key={i+1} value={i+1}>第 {i+1} 层</option>)}</select></label>
    <div className="building-mode" role="group" aria-label="建筑查看方式">{([['building','整栋外观'],['cutaway','楼层剖切'],['floor','只看本层']] as const).map(([value,label])=><button key={value} aria-pressed={mode===value} onClick={()=>onModeChange(value)}>{label}</button>)}</div>
    <label className="building-section-slider"><span><Layers3 size={13}/>剖切至第 {active} 层<output>{active} / {total}</output></span><input aria-label="楼层剖切" type="range" min={1} max={total} step={1} value={active} disabled={total===1} onChange={event=>{onModeChange('cutaway');onFloorChange(Number(event.target.value));}}/></label>
    <div className="building-elevation"><span>本层离地 <strong>{((active-1)*height).toFixed(1)} m</strong></span><span>建筑总高 <strong>{(total*height).toFixed(1)} m</strong></span></div>
    <p>剖切会隐藏本层上方楼层，可直接拖动家具、编辑本层装修。整栋外观中点击某一层，也可进入该层。</p>
    <p>未编辑楼层先沿用当前户型，首次进入后独立保存。其他楼层显示建筑轮廓；减少总层数会保留已编辑楼层，再增加时恢复。</p>
  </section>;
}
