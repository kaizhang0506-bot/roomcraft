import type { Plan, Wall } from './plan';
import { validatePlan } from './validation';

export function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve,reject)=>{ const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('文件读取失败'));reader.readAsDataURL(file); });
}
async function preprocessImage(file:File):Promise<{backgroundImage:string;warnings:string[]}> {
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
  try {
    if(bitmap.width*bitmap.height>64000000)throw new Error('图片像素过大，请先裁剪到完整户型区域。');
    const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('当前浏览器无法预处理户型图。');
    context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    let backgroundImage=canvas.toDataURL('image/png');if(backgroundImage.length>6*1024*1024)backgroundImage=canvas.toDataURL('image/jpeg',.9);
    return{backgroundImage,warnings:[...(scale<1?['已按比例缩小长边至 2400 像素，保留原始宽高比。']:[]),'已应用图片方向、透明区域白底处理；请核对识别后的比例和尺寸。']};
  }finally{bitmap.close();}
}
export async function importFloorplan(file: File): Promise<{plan?: Plan; backgroundImage?: string; warnings: string[]}> {
  if (file.size > 15*1024*1024) throw new Error('请上传 15 MB 以内的文件');
  const ext=file.name.split('.').pop()?.toLowerCase();
  if (ext==='json') return {plan:validatePlan(JSON.parse(await file.text())),warnings:[]};
  if (['png','jpg','jpeg','webp'].includes(ext||'')) {const result=await preprocessImage(file);return{...result,warnings:[...result.warnings,'户型图已载入。点击识别后，在校正界面核对墙体、门窗和房间边界。']};}
  if (ext==='pdf') {
    const pdfjs=await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
    const task=pdfjs.getDocument({data:await file.arrayBuffer()});
    try {
      const doc=await task.promise; const page=await doc.getPage(1); const base=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:Math.min(2,2400/Math.max(base.width,base.height))});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvas,viewport}).promise;
      const backgroundImage=canvas.toDataURL('image/png');
      return {backgroundImage,warnings:[`已载入 PDF 第 1 页（共 ${doc.numPages} 页），请使用包含完整户型的一页。识别后仍需校核尺寸。`]};
    } finally { await task.destroy(); }
  }
  if (ext==='dwg') throw new Error('当前支持 DXF；DWG 请在 CAD 软件中另存为 DXF 后导入。原生 DWG 转换器尚未接入。');
  if (ext==='dxf') {
    const {default:DxfParser}=await import('dxf-parser');
    const drawing=new DxfParser().parseSync(await file.text());
    if(!drawing)throw new Error('无法解析 DXF 文件');
    const units=Number(drawing.header?.['$INSUNITS']||0); const factors:Record<number,number>={1:.0254,2:.3048,4:.001,5:.01,6:1};
    const scale=factors[units]||.001; const warnings:string[]=[];
    if (!factors[units]) warnings.push('图纸未声明支持的单位，暂按毫米导入；请核对尺寸后使用。');
    const all=(drawing.entities||[]).filter(e=>!e.inPaperSpace);
    const ownAxes=all.filter(e=>e.layer?.toUpperCase()==='ROOMCRAFT_WALL_AXIS');
    const genericAxes=all.filter(e=>/wall[-_ ]?(axis|center|centre|cntr)|墙.*中心|中心.*墙/i.test(e.layer||''));
    const wallEntities=all.filter(e=>/wall|墙/i.test(e.layer||''));
    const axisEntities=ownAxes.length?ownAxes:genericAxes;
    const chosen=axisEntities.length?axisEntities:wallEntities.length?wallEntities:all;
    if (axisEntities.length) warnings.push('已优先使用墙体中心线图层，忽略可见墙体双边线，避免重复建墙。');
    else if (!wallEntities.length) warnings.push('未检测到命名的墙体图层，线条暂作为待核对墙体；请移除尺寸线和家具轮廓。');
    if (!axisEntities.length) warnings.push('外部图纸的墙体双边线暂按独立线段导入，不自动推断墙厚；请提供墙体中心线图层或人工合并校正。');
    const walls:Wall[]=[];
    const segments=new Set<string>();
    for(const entity of chosen) {
      const e=entity as unknown as {type:string;vertices?:{x:number;y:number;bulge?:number}[];shape?:boolean;extendedData?:{applicationName?:string;customStrings?:string[]}};
      if (!['LINE','LWPOLYLINE','POLYLINE'].includes(e.type)||!e.vertices)continue;
      const points=e.vertices;
      let height=2.8,thickness=.18;
      if(e.extendedData?.applicationName==='ROOMCRAFT') {
        try {
          const meta=JSON.parse(e.extendedData.customStrings?.[0]||'null');
          if(meta?.type==='wall'&&Number.isFinite(meta.height)&&meta.height>0&&meta.height<=100&&Number.isFinite(meta.thickness)&&meta.thickness>0&&meta.thickness<=100){height=meta.height;thickness=meta.thickness;}
          else warnings.push('部分墙体扩展属性无效，已采用默认墙高和墙厚，请校核。');
        } catch { warnings.push('部分墙体扩展属性无法读取，已采用默认墙高和墙厚，请校核。'); }
      }
      for(let i=0;i<points.length-1+(e.shape?1:0);i++) {
        const a=points[i],b=points[(i+1)%points.length];
        if(a.bulge){warnings.push('图纸含圆弧线段，暂未自动重建，需要人工校正。');continue;}
        if (![a.x,a.y,b.x,b.y].every(Number.isFinite)) throw new Error('图纸包含无效坐标，无法可靠重建墙体。请在 CAD 中修复后重试。');
        const start={x:a.x*scale,y:-a.y*scale},end={x:b.x*scale,y:-b.y*scale};
        if(Math.hypot(end.x-start.x,end.y-start.y)<.05)continue;
        const key=[`${Math.round(start.x*100000)},${Math.round(start.y*100000)}`,`${Math.round(end.x*100000)},${Math.round(end.y*100000)}`].sort().join('|');
        if(segments.has(key)){warnings.push('已移除完全重合的重复线段；未自动合并平行墙边线。');continue;}
        segments.add(key);
        walls.push({id:`cad-wall-${walls.length}`,start,end,height,thickness});
        if(walls.length>600)throw new Error('线条过多，请在 CAD 中仅保留户型墙体图层后重试。');
      }
    }
    if(!walls.length)throw new Error('未找到可导入的直线墙体。请导出含直线/多段线墙体的 DXF。');
    if(walls.length>600)throw new Error('线条过多，请在 CAD 中仅保留户型墙体图层后重试。');
    const points=walls.flatMap(w=>[w.start,w.end]);const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
    walls.forEach(w=>{w.start.x-=minX;w.end.x-=minX;w.start.y-=minY;w.end.y-=minY;});
    const width=Math.max(.18,...walls.flatMap(w=>[w.start.x,w.end.x])),depth=Math.max(.18,...walls.flatMap(w=>[w.start.y,w.end.y]));
    warnings.push('已导入墙体线稿；墙厚、门窗、房间及家具需要设计师核对和补充。');
    if(all.some(e=>['INSERT','ARC','SPLINE'].includes(e.type)))warnings.push('图纸含块、圆弧或样条，当前未自动转换这些构件。');
    return {plan:validatePlan({version:1,name:file.name.replace(/\.dxf$/i,''),width,depth,rooms:[],walls,openings:[],furniture:[],nodes:[],routes:[],verified:false}),warnings:[...new Set(warnings)]};
  }
  throw new Error('支持 PNG、JPG、WEBP、PDF、DXF 或 Roomcraft JSON 文件');
}
