import type { Plan } from './plan';
import { roomPolygon } from './layout';

type PascalCore = typeof import('@pascal-app/core');
export type PascalImportScene = { nodes: Record<string, unknown>; rootNodeIds: string[] };

/** Convert semantic metres to actual Pascal nodes; never reconstruct raw mesh geometry. */
export function planToPascal(plan: Plan, core: PascalCore): PascalImportScene {
  const site = core.SiteNode.parse({name: plan.name});
  const building = core.BuildingNode.parse({name: plan.name, parentId: site.id});
  const level = core.LevelNode.parse({name:'一层', parentId: building.id, height:plan.ceilingHeight ?? 2.8});
  site.children.push(building.id);
  building.children.push(level.id);
  const nodes: Record<string, unknown> = {[site.id]:site,[building.id]:building,[level.id]:level};
  const wallIds = new Map<string, {node: ReturnType<typeof core.WallNode.parse>; length:number; height:number}>();
  for (const wall of plan.walls) {
    const length=Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y);
    if(length<.01) throw new Error('有墙体长度过短，请在平面设计中修正后导入。');
    if(wallIds.has(wall.id)) throw new Error('墙体编号重复，无法安全导入。');
    const node=core.WallNode.parse({parentId:level.id,start:[wall.start.x,wall.start.y],end:[wall.end.x,wall.end.y],height:wall.height,thickness:wall.thickness,metadata:{roomcraftId:wall.id}});
    wallIds.set(wall.id,{node,length,height:wall.height});nodes[node.id]=node;level.children.push(node.id);
  }
  for (const opening of plan.openings) {
    const host=wallIds.get(opening.wallId);
    if(!host) throw new Error('门窗关联的墙体不存在，请先校正户型。');
    const x=opening.position*host.length;
    if(x-opening.width/2 < -1e-6 || x+opening.width/2 > host.length+1e-6 || opening.sill+opening.height > host.height+1e-6) throw new Error('有门窗超出墙体范围，请先校正户型。');
    const values={parentId:host.node.id,wallId:host.node.id,width:opening.width,height:opening.height,position:[x,opening.sill+opening.height/2,0],metadata:{roomcraftId:opening.id}};
    const node=opening.kind==='door'?core.DoorNode.parse(values):core.WindowNode.parse(values);
    host.node.children.push(node.id);nodes[node.id]=node;
  }
  for (const room of plan.rooms) {
    const points=roomPolygon(room).map(p=>[p.x,p.y] as [number,number]);
    if(points.length<3) throw new Error('房间轮廓不完整，请先校正户型。');
    const zone=core.ZoneNode.parse({name:room.name,parentId:level.id,polygon:points,autoFromWalls:false,metadata:{roomcraftId:room.id}});
    const slab=core.SlabNode.parse({name:`${room.name}地面`,parentId:level.id,polygon:points,elevation:0,thickness:.05,metadata:{roomcraftRoomId:room.id}});
    nodes[zone.id]=zone;nodes[slab.id]=slab;level.children.push(zone.id,slab.id);
  }
  return {nodes,rootNodeIds:[site.id]};
}
