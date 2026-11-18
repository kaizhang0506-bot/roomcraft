import type { Plan } from './plan';
import { validatePlan } from './validation';

const MAX_PROJECT_BYTES=1024*1024;
const MAX_LINK_CHARS=128000;
async function bytesFrom(stream:ReadableStream<Uint8Array>,limit:number):Promise<Uint8Array> {
  const reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('项目过大，请改用 JSON 文件分享。');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
function base64url(bytes:Uint8Array):string {
  let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decode(text:string):Uint8Array {
  if(text.length>MAX_LINK_CHARS||!/^[a-zA-Z0-9_-]+$/.test(text))throw new Error('分享链接数据无效或过大。');
  const binary=atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4));return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
export async function createProjectShareUrl(plan:Plan):Promise<string> {
  const canonical=validatePlan(plan);const raw=new TextEncoder().encode(JSON.stringify(canonical));
  if(raw.length>MAX_PROJECT_BYTES)throw new Error('项目过大，请导出 JSON 文件分享。');
  if(typeof CompressionStream==='undefined')throw new Error('当前浏览器不支持压缩分享，请导出 JSON 文件。');
  const compressed=await bytesFrom(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),MAX_PROJECT_BYTES);
  const payload=base64url(compressed);if(payload.length>MAX_LINK_CHARS)throw new Error('分享链接过长，请使用项目文件。');
  // Fragments are not sent to the server. No env, pending image token or image bytes enter this payload.
  const url=new URL(window.location.pathname,window.location.origin);url.hash=`project=rc2.${payload}`;return url.href;
}
export async function readSharedProject():Promise<Plan|null> {
  const hash=window.location.hash;
  if(!hash.startsWith('#project='))return null;
  const value=hash.slice('#project='.length);if(!value.startsWith('rc2.'))throw new Error('不支持这个项目分享版本。');
  if(typeof DecompressionStream==='undefined')throw new Error('当前浏览器不支持读取分享链接，请使用项目文件。');
  try {
    const compressed=decode(value.slice(4));
    const bytes=await bytesFrom(new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')),MAX_PROJECT_BYTES);
    return validatePlan(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  }catch(error){throw new Error(error instanceof Error?`分享项目无法读取：${error.message}`:'分享项目无法读取。');}
}
