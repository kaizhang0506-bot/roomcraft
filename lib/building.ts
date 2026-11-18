import type { Plan } from './plan';
import { planBounds } from './plan-bounds';

/** Root Plan contains the active floor. Cached floors contain no project or building recursion. */
export type FloorSnapshot = Omit<Plan, 'name' | 'building' | 'environment'>;
export interface BuildingSettings {
  totalFloors: number;
  activeFloor: number;
  floorHeight: number;
  /** Floors above totalFloors are archived, preserving edits if the count is increased again. */
  floors: Record<string, FloorSnapshot>;
}
export const MAX_BUILDING_FLOORS = 50;
export const MIN_FLOOR_HEIGHT = 2;
export const MAX_FLOOR_HEIGHT = 12;
export const DEFAULT_FLOOR_HEIGHT = 3.2;

function copy<T>(value: T): T { return structuredClone(value); }
export function snapshotFloor(plan: Plan | FloorSnapshot): FloorSnapshot {
  // Explicit fields prevent nested snapshots and keep the single project environment shared.
  return copy({version:plan.version,schemaVersion:plan.schemaVersion,units:plan.units,
    ceilingHeight:plan.ceilingHeight,materials:plan.materials,width:plan.width,depth:plan.depth,
    rooms:plan.rooms,walls:plan.walls,openings:plan.openings,furniture:plan.furniture,
    nodes:plan.nodes,routes:plan.routes,verified:plan.verified,recognition:plan.recognition});
}
export function requiredFloorHeight(plan: Plan | FloorSnapshot): number {
  return Math.max(MIN_FLOOR_HEIGHT,plan.ceilingHeight ?? 2.8,...plan.walls.map(wall=>wall.height));
}
export function getBuildingSettings(plan: Plan): BuildingSettings {
  return plan.building ?? {totalFloors:1,activeFloor:1,floorHeight:Math.max(DEFAULT_FLOOR_HEIGHT,requiredFloorHeight(plan)),floors:{}};
}
/** Preview only. Unvisited floors use the current layout as a template until first edited. */
export function getBuildingFloor(plan: Plan, floor: number): Plan | FloorSnapshot {
  const building=getBuildingSettings(plan);
  return floor===building.activeFloor ? plan : building.floors[String(floor)] ?? plan;
}
/** Whole-building extents include every visited storey that is currently in the building. */
export function buildingBounds(plan:Plan) {
  const building=getBuildingSettings(plan),bounds=[planBounds(plan)];
  for(const [number,snapshot] of Object.entries(building.floors))if(Number(number)<=building.totalFloors&&Number(number)!==building.activeFloor)bounds.push(planBounds({...snapshot,name:plan.name}));
  const x=Math.min(...bounds.map(box=>box.x)),y=Math.min(...bounds.map(box=>box.y));
  return {x,y,width:Math.max(...bounds.map(box=>box.x+box.width))-x,depth:Math.max(...bounds.map(box=>box.y+box.depth))-y};
}
function integerFloor(value:number,label:string) {
  if(!Number.isInteger(value)||value<1||value>MAX_BUILDING_FLOORS) throw new Error(`${label}应为 1–${MAX_BUILDING_FLOORS} 的整数`);
}
function minimumBuildingHeight(plan:Plan,building:BuildingSettings) {
  return Math.max(requiredFloorHeight(plan),...Object.values(building.floors).map(requiredFloorHeight));
}
function fitHeight(plan:Plan,building:BuildingSettings):BuildingSettings {
  const height=Math.max(building.floorHeight,minimumBuildingHeight(plan,building));
  if(!Number.isFinite(height)||height>MAX_FLOOR_HEIGHT) throw new Error(`楼层高度最多 ${MAX_FLOOR_HEIGHT} 米；请先调整超过此高度的墙体或层高`);
  return {...building,floorHeight:height};
}
export function switchBuildingFloor(plan: Plan, target: number): Plan {
  integerFloor(target,'目标楼层');
  const building=getBuildingSettings(plan);
  if(target>building.totalFloors) throw new Error('目标楼层不能高于建筑总层数');
  if(target===building.activeFloor) return {...plan,building:copy(fitHeight(plan,building))};
  const floors=copy(building.floors);
  floors[String(building.activeFloor)]=snapshotFloor(plan);
  const targetFloor=snapshotFloor(floors[String(target)] ?? plan);
  // Active data is authoritative and is only cached when leaving the floor.
  delete floors[String(target)];
  const result:Plan={...plan,...targetFloor,building:{...building,activeFloor:target,floors}};
  result.building=fitHeight(result,result.building!);
  return result;
}
export function setBuildingFloorCount(plan: Plan, count: number): Plan {
  integerFloor(count,'建筑层数');
  const building=getBuildingSettings(plan);
  // Switch while the previous range is still valid, saving the floor that becomes archived.
  const switched=building.activeFloor>count ? switchBuildingFloor(plan,count) : {...plan,building:copy(building)};
  switched.building=fitHeight(switched,{...switched.building!,totalFloors:count});
  return switched;
}
export function setBuildingFloorHeight(plan: Plan, height: number): Plan {
  const building=getBuildingSettings(plan), minimum=minimumBuildingHeight(plan,building);
  if(!Number.isFinite(height)||height<MIN_FLOOR_HEIGHT||height>MAX_FLOOR_HEIGHT) throw new Error(`楼层高度应在 ${MIN_FLOOR_HEIGHT}–${MAX_FLOOR_HEIGHT} 米之间`);
  if(height+1e-6<minimum) throw new Error(`楼层高度不能低于现有墙体或天花高度（${minimum.toFixed(2)} 米）`);
  return {...plan,building:{...copy(building),floorHeight:height}};
}
