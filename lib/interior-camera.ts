import type {Plan} from './plan';
import {pointInPolygon,roomPolygon} from './layout';
import {findWalkthroughSpawn,isWalkthroughPositionFree,type WalkSpawn} from './walkthrough';

export function interiorCamera(plan:Plan,selectedId?:string|null):WalkSpawn|null{
 const selected=plan.rooms.find(r=>r.id===selectedId);
 const room=selected??plan.rooms.find(r=>/客厅|客餐/.test(r.name))??plan.rooms[0];
 if(!room)return null;
 const polygon=roomPolygon(room),piece=plan.furniture.find(f=>f.kind==='sofa'&&pointInPolygon(f,polygon))??plan.furniture.find(f=>f.kind==='bed'&&pointInPolygon(f,polygon));
 if(piece){
  const angle=piece.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  for(const d of [3.2,2.75,2.2,1.8])for(const offset of [1.52,-1.52,.9,-.9,0]){
   const p={x:piece.x+offset*c-d*s,y:piece.y+d*c+offset*s};
   if(!pointInPolygon(p,polygon)||!isWalkthroughPositionFree(plan,p))continue;
   return {position:p,yaw:Math.atan2(p.x-piece.x,p.y-piece.y),pitch:-.13,roomId:room.id};
  }
 }
 return findWalkthroughSpawn(plan,room.id);
}
