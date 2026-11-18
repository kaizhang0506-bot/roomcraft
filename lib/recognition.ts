import { z } from 'zod';
import type { Plan, Point } from './plan';
import { validatePlan } from './validation';
import { polygonBounds } from './layout';
import { MATERIAL_LIBRARY } from './materials';

const finite=z.number().finite();const point=z.object({x:finite,y:finite});
const envelopeSchema=z.object({
  provider:z.string().min(1).max(100),coordinateSpace:z.enum(['pixel','meter']),
  imageSize:z.object({width:finite.positive().max(16000),height:finite.positive().max(16000)}),
  metersPerPixel:finite.positive().max(100),ceilingHeight:finite.min(1.8).max(20).default(2.8),
  wallSegments:z.array(z.object({id:z.string().min(1).max(120),start:point,end:point,thickness:finite.positive(),height:finite.positive().optional()})).min(1).max(600),
  openings:z.array(z.object({id:z.string().min(1).max(120),wallId:z.string(),kind:z.enum(['door','window']),position:finite.min(0).max(1),width:finite.positive(),height:finite.positive(),sill:finite.min(0)})).max(300).default([]),
  roomPolygons:z.array(z.object({id:z.string().min(1).max(120),name:z.string().max(100),polygon:z.array(point).min(3).max(128),floorMaterialId:z.string().optional()})).max(100).default([]),
  warnings:z.array(z.string().max(1500)).max(90).default([]),needsReview:z.boolean().default(true),
  mesh:z.object({format:z.enum(['obj','glb']),editable:z.literal(false)}).optional(),
});
export function recognitionToPlan(input:unknown,name='识别户型'): {plan:Plan;warnings:string[];provider:string} {
  if(input&&typeof input==='object'&&!('wallSegments' in input)&&('mesh' in input||'obj' in input||'glb' in input))throw new Error('仅有 OBJ/GLB 不能还原可编辑户型。识别服务必须同时提供墙线、开口和房间语义轮廓。');
  const result=envelopeSchema.parse(input),scale=result.coordinateSpace==='pixel'?result.metersPerPixel:1;
  const ends=result.wallSegments.flatMap(w=>[w.start,w.end]);
  const origin={x:Math.min(...ends.map(p=>p.x)),y:Math.min(...ends.map(p=>p.y))};
  const convert=(p:Point)=>({x:(p.x-origin.x)*scale,y:(p.y-origin.y)*scale});
  const walls=result.wallSegments.map(w=>({id:w.id,start:convert(w.start),end:convert(w.end),thickness:w.thickness*scale,height:w.height??result.ceilingHeight}));
  const wallIds=new Set(walls.map(w=>w.id));
  const rejected=result.openings.filter(o=>!wallIds.has(o.wallId));
  const materialIds=new Set(MATERIAL_LIBRARY.filter(m=>m.category==='floor').map(m=>m.id));
  const unknownMaterials=result.roomPolygons.filter(r=>r.floorMaterialId&&!materialIds.has(r.floorMaterialId));
  const warnings=[...result.warnings,'识别结果是待校正的语义户型，需核对尺寸、墙厚、门窗与房间轮廓。',...(rejected.length?[`${rejected.length} 个门窗未能关联到墙体，请在校正界面重新添加。`]:[]),...(unknownMaterials.length?['识别器返回的部分材质未收录，已替换为默认地板，请在材质库中选择。']:[])];
  const bounds=polygonBounds(walls.flatMap(w=>[w.start,w.end]));
  const plan=validatePlan({version:1,schemaVersion:2,units:'m',name,width:bounds.width,depth:bounds.depth,ceilingHeight:result.ceilingHeight,
    walls,openings:result.openings.filter(o=>wallIds.has(o.wallId)).map(o=>({...o,width:o.width*scale})),
    rooms:result.roomPolygons.map(r=>{const polygon=r.polygon.map(convert);return{...r,floorMaterialId:r.floorMaterialId&&materialIds.has(r.floorMaterialId)?r.floorMaterialId:undefined,...polygonBounds(polygon),polygon};}),
    furniture:[],nodes:[],routes:[],verified:false,
    recognition:{provider:result.provider,needsReview:true,warnings,metersPerPixel:result.metersPerPixel,...(result.mesh?{sourceMesh:result.mesh}:{}),
      ...(result.coordinateSpace==='pixel'?{imageTransform:{originPixels:origin,metersPerPixel:scale,imageWidth:result.imageSize.width,imageHeight:result.imageSize.height}}:{}),
    },
  });
  return{plan,warnings,provider:result.provider};
}
