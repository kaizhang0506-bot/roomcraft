import { Buffer } from 'node:buffer';
import { setting } from './server-env';
import { ApiError } from './http-error';
import { recognitionToPlan } from './recognition';
import { analyzeFloorplan } from './ai-server';
import { normalizePlan, scalePlan } from './layout';

function serviceBase():string {
  const base=setting('RECOGNITION_SERVICE_URL').replace(/\/$/,'');
  if(!base)throw new ApiError('CPU 识别服务尚未启动，请按 recognition/README.md 启动并配置 RECOGNITION_SERVICE_URL。',503);
  return base;
}
function widthValue(input:unknown):number|undefined {
  if(input===undefined||input===null||input==='')return;
  if(typeof input!=='number'||!Number.isFinite(input)||input<=0||input>100)throw new ApiError('参考总宽度需要是 0–100 米之间的数值。');
  return input;
}
function imageBytes(input:unknown):{bytes:Buffer;mime:string} {
  if(typeof input!=='string')throw new ApiError('请上传户型图。');
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(input);
  if(!match)throw new ApiError('请提供 PNG、JPG 或 WEBP 户型图。');
  const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>6*1024*1024)throw new ApiError('识别图片需要在 6 MB 以内。',413);
  return{bytes,mime:match[1]};
}
async function runCPU(bytes:Uint8Array,mime:string,knownWidth?:number,name='识别户型',provider:'cpu'|'house'='cpu') {
  const form=new FormData();form.set('file',new Blob([bytes as BlobPart],{type:mime}),'floorplan.'+(mime==='image/jpeg'?'jpg':mime.split('/')[1]));
  if(knownWidth)form.set('known_width_m',String(knownWidth));
  let response:Response;
  try{response=await fetch(serviceBase()+(provider==='house'?'/recognize/house':'/recognize'),{method:'POST',body:form,signal:AbortSignal.timeout(75000)});}catch(error){if(error instanceof ApiError)throw error;throw new ApiError('无法连接本地识别服务，请确认服务已启动。',503);}
  if(!response.ok){let detail='';try{const body=await response.json() as {detail?:unknown};if(typeof body.detail==='string')detail=body.detail.slice(0,200);}catch{}throw new ApiError(detail||'识别未能提取有效户型，请使用清晰、完整的平面图或在校正界面描图。',response.status===503?503:422);}
  try{return recognitionToPlan(await response.json(),name);}catch{throw new ApiError('识别结果未通过可编辑结构校验，原项目已保留。请换图或手工校正。',422);}
}
export async function recognizeImage(body:Record<string,unknown>) {
  const knownWidth=widthValue(body.knownWidthMeters),provider=body.provider??(setting('RECOGNITION_SERVICE_URL')?'cpu':'vision');
  if(provider==='vision'){
    const result=await analyzeFloorplan(body);let plan=result.plan;
    if(knownWidth)plan=scalePlan(plan,knownWidth/plan.width);
    plan=normalizePlan({...plan,recognition:{provider:'vision',needsReview:true,warnings:result.warnings}});
    return{...result,plan,provider:'vision'};
  }
  if(provider!=='cpu'&&provider!=='house')throw new ApiError('不支持这个识别提供方。');
  const image=imageBytes(body.image);return runCPU(image.bytes,image.mime,knownWidth,typeof body.name==='string'?body.name.slice(0,160):'识别户型',provider);
}
export async function recognizeSample() {
  let response:Response;try{response=await fetch(serviceBase()+'/sample',{signal:AbortSignal.timeout(15000)});}catch(error){if(error instanceof ApiError)throw error;throw new ApiError('请先启动 CPU 样例识别服务。',503);}
  if(!response.ok)throw new ApiError('样例户型暂时无法读取。',503);
  const knownWidth=Number(response.headers.get('x-known-width-m'));if(!Number.isFinite(knownWidth)||knownWidth<=0)throw new ApiError('样例缺少参考尺寸，不能自动校准。',502);
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>6*1024*1024)throw new ApiError('样例图片过大。',502);
  return{...await runCPU(bytes,'image/png',knownWidth,'原型样例 · L 形三房'),sourceImage:'/samples/prototype-floorplan.png'};
}
