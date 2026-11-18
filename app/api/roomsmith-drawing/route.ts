import {authorize,errorResponse,json,readBody} from '../../../lib/ai-server';
import {ApiError} from '../../../lib/http-error';
import {setting} from '../../../lib/server-env';
import {validatePlan} from '../../../lib/validation';

export async function POST(request:Request){
 let release:(()=>void)|undefined;
 try{
  release=authorize(request);
  const body=await readBody(request);
  let plan;
  try{plan=validatePlan(body.plan);}catch{throw new ApiError('户型数据无效，请先检查墙体和房间。');}
  if(typeof body.roomId!=='string'||!plan.rooms.some(room=>room.id===body.roomId))throw new ApiError('请先选择一个房间。');
  const service=setting('RECOGNITION_SERVICE_URL').replace(/\/$/,'');
  if(!service)throw new ApiError('本地图纸服务尚未配置，请先启动识别服务。',503);
  let response:Response;
  try{response=await fetch(service+'/roomsmith/drawing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan,roomId:body.roomId}),signal:AbortSignal.timeout(30000)});}catch{throw new ApiError('无法连接本地图纸服务，请先启动识别服务。',503);}
  const result=await response.json() as {svg?:unknown;room?:unknown;provider?:unknown;warnings?:unknown;detail?:unknown};
  if(!response.ok)throw new ApiError(typeof result.detail==='string'?result.detail:'Roomsmith 图纸生成失败。',response.status>=500?502:400);
  if(result.provider!=='roomsmith-draw-plan'||typeof result.svg!=='string'||!result.svg.startsWith('<svg ')||result.svg.length>2*1024*1024)throw new ApiError('图纸服务返回了无效结果。',502);
  return json({svg:result.svg,room:typeof result.room==='string'?result.room:'房间',warnings:Array.isArray(result.warnings)?result.warnings.filter((x):x is string=>typeof x==='string').slice(0,20):[],provider:result.provider});
 }catch(error){return errorResponse(error);}finally{release?.();}
}
