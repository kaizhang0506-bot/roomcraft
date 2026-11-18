import {Buffer} from 'node:buffer';
import {ApiError} from './http-error';

const API='https://www.meltflexai.com/api/v1/world';
const enc=new TextEncoder();
type Fetcher=typeof fetch;
type Payload=Record<string,unknown>;
const requests=new Map<string,{at:number;hash:string;result:Promise<Payload>}>();
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
function credentials(key:string){if(!key)throw new ApiError('MeltFlex 未配置：请在服务端设置 MELTFLEX_API_KEY；该服务需要 MeltFlex 订阅与额度。',503);return key;}
async function sign(secret:string,actor:string,kind:string,id:string,issued:string){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',key,enc.encode(`roomcraft-world:${actor}:${kind}:${id}:${issued}`))).toString('base64url');}
async function token(secret:string,actor:string,kind:string,id:string){const issued=String(Math.floor(Date.now()/1000));return `${issued}.${await sign(secret,actor,kind,id,issued)}`;}
async function verify(secret:string,actor:string,kind:string,id:string,ticket:string){
 if(!validId(id)||!['operation','world'].includes(kind))throw new ApiError('漫游任务编号无效。',400);
 const match=/^(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(ticket);if(!match)throw new ApiError('漫游任务凭据无效。',403);
 const age=Math.floor(Date.now()/1000)-Number(match[1]);if(age< -60||age>7*86400)throw new ApiError('漫游任务凭据已过期。',410);
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('HMAC',key,Buffer.from(match[2],'base64url'),enc.encode(`roomcraft-world:${actor}:${kind}:${id}:${match[1]}`)))throw new ApiError('不能访问这个漫游任务。',403);
}
function viewer(value:unknown){if(typeof value!=='string')throw new ApiError('服务没有返回可用漫游地址，请检查任务记录。',502);let url:URL;try{url=new URL(value);}catch{throw new ApiError('服务返回的漫游地址无效。',502);}if(url.protocol!=='https:'||url.hostname!=='marble.worldlabs.ai'||url.username||url.password||!url.pathname.startsWith('/world/'))throw new ApiError('服务返回了不受信任的漫游地址。',502);return url.href;}
async function result(data:Payload,key:string,actor:string):Promise<Payload>{
 if(data.status==='FAILED'||data.status==='failed')return {status:'failed',error:'漫游空间生成失败，请到 MeltFlex 查看退款与任务记录。'};
 if(data.done===true&&data.success===true){if(!validId(data.worldId))throw new ApiError('服务没有返回有效空间编号。',502);return {status:'succeeded',worldId:data.worldId,worldToken:await token(key,actor,'world',data.worldId),viewerUrl:viewer(data.viewerUrl),creditsUsed:30};}
 if(data.done===false&&validId(data.operationId))return {status:'processing',taskId:data.operationId,taskToken:await token(key,actor,'operation',data.operationId),creditsUsed:30};
 throw new ApiError('服务未返回有效任务信息，请先检查 MeltFlex 任务记录再决定是否重试。',502);
}
async function parse(response:Response){if(!response.ok){await response.body?.cancel();const code=response.status;if(code===401||code===403)throw new ApiError('MeltFlex 密钥或订阅无效。',502);if(code===402)throw new ApiError('MeltFlex 额度不足，草稿需要 30 credits。',402);if([400,413,429].includes(code))throw new ApiError('MeltFlex 拒绝了请求，请检查图片大小或稍后查询任务记录。',code);throw new ApiError('MeltFlex 请求未确认，请先检查服务任务记录，避免重复扣费。',502);}try{return await response.json() as Payload;}catch{throw new ApiError('服务响应无法解析，请先检查任务记录，避免重复扣费。',502);}}
export async function submitWorld(body:Payload,actor:string,secret:string,fetcher:Fetcher=fetch){
 const key=credentials(secret);if(body.confirmedCost!==30)throw new ApiError('请确认草稿生成将消耗 30 credits。',400);
 if(!validId(body.requestId)||body.requestId.length<16)throw new ApiError('缺少有效请求编号。',400);
 if(typeof body.image!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(body.image)||body.image.length>4_400_000)throw new ApiError('请提供 3.3 MB 以内的 PNG、JPG 或 WEBP 参考图。',413);
 const [header,encoded]=body.image.split(',');const bytes=Buffer.from(encoded,'base64');const mime=header.slice(5,header.indexOf(';'));
 const imageType=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 if(!imageType||imageType!==mime)throw new ApiError('参考文件不是有效的 PNG、JPG 或 WEBP 图片。',400);
 const requestId=body.requestId;const hash=Buffer.from(await crypto.subtle.digest('SHA-256',enc.encode(body.image))).toString('hex');const mapKey=actor+':'+requestId;
 const existing=requests.get(mapKey);if(existing){if(existing.hash!==hash)throw new ApiError('这个请求编号已用于另一张图片。',409);return existing.result;}
 // Preserve a result, including ambiguous failures, for the process lifetime: never retry an uncertain paid request automatically.
 if(requests.size>=1000)throw new ApiError('任务记录已满，请先核对既有任务。',503);
 const work=(async()=>{try{const response=await fetcher(API,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({image:body.image,model:'draft',name:'Roomcraft interior'}),redirect:'error',signal:AbortSignal.timeout(230000)});return await result(await parse(response),key,actor);}catch(error){if(error instanceof ApiError)throw error;throw new ApiError('提交结果未知，请先检查 MeltFlex 任务记录，避免重复扣费。',502);}})();
 requests.set(mapKey,{at:Date.now(),hash,result:work});return work;
}
export async function pollWorld(kind:string,id:string,ticket:string,actor:string,secret:string,fetcher:Fetcher=fetch){
 const key=credentials(secret);await verify(key,actor,kind,id,ticket);
 const parameter=kind==='world'?'worldId':'operationId';let response:Response;try{response=await fetcher(`${API}?${parameter}=${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw new ApiError('任务暂时无法查询，可以稍后继续查询。',502);}
 return result(await parse(response),key,actor);
}
