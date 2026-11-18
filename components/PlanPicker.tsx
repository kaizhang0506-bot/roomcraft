import { useMemo, useState } from 'react';
import type { Plan } from '@/lib/plan';
import { COMMON_PLANS } from '@/lib/common-plans';
import { makeReferencePlan } from '@/lib/reference-plan';
import { roomPolygon, roomArea } from '@/lib/layout';
import './plan-picker.css';

function Thumbnail({plan}:{plan:Plan}) {
  return <svg aria-hidden="true" viewBox={`-0.45 -0.45 ${plan.width+.9} ${plan.depth+.9}`}><g>{plan.rooms.map((r,i)=><polygon key={r.id} points={roomPolygon(r).map(p=>`${p.x},${p.y}`).join(' ')} fill={['#ece5d5','#dce3d1','#f0dfc7','#e8dfd1','#d9e4df'][i%5]}/>)}</g>{plan.furniture.filter(f=>f.width>.6).map(f=><rect key={f.id} x={f.x-f.width/2} y={f.y-f.depth/2} width={f.width} height={f.depth} rx=".1" fill="#fff9eb" stroke="#ab9d85" strokeWidth=".045" transform={`rotate(${f.rotation} ${f.x} ${f.y})`}/>)}{plan.walls.map(w=><line key={w.id} x1={w.start.x} y1={w.start.y} x2={w.end.x} y2={w.end.y} stroke="#515746" strokeWidth={w.thickness}/>)}{plan.openings.map(o=>{const w=plan.walls.find(w=>w.id===o.wallId);if(!w)return null;const dx=w.end.x-w.start.x,dy=w.end.y-w.start.y,len=Math.hypot(dx,dy);if(!len)return null;const t=o.width/(2*len);return <line key={o.id} x1={w.start.x+dx*(o.position-t)} y1={w.start.y+dy*(o.position-t)} x2={w.start.x+dx*(o.position+t)} y2={w.start.y+dy*(o.position+t)} stroke={o.kind==='window'?'#92bebf':'#fcfaf3'} strokeWidth={w.thickness+.025}/>})}</svg>;
}
export default function PlanPicker({onApply}:{onApply:(plan:Plan,reference:boolean)=>void}) {
  const options=useMemo(()=>[...COMMON_PLANS,{id:'eastern-reference',title:'当代东方 · 效果图样板',description:'按参考图布置的全屋，可旋转、漫游和移动家具。',make:makeReferencePlan}].map(o=>({...o,preview:o.make()})),[]);
  const [selected,setSelected]=useState(options[0].id);
  const choice=options.find(o=>o.id===selected)!;
  return <div className="plan-picker"><p>选一个接近的户型开始设计。墙、门窗和家具都可以继续修改。</p><div className="plan-choice-grid">{options.map(o=><button type="button" key={o.id} aria-pressed={o.id===selected} onClick={()=>setSelected(o.id)}><Thumbnail plan={o.preview}/><strong>{o.title}</strong><small>{o.preview.rooms.reduce((n,r)=>n+roomArea(r),0).toFixed(1)} m² · {o.preview.rooms.length} 个空间</small></button>)}</div><p aria-live="polite">{choice.description}</p><footer><small>将替换当前画布，可撤销。</small><button className="button button-dark" onClick={()=>onApply(choice.make(),choice.id==='eastern-reference')}>使用此户型</button></footer></div>;
}
