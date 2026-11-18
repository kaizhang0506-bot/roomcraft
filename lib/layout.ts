import type { CanonicalPlan, Plan, Point, Room } from './plan';
import { MATERIAL_LIBRARY } from './materials';

export function roomPolygon(room:Room):Point[] {
  const polygon=room.polygon ?? [{x:room.x,y:room.y},{x:room.x+room.width,y:room.y},{x:room.x+room.width,y:room.y+room.depth},{x:room.x,y:room.y+room.depth}];
  return polygon.length>3&&Math.hypot(polygon[0].x-polygon[polygon.length-1].x,polygon[0].y-polygon[polygon.length-1].y)<1e-8?polygon.slice(0,-1):polygon;
}
export function polygonArea(polygon:Point[]):number {
  return Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p.x*q.y-q.x*p.y;},0))/2;
}
export function roomArea(room:Room):number {return polygonArea(roomPolygon(room));}
export function pointInPolygon(point:Point,polygon:Point[]):boolean {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    const cross=(point.x-a.x)*(b.y-a.y)-(point.y-a.y)*(b.x-a.x);
    if(Math.abs(cross)<1e-8&&point.x>=Math.min(a.x,b.x)-1e-8&&point.x<=Math.max(a.x,b.x)+1e-8&&point.y>=Math.min(a.y,b.y)-1e-8&&point.y<=Math.max(a.y,b.y)+1e-8)return true;
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
/** Includes boundary contact, but rejects edges crossing a concave room cutout. */
export function polygonContainsPolygon(outer:Point[],inner:Point[]):boolean {
  if(inner.length<3||!inner.every(p=>pointInPolygon(p,outer)))return false;
  const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  for(let i=0;i<inner.length;i++){
    const a=inner[i],b=inner[(i+1)%inner.length];
    if(!pointInPolygon({x:(a.x+b.x)/2,y:(a.y+b.y)/2},outer))return false;
    for(let j=0;j<outer.length;j++){
      const c=outer[j],d=outer[(j+1)%outer.length];
      if(cross(a,b,c)*cross(a,b,d)<-1e-10&&cross(c,d,a)*cross(c,d,b)<-1e-10)return false;
    }
  }
  return true;
}
export function polygonIsSimple(polygon:Point[]):boolean {
  const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const on=(a:Point,b:Point,p:Point)=>Math.abs(cross(a,b,p))<1e-8&&p.x>=Math.min(a.x,b.x)-1e-8&&p.x<=Math.max(a.x,b.x)+1e-8&&p.y>=Math.min(a.y,b.y)-1e-8&&p.y<=Math.max(a.y,b.y)+1e-8;
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length];if(Math.hypot(a.x-b.x,a.y-b.y)<1e-7)return false;
    for(let j=i+1;j<polygon.length;j++){
      if(j===i+1||(i===0&&j===polygon.length-1))continue;
      const c=polygon[j],d=polygon[(j+1)%polygon.length];
      if((cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return false;
    }
  }
  return true;
}
export function polygonBounds(polygon:Point[]) {
  const xs=polygon.map(p=>p.x),ys=polygon.map(p=>p.y);const x=Math.min(...xs),y=Math.min(...ys);
  return{x,y,width:Math.max(...xs)-x,depth:Math.max(...ys)-y};
}
export function roomLabelPoint(room:Room):Point {
  const polygon=roomPolygon(room),box=polygonBounds(polygon);const center={x:box.x+box.width/2,y:box.y+box.depth/2};
  if(pointInPolygon(center,polygon))return center;
  for(let y=1;y<20;y++)for(let x=1;x<20;x++){const p={x:box.x+box.width*x/20,y:box.y+box.depth*y/20};if(pointInPolygon(p,polygon))return p;}
  return {...polygon[0]};
}
export function resizeRoom(room:Room,patch:Partial<Pick<Room,'x'|'y'|'width'|'depth'>>):Room {
  const old=polygonBounds(roomPolygon(room)),box={...old,...patch};
  if(![box.x,box.y,box.width,box.depth].every(Number.isFinite)||box.width<=0||box.depth<=0)throw new Error('房间尺寸必须为有效正数');
  return {...room,...box,polygon:roomPolygon(room).map(p=>({x:box.x+(p.x-old.x)*box.width/old.width,y:box.y+(p.y-old.y)*box.depth/old.depth}))};
}
/** Legacy project container version remains 1; schemaVersion 2 is the editable layout contract.
 * Room polygons are authoritative. Rectangle fields are derived compatibility bounds only. */
export function normalizePlan(plan:Plan):CanonicalPlan {
  return {...plan,schemaVersion:2,units:'m',ceilingHeight:plan.ceilingHeight??2.8,
    materials:[...(plan.materials??[]),...MATERIAL_LIBRARY.filter(m=>!plan.materials?.some(custom=>custom.id===m.id))].map(m=>({...m})),
    rooms:plan.rooms.map(r=>{const polygon=roomPolygon(r).map(p=>({...p}));return{...r,...polygonBounds(polygon),polygon,floorMaterialId:r.floorMaterialId??(/卫|厨|阳台/.test(r.name)?'tile-warm':'oak-natural'),wallMaterialId:r.wallMaterialId??'plaster-warm'};}),
    walls:plan.walls.map(w=>({...w,materialId:w.materialId??'plaster-warm'})),
    furniture:plan.furniture.map(f=>({...f,materialId:f.materialId??(['sofa','bed','chair'].includes(f.kind)?'linen-cream':'wood-oak')})),
  };
}
export function scalePlan(plan:Plan,factor:number):Plan {
  if(!Number.isFinite(factor)||factor<=0||factor>100)throw new Error('校准比例必须在 0 到 100 之间');
  const point=(p:Point)=>({x:p.x*factor,y:p.y*factor});
  return normalizePlan({...plan,width:plan.width*factor,depth:plan.depth*factor,verified:false,
    rooms:plan.rooms.map(r=>({...r,polygon:roomPolygon(r).map(point)})),
    walls:plan.walls.map(w=>({...w,start:point(w.start),end:point(w.end),thickness:w.thickness*factor})),
    openings:plan.openings.map(o=>({...o,width:o.width*factor})),
    furniture:plan.furniture.map(f=>({...f,x:f.x*factor,y:f.y*factor,width:f.width*factor,depth:f.depth*factor})),
    nodes:plan.nodes.map(n=>({...n,...point(n)})),routes:plan.routes.map(r=>({...r,points:r.points.map(point)})),
    ...(plan.recognition?{recognition:{...plan.recognition,needsReview:true,metersPerPixel:plan.recognition.metersPerPixel?plan.recognition.metersPerPixel*factor:undefined,...(plan.recognition.imageTransform?{imageTransform:{...plan.recognition.imageTransform,metersPerPixel:plan.recognition.imageTransform.metersPerPixel*factor}}:{})}}:{}),
  });
}
