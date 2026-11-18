import { z } from 'zod';
import type { CanonicalPlan, Plan } from './plan';
import { normalizePlan, polygonArea, polygonIsSimple } from './layout';
import { isEnvironmentDate } from './environment';
import { MAX_BUILDING_FLOORS, MAX_FLOOR_HEIGHT, MIN_FLOOR_HEIGHT, requiredFloorHeight } from './building';

const n = z.number().finite();
const coordinate = n.min(-1000).max(1000);
const length = n.positive().max(100);
const id = z.string().min(1).max(120);
const point = z.object({ x: coordinate, y: coordinate });
const pixelPoint = z.object({x:n.min(0).max(16000),y:n.min(0).max(16000)});
const floorObjectSchema = z.object({
  version: z.literal(1), width: length, depth: length,
  schemaVersion:z.literal(2),units:z.literal('m'),ceilingHeight:n.min(1.8).max(20),
  materials:z.array(z.object({id,name:z.string().min(1).max(100),category:z.enum(['floor','wall','furniture']),color:z.string().regex(/^#[a-fA-F0-9]{6}$/),roughness:n.min(0).max(1),pattern:z.enum(['solid','wood','tile','stone','carpet']),pricePerM2:n.min(0).max(100000).optional()})).max(80),
  rooms: z.array(z.object({id,name:z.string().max(100),x:coordinate,y:coordinate,width:length,depth:length,polygon:z.array(point).min(3).max(128),floorMaterialId:id.optional(),wallMaterialId:id.optional(),lightOn:z.boolean().optional()})).max(100),
  walls: z.array(z.object({id,start:point,end:point,height:length,thickness:length,materialId:id.optional()})).max(600),
  openings: z.array(z.object({id,wallId:id,kind:z.enum(['door','window']),position:n.min(0).max(1),width:length,height:length,sill:n.min(0).max(20),swingSide:z.union([z.literal(1),z.literal(-1)]).optional(),isOpen:z.boolean().optional()})).max(300),
  furniture: z.array(z.object({id,kind:z.enum(['sofa','table','bed','cabinet','chair','plant']),name:z.string().max(100),x:coordinate,y:coordinate,width:length,depth:length,height:length,rotation:n.min(-360).max(360),materialId:id.optional()})).max(500),
  nodes: z.array(z.object({id,kind:z.enum(['socket','switch','light','water','drain','panel']),x:coordinate,y:coordinate,height:n.min(0).max(100)})).max(600),
  routes: z.array(z.object({id,kind:z.enum(['power','lighting','coldWater','hotWater','drain']),points:z.array(point).min(2).max(200),height:n.min(0).max(100),circuit:z.string().max(100).optional()})).max(300),
  verified: z.boolean(),
  recognition:z.object({provider:z.string().max(100),needsReview:z.boolean(),warnings:z.array(z.string().max(1500)).max(100),metersPerPixel:n.positive().max(100).optional(),sourceMesh:z.object({format:z.enum(['obj','glb']),editable:z.literal(false)}).optional(),imageTransform:z.object({originPixels:pixelPoint,metersPerPixel:n.positive().max(100),imageWidth:n.positive().max(16000),imageHeight:n.positive().max(16000)}).optional()}).optional(),
});
function checkFloor(p:z.infer<typeof floorObjectSchema>,ctx:z.RefinementCtx) {
  const wallIds = new Set(p.walls.map(w=>w.id));
  const ids = [...p.rooms,...p.walls,...p.openings,...p.furniture,...p.nodes,...p.routes].map(o=>o.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({code:'custom',message:'构件 ID 不能重复'});
  for (const o of p.openings) if (!wallIds.has(o.wallId)) ctx.addIssue({code:'custom',message:'门窗必须关联已有墙体'});
  for (const w of p.walls) if (Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y)<.01) ctx.addIssue({code:'custom',message:'墙体长度不能为零'});
  for(const room of p.rooms)if(polygonArea(room.polygon)<.01||!polygonIsSimple(room.polygon))ctx.addIssue({code:'custom',message:`房间“${room.name}”需要有效、不自交的多边形边界`});
  const materialIds=new Set(p.materials.map(m=>m.id));
  if(materialIds.size!==p.materials.length)ctx.addIssue({code:'custom',message:'材质 ID 不能重复'});
  for(const materialId of [...p.walls.map(w=>w.materialId),...p.furniture.map(f=>f.materialId),...p.rooms.flatMap(r=>[r.floorMaterialId,r.wallMaterialId])])if(materialId&&!materialIds.has(materialId))ctx.addIssue({code:'custom',message:'构件引用的材质不存在'});
}
function normalizeInput(input:unknown,snapshot=false):unknown {
  if(!input||typeof input!=='object'||Array.isArray(input))return input;
  const value=input as Record<string,unknown>;
  if(value.version!==1||(value.schemaVersion!==undefined&&value.schemaVersion!==2)||(value.units!==undefined&&value.units!=='m'))return input;
  if(!['rooms','walls','furniture','openings','nodes','routes'].every(key=>Array.isArray(value[key]))||(value.materials!==undefined&&!Array.isArray(value.materials)))return input;
  try {
    if(!snapshot)return normalizePlan(input as Plan);
    // A snapshot must never contain another project/building tree.
    if('name' in value||'building' in value||'environment' in value)return input;
    const normalized=normalizePlan({...value,name:'楼层'} as Plan);
    const {name,...floor}=normalized;
    void name;
    return floor;
  }catch{return input;}
}
const snapshotSchema=z.preprocess(input=>normalizeInput(input,true),floorObjectSchema.strict().superRefine(checkFloor));
const environmentSchema=z.object({
  enabled:z.boolean(),weather:z.enum(['clear','cloudy','rain']),landscape:z.enum(['garden','city','none']),
  date:z.string().refine(isEnvironmentDate,'日期必须为 1900–2100 年内有效的 YYYY-MM-DD 日期'),
  latitude:n.min(-90).max(90),longitude:n.min(-180).max(180),utcOffset:n.min(-12).max(14),
  indoorLights:z.enum(['auto','on','off']),indoorIntensity:n.min(0).max(1),hour:n.min(0).max(24),north:n.min(-180).max(180),
});
const floorNumber=n.int().min(1).max(MAX_BUILDING_FLOORS);
const buildingSchema=z.object({
  totalFloors:floorNumber,activeFloor:floorNumber,floorHeight:n.min(MIN_FLOOR_HEIGHT).max(MAX_FLOOR_HEIGHT),
  floors:z.record(z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/),snapshotSchema),
}).strict().superRefine((building,ctx)=>{
  if(building.activeFloor>building.totalFloors)ctx.addIssue({code:'custom',path:['activeFloor'],message:'当前楼层不能高于建筑总层数'});
  for(const [floor,snapshot] of Object.entries(building.floors))if(requiredFloorHeight(snapshot)>building.floorHeight+1e-6)ctx.addIssue({code:'custom',path:['floors',floor],message:'楼层高度不能低于已保存楼层的墙体或天花高度'});
});
const strictPlanSchema=floorObjectSchema.extend({name:z.string().min(1).max(160),environment:environmentSchema.optional(),building:buildingSchema.optional()}).superRefine((p,ctx)=>{
  checkFloor(p,ctx);
  if(p.building&&requiredFloorHeight(p)>p.building.floorHeight+1e-6)ctx.addIssue({code:'custom',path:['building','floorHeight'],message:'楼层高度不能低于当前墙体或天花高度'});
});
export const planSchema=z.preprocess(input=>normalizeInput(input),strictPlanSchema);
export function validatePlan(input: unknown): CanonicalPlan { return planSchema.parse(input); }
