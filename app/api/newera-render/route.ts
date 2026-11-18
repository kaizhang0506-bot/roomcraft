import {authorize,errorResponse,json,readBody} from '../../../lib/ai-server';
import {ApiError} from '../../../lib/http-error';
import {setting} from '../../../lib/server-env';
import {validatePlan} from '../../../lib/validation';

export async function POST(request:Request){
 let release:(()=>void)|undefined;
 try {
  release=authorize(request);const body=await readBody(request);let plan;
  try{plan=validatePlan(body.plan);}catch{throw new ApiError('户型数据无效，请先检查墙体和房间。');}
  if(!plan.walls.length||!plan.rooms.length)throw new ApiError('请先创建墙体和房间。');
  const service=setting('NEWERA_RENDER_SERVICE_URL').replace(/\/$/,'');
  if(!service)throw new ApiError('New Era 光追服务尚未配置，请启动本地渲染桥。',503);
  const quality=body.quality==='draft'?'draft':'good';
  const camera=body.camera;
  if(camera!==undefined){
   if(!camera||typeof camera!=='object'||Array.isArray(camera))throw new ApiError('三维视角数据无效。');
   const c=camera as Record<string,unknown>;
   if(!['x','y','z'].every(k=>typeof c[k]==='number'&&Number.isFinite(c[k])&&Math.abs(c[k] as number)<=1000)||!Array.isArray(c.look_at)||c.look_at.length!==3||!c.look_at.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1000)||typeof c.fov!=='number'||!Number.isFinite(c.fov)||c.fov<20||c.fov>120)throw new ApiError('三维视角数据无效。');
  }
  let response:Response;
  try{response=await fetch(service+'/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan,camera,quality}),signal:AbortSignal.timeout(12*60*1000)});}catch{throw new ApiError('无法连接本地 New Era 渲染桥，请确认服务正在运行。',503);}
  const result=await response.json() as {image?:unknown;warnings?:unknown;error?:unknown};
  if(!response.ok)throw new ApiError(typeof result.error==='string'?result.error:'New Era 渲染失败，请检查本地服务。',response.status>=500?502:400);
  if(typeof result.image!=='string'||!/^data:image\/png;base64,/.test(result.image)||result.image.length>30*1024*1024)throw new ApiError('渲染服务未返回有效 PNG 图片。',502);
  return json({image:result.image,renderer:'newera-render-photo',warnings:Array.isArray(result.warnings)?result.warnings.filter((x):x is string=>typeof x==='string').slice(0,20):[]});
 }catch(error){return errorResponse(error);}finally{release?.();}
}
