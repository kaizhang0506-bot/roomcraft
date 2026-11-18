import { aiConfiguration } from './server-env';
import { validatePlan } from './validation';
import { STYLE_OPTIONS, type Plan } from './plan';
import { ApiError, ImageTaskFailed } from './http-error';
import { pollImageTask, submitImageTask } from './image-tasks';
import { pointInPolygon, polygonBounds, polygonContainsPolygon, roomLabelPoint, roomPolygon } from './layout';
import { findWalkthroughSpawn } from './walkthrough';
import { getPanoramaSceneKey } from './panorama';

export { ApiError } from './http-error';
export const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function errorResponse(error:unknown) {
  if(error instanceof ApiError)return json({error:error.message,...(error instanceof ImageTaskFailed?{status:'failed'}:{})},error.status);
  if(error instanceof Error && (error.name==='AbortError'||error.name==='TimeoutError'))return json({error:'模型响应超时，请稍后重试。'},504);
  return json({error:'请求处理失败，请检查资料和服务配置后重试。'},500);
}
const inFlight=new Set<string>();
export function requestActor(request:Request):string {
  const origin=request.headers.get('origin'),url=new URL(request.url);
  if(origin && origin!==url.origin)throw new ApiError('不接受跨站请求。',403);
  const user=request.headers.get('oai-authenticated-user-id');
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(!user && !local)throw new ApiError('请登录后使用设计服务。',401);
  return user||'local';
}
export function authorize(request:Request):()=>void {
  const id=requestActor(request);
  if(inFlight.has(id))throw new ApiError('已有生成或识别任务进行中，请等待完成。',429);
  inFlight.add(id);return()=>inFlight.delete(id);
}
export async function readBody(request:Request):Promise<Record<string,unknown>> {
  const limit=8*1024*1024;
  if(Number(request.headers.get('content-length')||0)>limit)throw new ApiError('输入超过 8 MB，请缩小图片后重试。',413);
  if(!request.headers.get('content-type')?.includes('application/json'))throw new ApiError('需要 JSON 格式请求。',415);
  const reader=request.body?.getReader();if(!reader)throw new ApiError('请求不能为空。');
  const parts:Uint8Array[]=[];let count=0;
  try { while(true){const{done,value}=await reader.read();if(done)break;count+=value.length;if(count>limit){await reader.cancel();throw new ApiError('输入超过 8 MB。',413);}parts.push(value);} } finally {reader.releaseLock();}
  const data=new Uint8Array(count);let pos=0;for(const p of parts){data.set(p,pos);pos+=p.length;}
  try {const value=JSON.parse(new TextDecoder().decode(data));if(!value||Array.isArray(value)||typeof value!=='object')throw 0;return value;}catch{throw new ApiError('请求 JSON 无效。');}
}
function imageInput(input:unknown):{mime:string;bytes:Uint8Array;dataUrl:string} {
  if(typeof input!=='string')throw new ApiError('请提供户型或三维参考图。');
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(input);
  if(!match)throw new ApiError('只支持 PNG、JPG、WEBP 参考图片。');
  try{const decoded=atob(match[2]);if(decoded.length>5*1024*1024)throw new ApiError('参考图片超过 5 MB。',413);return{mime:match[1],bytes:Uint8Array.from(decoded,c=>c.charCodeAt(0)),dataUrl:input};}catch(e){if(e instanceof ApiError)throw e;throw new ApiError('图片数据无效。');}
}
async function upstream(response:Response):Promise<any> {
  if(!response.ok){await response.body?.cancel();throw new ApiError(response.status===429?'模型额度或并发受限，请稍后重试。':response.status===401||response.status===403?'模型服务拒绝访问，请检查服务端密钥与模型权限。':'模型服务暂时不可用，请稍后重试。',502);}
  try{return await response.json();}catch{throw new ApiError('模型服务返回了无法解析的响应。',502);}
}
async function completionText(response:Response):Promise<string> {
  if(!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
    const result=await upstream(response);const content=result?.choices?.[0]?.message?.content;
    if(typeof content!=='string')throw new ApiError('识别模型没有返回户型数据。',502);
    if(result?.choices?.[0]?.finish_reason==='length')throw new ApiError('户型过于复杂，识别结果被截断。请分区上传。',502);
    return content;
  }
  if(!response.body)throw new ApiError('识别服务没有返回响应流。',502);
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',content='',finished=false;
  const consume=(line:string)=>{
    if(!line.startsWith('data:'))return;
    const payload=line.slice(5).trim();if(!payload)return;if(payload==='[DONE]'){finished=true;return;}
    let event:any;try{event=JSON.parse(payload);}catch{throw new ApiError('识别服务响应流格式无效。',502);}
    if(event.error)throw new ApiError('识别服务中断，请稍后重试。',502);
    const choice=event.choices?.[0];if(typeof choice?.delta?.content==='string')content+=choice.delta.content;
    if(choice?.finish_reason==='length')throw new ApiError('户型过于复杂，识别结果被截断。请分区上传。',502);
    if(choice?.finish_reason==='stop')finished=true;
    if(content.length>250000)throw new ApiError('识别结果超过允许大小。',502);
  };
  try {
    while(true){const{value,done}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,index).replace(/\r$/,''));buffer=buffer.slice(index+1);}if(buffer.length>500000)throw new ApiError('识别服务响应过大。',502);if(done)break;}
    if(buffer.trim())consume(buffer.trim());
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
  if(!finished||!content.trim())throw new ApiError('识别响应未完整结束，原设计保持不变。请重试。',502);
  return content;
}
export async function generateInterior(body:Record<string,unknown>, actor = 'local') {
  const config=aiConfiguration();if(!config.imageKey)throw new ApiError('尚未配置生图服务。请在服务端配置 IMAGE_API_KEY、IMAGE_BASE_URL 和 IMAGE_PROTOCOL。',503);
  let plan:Plan;try{plan=validatePlan(body.plan);}catch{throw new ApiError('户型数据无效，请检查墙体与尺寸。');}
  if(body.mode!==undefined&&body.mode!=='interior'&&body.mode!=='panorama')throw new ApiError('不支持这个生图模式。');
  const panorama=body.mode==='panorama';
  const style=STYLE_OPTIONS.find(s=>s.id===body.style)||STYLE_OPTIONS[0];
  const room=plan.rooms.find(r=>r.id===body.roomId);
  if(panorama&&!room)throw new ApiError('请先选择一个有效房间，再生成写实全景。');
  const brief=typeof body.prompt==='string'?body.prompt.slice(0,2400):'';
  let prompt:string;
  if(panorama&&room){
    const polygon=roomPolygon(room),bounds=polygonBounds(polygon),padding=.5;
    const walls=plan.walls.filter(w=>Math.max(w.start.x,w.end.x)>=bounds.x-padding&&Math.min(w.start.x,w.end.x)<=bounds.x+bounds.width+padding&&Math.max(w.start.y,w.end.y)>=bounds.y-padding&&Math.min(w.start.y,w.end.y)<=bounds.y+bounds.depth+padding);
    const wallIds=new Set(walls.map(w=>w.id));
    const furniture=plan.furniture.filter(item=>pointInPolygon(item,polygon));
    const materialIds=new Set([room.floorMaterialId,room.wallMaterialId,...walls.map(w=>w.materialId),...furniture.map(item=>item.materialId)]);
    const spawn=findWalkthroughSpawn(plan,room.id),camera=spawn?.roomId===room.id?spawn.position:roomLabelPoint(room);
    const semantic=JSON.stringify({units:'m',coordinateSystem:'X right, floorplan Y down; vertical is height above floor',ceilingHeight:plan.ceilingHeight,room:{id:room.id,name:room.name,polygon,floorMaterialId:room.floorMaterialId,wallMaterialId:room.wallMaterialId},camera:{x:camera.x,y:camera.y,eyeHeight:1.65},walls,openings:plan.openings.filter(opening=>wallIds.has(opening.wallId)),furniture,materials:plan.materials?.filter(material=>materialIds.has(material.id))});
    if(semantic.length>70000)throw new ApiError('这个房间的结构过于复杂，请简化图纸后再生成全景。');
    prompt=`Create a PHOTOREALISTIC 360 x 180 degree interior panorama for a spherical panoramic viewer. Output one seamless full-sphere EQUIRECTANGULAR image, exactly 2:1 aspect ratio. This is an AI renovation design visualization, not a site photograph. The photograph-quality room is ${room.name}. Style: ${style.name}, ${style.description}. Place the virtual camera at the supplied indoor x/y point, eye height 1.65 metres; keep the horizon exactly at half the image height. Longitude spans a full 360 degrees from the left edge to the right edge; latitude spans zenith to nadir from top to bottom. Left and right edges must join seamlessly, including lighting and objects; ceiling converges correctly at the zenith and the floor at the nadir. Produce true spherical equirectangular projection, NOT a wide-angle perspective image, fisheye photo, cylindrical strip, contact sheet, collage, split screen or architectural cutaway. Reconstruct the supplied room polygon, wall segments, doors and windows as accurately as possible; bounding rectangles are not the room shape. Respect all opening positions and counts, window sills, wall thicknesses, ceiling height, room proportions, furniture footprints and material assignments. A supplied reference image is geometry/material context only: convert it to full-sphere projection rather than preserving its perspective camera. Render tactile wood grain, cloth weave, plaster, natural daylight, plausible soft bounce light and lifelike furniture, avoiding flat grey blocks, low-poly geometry or clay-model aesthetics. The panorama is a fixed camera node for looking around; do not depict a sequence of walking frames or add navigation arrows. Editable semantic room data: ${semantic}. Designer request: ${brief}. No text, dimensions, UI, logos, people, watermark or photographic tripod.`;
  }else{
    prompt=`Generate a photorealistic professional residential interior visualization. Style: ${style.name}, ${style.description}. ${room?`Focus on ${room.name} (${room.width}m x ${room.depth}m).`:'Show the furnished apartment as an architectural cutaway view.'} Preserve the supplied floorplan and the reference view's camera, walls, doors, windows, openings and room proportions. Do not add or remove openings. Use realistic materials, soft natural lighting and refined furniture. Reference plan data in meters: ${JSON.stringify({rooms:plan.rooms,walls:plan.walls,openings:plan.openings,furniture:plan.furniture}).slice(0,22000)}. Designer request: ${brief}. No text, dimensions, logos or watermark. This is a design visualization, not a construction drawing.`;
  }
  const size=panorama?'2048x1024':'1536x1024',quality=panorama?'high':'medium';
  const metadata=panorama&&room?{mode:'panorama' as const,projection:'equirectangular' as const,roomId:room.id,sourceKey:getPanoramaSceneKey(plan,room.id,style.id,brief)}:{};
  if(config.imageProtocol==='conflux_async') {
    const reference=body.referenceImage?imageInput(body.referenceImage).dataUrl:undefined;
    return {...await submitImageTask(config,prompt,actor,reference,{preset:panorama?'panorama':'interior'}),...metadata};
  }
  let response:Response;
  if(body.referenceImage){const image=imageInput(body.referenceImage);const form=new FormData();form.set('model',config.imageModel);form.set('prompt',prompt);form.set('size',size);form.set('quality',quality);form.set('image[]',new Blob([image.bytes as BlobPart],{type:image.mime}),'reference.'+(image.mime==='image/jpeg'?'jpg':image.mime.split('/')[1]));response=await fetch(config.imageBase+'/images/edits',{method:'POST',headers:{Authorization:`Bearer ${config.imageKey}`},body:form,signal:AbortSignal.timeout(180000)});}
  else response=await fetch(config.imageBase+'/images/generations',{method:'POST',headers:{Authorization:`Bearer ${config.imageKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.imageModel,prompt,size,quality,n:1}),signal:AbortSignal.timeout(180000)});
  const result=await upstream(response);const base64=result?.data?.[0]?.b64_json;
  if(typeof base64!=='string'||!base64.length)throw new ApiError('生图服务没有返回图片数据，请确认接口支持 GPT Image 协议。',502);
  return {image:`data:image/png;base64,${base64}`,model:config.imageModel,...metadata};
}
export async function queryImageTask(taskId:string,token:string,actor:string) {
  const config=aiConfiguration();
  if(!config.imageKey||config.imageProtocol!=='conflux_async')throw new ApiError('当前未配置异步生图服务。',503);
  return pollImageTask(config,taskId,token,actor);
}
export async function analyzeFloorplan(body:Record<string,unknown>) {
  const config=aiConfiguration();if(!config.visionKey)throw new ApiError('尚未配置户型识别服务。',503);
  const image=imageInput(body.image);
  const instruction=`You are a floorplan reconstruction assistant. Read this residential floorplan image and return ONLY a JSON object, without markdown: {"plan":{"version":1,"name":"识别户型","width":number,"depth":number,"rooms":[{"id":"room-1","name":"客厅","x":number,"y":number,"width":number,"depth":number}],"walls":[{"id":"wall-1","start":{"x":number,"y":number},"end":{"x":number,"y":number},"height":2.8,"thickness":0.18}],"openings":[{"id":"door-1","wallId":"wall-1","kind":"door or window","position":number,"width":number,"height":number,"sill":number}],"furniture":[],"nodes":[],"routes":[],"verified":false},"warnings":["Chinese warnings about uncertain dimensions and recognition"]}. All geometric units are METERS. X increases rightwards, Y downwards, origin at top-left. Opening position is a fraction [0,1] along its associated wall, at opening center. IDs must be globally unique. Read printed dimensions if clearly available; if missing, use an approximate residential scale AND explicitly warn that dimensions are estimated. Do not infer structural load-bearing status, wiring, plumbing, or hidden site conditions. Do not invent missing electrical/water routes. Furniture is empty for this recognition pass. Include only visible walls/openings; describe ambiguous areas in warnings. Use rectangles as approximate room labels; wall geometry is authoritative. Max extent100m, max 200walls. JSON numbers must be finite.`;
  const response=await fetch(config.visionBase+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${config.visionKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.visionModel,messages:[{role:'system',content:instruction},{role:'user',content:[{type:'text',text:'识别这张户型图，输出可校正的几何草稿 JSON。'},{type:'image_url',image_url:{url:image.dataUrl,detail:'high'}}]}],temperature:.1,max_tokens:10000,stream:true}),signal:AbortSignal.timeout(150000)});
  const content=await completionText(response);
  let parsed:any;try{parsed=JSON.parse(content.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));}catch{throw new ApiError('识别结果格式无效，请换用清晰户型图或重新识别。',502);}
  let plan:Plan;try{plan=validatePlan({...parsed.plan,verified:false,nodes:[],routes:[]});}catch{throw new ApiError('识别结果未通过几何校验，请重试或使用描图模式。',502);}
  const warnings=['AI 识别为待校正草稿，必须核对比例、所有尺寸、门窗位置和现场条件。',...(Array.isArray(parsed.warnings)?parsed.warnings.filter((s:unknown)=>typeof s==='string').slice(0,12):[])];
  return {plan,warnings};
}
export async function designInterior(body:Record<string,unknown>) {
  const config=aiConfiguration();if(!config.visionKey)throw new ApiError('尚未配置 AI 设计服务。',503);
  let plan:Plan;try{plan=validatePlan(body.plan);}catch{throw new ApiError('户型数据无效，请先校正尺寸。');}
  if(!plan.rooms.length||!plan.walls.length)throw new ApiError('请先识别户型或定义房间区域。');
  const style=STYLE_OPTIONS.find(s=>s.id===body.style)||STYLE_OPTIONS[0];
  const brief=typeof body.prompt==='string'?body.prompt.slice(0,2000):'';
  if(body.mode==='finishes'){
    const materials=plan.materials??[];
    const payload={style:style.name,brief,rooms:plan.rooms.map(r=>r.name),pieces:plan.furniture.map(f=>[f.name,f.materialId]),materials:materials.map(({id,name,color,roughness})=>({id,name,color,roughness}))};
    const response=await fetch(config.visionBase+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${config.visionKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.visionModel,stream:true,temperature:.35,max_tokens:2000,messages:[{role:'system',content:'Design a coherent realistic finish palette for this furnished apartment. Keep assigned material families and all geometry. Return only JSON {"finishes":[{"id":"an existing material ID","color":"#rrggbb","roughness":0.7}]}. Respect existing finish names; adapt their tone, saturation and sheen for the chosen style. No objects or locations.'},{role:'user',content:JSON.stringify(payload)}]}),signal:AbortSignal.timeout(85000)});
    const raw=await completionText(response);
    let finishes:unknown;try{finishes=JSON.parse(raw.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,'')).finishes;}catch{}
    if(!Array.isArray(finishes)||!finishes.length||finishes.length>80||finishes.some(f=>!materials.some(m=>m.id===f?.id)||!/^#[\da-f]{6}$/i.test(f?.color)||!Number.isFinite(f.roughness)||f.roughness<0||f.roughness>1))throw new ApiError('AI 材质未通过校验，原布置未改变。',502);
    const palette=finishes;return {plan:validatePlan({...plan,materials:materials.map(m=>{const f=palette.find(f=>f.id===m.id);return f?{...m,color:f.color,roughness:f.roughness}:m;})}),model:config.visionModel};
  }
  const instructions=`You are an interior designer producing an editable conceptual furniture layout, not construction documents. Return ONLY JSON {"furniture":[{"id":"ai-f-1","kind":"sofa|table|bed|cabinet|chair|plant","name":"Chinese descriptive furniture name","x":number,"y":number,"width":number,"depth":number,"height":number,"rotation":0}],"summary":"Short Chinese explanation of layout and remaining checks"}. Furniture coordinates are CENTER points in meters, X right and Y down. Rotation is degrees, prefer 0 or 90. Respect the actual room polygons, walls, doors and windows exactly; x/y/width/depth are bounding boxes only and may include areas outside concave polygons. Put each rotated furniture footprint entirely within a room polygon, with at least0.15m clearance from walls; avoid door clearances and overlapping furniture, preserve circulation. Bedrooms should have bed and wardrobe, living room sofa and coffee table, study desk/chair, kitchen cabinetry; bathrooms only a cabinet if space permits. All kind values must be exactly one of the six permitted strings. IDs ai-f-N must be globally unique and not present in source. Produce 8-25 realistic sized items for a typical apartment, no water/electrical suggestions. Style ${style.name}: ${style.description}. Designer brief: ${brief}. Source plan: ${JSON.stringify({width:plan.width,depth:plan.depth,rooms:plan.rooms,walls:plan.walls,openings:plan.openings})}`;
  const response=await fetch(config.visionBase+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${config.visionKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.visionModel,messages:[{role:'user',content:instructions}],temperature:.35,max_tokens:6500,stream:true}),signal:AbortSignal.timeout(150000)});
  const content=await completionText(response);
  let parsed:any;try{parsed=JSON.parse(content.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));}catch{throw new ApiError('AI 布置结果格式无效，请重试。',502);}
  let next:Plan;try{next=validatePlan({...plan,furniture:parsed.furniture,verified:false});}catch{throw new ApiError('AI 布置未通过数据校验，原方案已保留。',502);}
  if(!next.furniture.length)throw new ApiError('AI 没有返回家具方案，原方案已保留。',502);
  for(const item of next.furniture){
    const angle=item.rotation*Math.PI/180;
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:item.x+x*item.width/2*Math.cos(angle)-y*item.depth/2*Math.sin(angle),y:item.y+x*item.width/2*Math.sin(angle)+y*item.depth/2*Math.cos(angle)}));
    const inside=plan.rooms.some(r=>polygonContainsPolygon(roomPolygon(r),corners));
    if(!inside)throw new ApiError('AI 返回了超出房间边界的家具，原方案已保留。请重试或手动布置。',502);
  }
  return{plan:next,model:config.visionModel,summary:typeof parsed.summary==='string'?parsed.summary.slice(0,600):'已生成可编辑家具方案，请核对通行空间与现场尺寸。'};
}
