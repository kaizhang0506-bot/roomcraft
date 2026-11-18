"use client";

import { DoorOpen, Lightbulb, MousePointer2, X } from 'lucide-react';
import type { Plan } from '@/lib/plan';
import './building-controls.css';

export const openingIsOpen=(opening:Plan['openings'][number])=>opening.isOpen??opening.kind==='door';
export default function SceneInteractions({plan,automaticLightLevel,onOpeningToggle,onLightToggle,onLightReset,onClose}:{plan:Plan;automaticLightLevel:number;onOpeningToggle:(id:string)=>void;onLightToggle:(roomId:string)=>void;onLightReset:()=>void;onClose:()=>void}) {
  return <section className="roomcraft-building-panel" role="group" aria-label="门窗与灯光交互">
    <header><strong><MousePointer2 size={15}/>门窗与灯光</strong><button aria-label="关闭交互面板" onClick={onClose}><X size={16}/></button></header>
    <p style={{margin:'0 0 12px'}}>点击三维中的门扇、窗扇或墙上开关。漫游时靠近门窗，按 E 开关。</p>
    {(['door','window'] as const).map(kind=><div key={kind}><strong style={{display:'block',margin:'14px 0 8px'}}>{kind==='door'?'房门':'窗户'}</strong>{plan.openings.filter(opening=>opening.kind===kind).map((opening,index)=>{
      const open=openingIsOpen(opening),label=`${kind==='door'?'门':'窗'} ${index+1}`;
      return <div key={opening.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,margin:'7px 0'}}><span><DoorOpen size={12} style={{display:'inline',marginRight:6}}/>{label}<small style={{marginLeft:6,color:'#8a907d'}}>{opening.width.toFixed(2)} m</small></span><button aria-label={`${open?'关闭':'打开'}${label}`} aria-pressed={open} onClick={()=>onOpeningToggle(opening.id)} style={{padding:'5px 10px',border:'1px solid #d4ddc8',borderRadius:5,background:open?'#eaf0e0':'#fff',color:'#526a44',cursor:'pointer',fontSize:11}}>{open?'已打开 · 关闭':'已关闭 · 打开'}</button></div>;
    })}{!plan.openings.some(opening=>opening.kind===kind)&&<p>还没有{kind==='door'?'门':'窗'}，可在「门窗」中添加。</p>}</div>)}
    <strong style={{display:'block',margin:'18px 0 8px'}}>房间灯光</strong>
    {plan.rooms.map(room=><label key={room.id} style={{display:'flex',alignItems:'center',gap:6,margin:'10px 0'}}><Lightbulb size={13}/><span style={{flex:1}}>{room.name}{room.lightOn===undefined?' · 随环境':''}</span><input aria-label={`${room.name}灯光`} type="checkbox" checked={room.lightOn??automaticLightLevel>.01} onChange={()=>onLightToggle(room.id)} style={{accentColor:'#738a65'}}/></label>)}
    <button onClick={onLightReset} style={{width:'100%',marginTop:8,border:'1px solid #d9dfcf',borderRadius:6,background:'#fff',padding:8,color:'#65795a',fontSize:11,cursor:'pointer'}}>全部灯光恢复随环境</button>
    <p>关闭的门会阻挡通行，窗户不能穿越。家具支持选择、移动和材质编辑；柜门及电器运行暂未模拟。</p>
  </section>;
}
