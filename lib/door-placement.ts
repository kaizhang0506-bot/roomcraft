import {roomArea,roomPolygon,pointInPolygon} from './layout';
import type { Plan, Point, Opening } from './plan';
export function locateDoor(plan:Plan,point:Point,moving?:Opening) {
  const width=moving?.width??.9,height=moving?.height??2.1;
  const near=plan.walls.map(w=>{const dx=w.end.x-w.start.x,dy=w.end.y-w.start.y,l=Math.hypot(dx,dy);const t=l?Math.max(0,Math.min(1,((point.x-w.start.x)*dx+(point.y-w.start.y)*dy)/(l*l))):0;const x=w.start.x+dx*t,y=w.start.y+dy*t;return {w,l,t,x,y,dist:Math.hypot(x-point.x,y-point.y),angle:Math.atan2(dy,dx)*180/Math.PI};}).sort((a,b)=>a.dist-b.dist)[0];
  if(!near||near.dist>Math.max(.25,near.w.thickness/2+.12))return {w:undefined,error:'请点击要开门的墙线。'};
  const {w,l,t}=near;
  const error=w.height<height?'墙高不足，无法放下这扇门。':Math.min(t,1-t)*l<width/2+.05?'离墙角太近，请沿墙移动一点。':plan.openings.some(o=>o.id!==moving?.id&&o.wallId===w.id&&Math.abs(o.position-t)*l<(o.width+width)/2+.05)?'此处已有门窗，请选择另一段墙。':'';
  return {...near,width,error};
}

export function doorInterior(plan:Plan,wall:Plan['walls'][number],position:number):{side:1|-1;name:string} {
  const dx=wall.end.x-wall.start.x,dy=wall.end.y-wall.start.y;
  const offset=(wall.thickness/2+.08)/(Math.hypot(dx,dy)||1);
  const x=wall.start.x+dx*position,y=wall.start.y+dy*position;
  for(const room of [...plan.rooms].sort((a,b)=>roomArea(a)-roomArea(b)||a.id.localeCompare(b.id))){
    const contains=(side:number)=>pointInPolygon({x:x-side*dy*offset,y:y+side*dx*offset},roomPolygon(room));
    const plus=contains(1),minus=contains(-1);
    if(plus!==minus)return {side:plus?1:-1,name:room.name};
  }
  return {side:1,name:''};
}