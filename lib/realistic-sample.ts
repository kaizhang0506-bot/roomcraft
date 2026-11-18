import type { Furniture, Plan } from './plan';
import { normalizePlan, polygonBounds, roomPolygon } from './layout';
import { validatePlan } from './validation';

/** Stages the original single-room recognition sample; never substitutes recognition geometry. */
export function furnishRealisticSample(input:Plan):Plan {
  const plan=validatePlan(input);const room=plan.rooms[0];
  if(!room)throw new Error('样例未识别到封闭房间，请确认 CPU 识别服务正常。');
  const bounds=polygonBounds(roomPolygon(room));const sx=bounds.width/5.84,sy=bounds.depth/4.84;
  const item=(id:string,kind:Furniture['kind'],name:string,x:number,y:number,width:number,depth:number,height:number,rotation=0,materialId='wood-oak'):Furniture=>({id,kind,name,x:bounds.x+x*sx,y:bounds.y+y*sy,width:width*sx,depth:depth*sy,height,rotation,materialId});
  return normalizePlan({...plan,name:'写实单间 · 日光客厅',furniture:[
    item('realistic-sofa','sofa','织物皮革沙发 · GLB',2.9,.78,2.8,.98,.95,0,'linen-cream'),
    item('realistic-table','table','圆角胡桃木茶几',2.9,2.35,1.3,.72,.38,0,'wood-walnut'),
    item('realistic-chair','chair','绒面休闲椅 · GLB',4.85,2.1,.8,.85,.95,-25,'linen-cream'),
    item('realistic-cabinet','cabinet','胡桃木低柜',2.75,4.42,2.45,.38,.48,0,'wood-walnut'),
    item('realistic-plant','plant','室内绿植',.55,.55,.6,.6,1.65,0,'wood-walnut'),
  ],rooms:plan.rooms.map((r,i)=>({...r,name:i===0?'日光客厅':r.name,floorMaterialId:'oak-natural',wallMaterialId:'plaster-warm'})),nodes:[],routes:[],verified:false});
}
