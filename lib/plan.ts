export interface Point { x: number; y: number }
import { normalizePlan } from './layout';
import type { BuildingSettings } from './building';
import type { ProjectEnvironment } from './environment';
export interface MaterialDefinition { id: string; name: string; category: 'floor' | 'wall' | 'furniture'; color: string; roughness: number; pattern: 'solid' | 'wood' | 'tile' | 'stone' | 'carpet'; pricePerM2?: number }
export interface Room { id: string; name: string; x: number; y: number; width: number; depth: number; polygon?: Point[]; floorMaterialId?: string; wallMaterialId?: string; lightOn?: boolean }
export interface Wall { id: string; start: Point; end: Point; height: number; thickness: number; materialId?: string }
export interface Opening { id: string; wallId: string; kind: 'door' | 'window'; position: number; width: number; height: number; sill: number; swingSide?: 1 | -1; isOpen?: boolean }
export interface Furniture { id: string; kind: 'sofa' | 'table' | 'bed' | 'cabinet' | 'chair' | 'plant'; name: string; x: number; y: number; width: number; depth: number; height: number; rotation: number; materialId?: string }
export interface UtilityNode { id: string; kind: 'socket' | 'switch' | 'light' | 'water' | 'drain' | 'panel'; x: number; y: number; height: number }
export interface UtilityRoute { id: string; kind: 'power' | 'lighting' | 'coldWater' | 'hotWater' | 'drain'; points: Point[]; height: number; circuit?: string }
export interface Plan { version: 1; schemaVersion?: 2; units?: 'm'; ceilingHeight?: number; materials?: MaterialDefinition[]; name: string; width: number; depth: number; rooms: Room[]; walls: Wall[]; openings: Opening[]; furniture: Furniture[]; nodes: UtilityNode[]; routes: UtilityRoute[]; verified: boolean; environment?: ProjectEnvironment; building?: BuildingSettings; recognition?: { provider: string; needsReview: boolean; warnings: string[]; metersPerPixel?: number; sourceMesh?: { format: 'obj' | 'glb'; editable: false }; imageTransform?: {originPixels:Point;metersPerPixel:number;imageWidth:number;imageHeight:number} } }
export type CanonicalPlan = Plan & { schemaVersion: 2; units: 'm'; ceilingHeight: number; materials: MaterialDefinition[]; rooms: (Room & { polygon: Point[] })[] };

export const STYLE_OPTIONS = [
  { id: 'warm-minimal', name: '温润极简', description: '留白 · 亚麻 · 浅橡木', color: '#c5b299' },
  { id: 'japandi', name: '日式原木', description: '自然 · 木质 · 侘寂', color: '#a99a7d' },
  { id: 'modern', name: '现代雅奢', description: '石材 · 金属 · 精致', color: '#777773' },
  { id: 'chinese', name: '当代东方', description: '木格栅 · 温润 · 克制', color: '#846557' },
  { id: 'cream', name: '法式奶油', description: '弧线 · 奶白 · 柔和', color: '#dfd1bd' },
  { id: 'industrial', name: '复古工业', description: '微水泥 · 皮革 · 黑钢', color: '#7d8079' },
];

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall => ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, height: 2.8, thickness: .18 });
const LEGACY_SAMPLE_PLAN: Plan = {
  version: 1, name: '云栖公馆 · 三室两厅', width: 11.4, depth: 9.2, verified: false,
  rooms: [
    { id: 'living', name: '客餐厅', x: 0, y: 0, width: 6.6, depth: 5.2 },
    { id: 'bedroom', name: '主卧', x: 6.6, y: 0, width: 4.8, depth: 4.4 },
    { id: 'study', name: '书房', x: 0, y: 5.2, width: 3.8, depth: 4 },
    { id: 'guest', name: '次卧', x: 3.8, y: 5.2, width: 2.8, depth: 4 },
    { id: 'kitchen', name: '厨房', x: 6.6, y: 4.4, width: 2.8, depth: 4.8 },
    { id: 'bathroom', name: '卫浴', x: 9.4, y: 4.4, width: 2, depth: 4.8 },
  ],
  walls: [wall('w1',0,0,11.4,0),wall('w2',11.4,0,11.4,9.2),wall('w3',11.4,9.2,0,9.2),wall('w4',0,9.2,0,0),wall('w5',6.6,0,6.6,9.2),wall('w6',0,5.2,6.6,5.2),wall('w7',6.6,4.4,11.4,4.4),wall('w8',3.8,5.2,3.8,9.2),wall('w9',9.4,4.4,9.4,9.2)],
  openings: [
    { id:'d1',wallId:'w4',kind:'door',position:.23,width:1,height:2.2,sill:0 },
    { id:'d2',wallId:'w5',kind:'door',position:.34,width:.9,height:2.2,sill:0 },
    { id:'d3',wallId:'w6',kind:'door',position:.17,width:.85,height:2.2,sill:0 },
    { id:'d4',wallId:'w6',kind:'door',position:.8,width:.85,height:2.2,sill:0 },
    { id:'d5',wallId:'w5',kind:'door',position:.64,width:.9,height:2.2,sill:0 },
    { id:'d6',wallId:'w9',kind:'door',position:.22,width:.8,height:2.2,sill:0 },
    { id:'win1',wallId:'w1',kind:'window',position:.28,width:3.4,height:1.7,sill:.65 },
    { id:'win2',wallId:'w1',kind:'window',position:.79,width:2.3,height:1.5,sill:.8 },
    { id:'win3',wallId:'w3',kind:'window',position:.83,width:1.8,height:1.5,sill:.8 },
  ],
  furniture: [
    {id:'f1',kind:'sofa',name:'弧形亚麻沙发',x:3.5,y:1.35,width:2.7,depth:1,height:.85,rotation:0},
    {id:'f2',kind:'table',name:'胡桃木茶几',x:3.5,y:2.8,width:1.35,depth:.7,height:.38,rotation:0},
    {id:'f3',kind:'cabinet',name:'悬浮电视柜',x:3.5,y:4.7,width:2.8,depth:.35,height:.45,rotation:0},
    {id:'f4',kind:'table',name:'圆形餐桌',x:1.2,y:3.2,width:1.15,depth:1.15,height:.75,rotation:0},
    {id:'f5',kind:'bed',name:'主卧双人床',x:9.1,y:2.2,width:1.8,depth:2.1,height:.55,rotation:0},
    {id:'f6',kind:'cabinet',name:'主卧衣柜',x:7.15,y:2.1,width:.65,depth:2.5,height:2.6,rotation:0},
    {id:'f7',kind:'table',name:'书桌',x:1.8,y:8.5,width:2.5,depth:.65,height:.75,rotation:0},
    {id:'f8',kind:'chair',name:'书椅',x:1.8,y:7.65,width:.6,depth:.6,height:.9,rotation:0},
    {id:'f9',kind:'bed',name:'次卧单人床',x:5.25,y:7.5,width:1.2,depth:2.0,height:.5,rotation:0},
    {id:'f10',kind:'cabinet',name:'厨房操作台',x:8.9,y:7.1,width:.65,depth:3.2,height:.85,rotation:0},
    {id:'f11',kind:'cabinet',name:'浴室柜',x:10.95,y:7.8,width:.6,depth:1.2,height:.85,rotation:0},
    {id:'f12',kind:'plant',name:'室内绿植',x:5.8,y:.75,width:.65,depth:.65,height:1.5,rotation:0},
  ],
  nodes: [
    {id:'n1',kind:'panel',x:.15,y:4.7,height:1.5},{id:'n2',kind:'socket',x:3.5,y:.15,height:.3},
    {id:'n3',kind:'socket',x:3.5,y:5.05,height:.3},{id:'n4',kind:'socket',x:9.1,y:.15,height:.3},
    {id:'n5',kind:'light',x:3.5,y:2.7,height:2.6},{id:'n6',kind:'water',x:9.15,y:7.7,height:.55},
    {id:'n7',kind:'water',x:11.15,y:7.7,height:.55},{id:'n8',kind:'drain',x:10.5,y:8.5,height:.05},
  ],
  routes: [
    {id:'r1',kind:'power',height:.3,circuit:'示例插座回路',points:[{x:.15,y:4.7},{x:.3,y:.3},{x:3.5,y:.3},{x:9.1,y:.3}]},
    {id:'r2',kind:'power',height:.3,points:[{x:.15,y:4.7},{x:.3,y:5},{x:3.5,y:5}]},
    {id:'r3',kind:'lighting',height:2.6,points:[{x:.15,y:4.7},{x:3.5,y:4.7},{x:3.5,y:2.7}]},
    {id:'r4',kind:'coldWater',height:.55,points:[{x:11.15,y:9},{x:11.15,y:7.7},{x:9.15,y:7.7}]},
    {id:'r5',kind:'hotWater',height:.55,points:[{x:11,y:8.95},{x:11,y:7.5},{x:9.15,y:7.5}]},
    {id:'r6',kind:'drain',height:.05,points:[{x:10.5,y:8.5},{x:10.5,y:9}]},
  ],
};

export const SAMPLE_PLAN = normalizePlan(LEGACY_SAMPLE_PLAN);
export function clonePlan(plan: Plan = SAMPLE_PLAN): Plan { return normalizePlan(JSON.parse(JSON.stringify(plan))); }
