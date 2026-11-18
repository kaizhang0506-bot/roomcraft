import type { Plan, Point } from './plan';
import { validatePlan } from './validation';
import { roomArea, roomLabelPoint } from './layout';

function save(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function downloadProject(plan:Plan){save(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}),`${plan.name}.roomcraft.json`);}
export function downloadImage(url:string,name='室内效果.png'){const a=document.createElement('a');a.href=url;a.download=name;a.click();}
export function exportDXF(plan:Plan){
  validatePlan(plan);
  const chunks:string[]=[];const pair=(code:number,value:string|number)=>{chunks.push(String(code),String(value));};
  const line=(a:Point,b:Point,layer:string)=>{pair(0,'LINE');pair(8,layer);pair(10,a.x*1000);pair(20,-a.y*1000);pair(30,0);pair(11,b.x*1000);pair(21,-b.y*1000);pair(31,0);};
  const text=(p:Point,value:string,layer='ANNOTATION')=>{pair(0,'TEXT');pair(8,layer);pair(10,p.x*1000);pair(20,-p.y*1000);pair(30,0);pair(40,180);pair(1,value.replace(/[\r\n]/g,' '));};
  pair(0,'SECTION');pair(2,'HEADER');pair(9,'$ACADVER');pair(1,'AC1024');pair(9,'$INSUNITS');pair(70,4);pair(0,'ENDSEC');
  pair(0,'SECTION');pair(2,'TABLES');
  pair(0,'TABLE');pair(2,'LTYPE');pair(70,1);pair(0,'LTYPE');pair(2,'CONTINUOUS');pair(70,0);pair(3,'Solid line');pair(72,65);pair(73,0);pair(40,0);pair(0,'ENDTAB');
  pair(0,'TABLE');pair(2,'APPID');pair(70,1);pair(0,'APPID');pair(2,'ROOMCRAFT');pair(70,0);pair(0,'ENDTAB');
  pair(0,'TABLE');pair(2,'LAYER');pair(70,10);
  for(const [name,color] of [['WALL',7],['OPENING',3],['FURNITURE',8],['POWER',1],['LIGHTING',2],['COLDWATER',5],['HOTWATER',6],['DRAIN',4],['ANNOTATION',7]] as const){pair(0,'LAYER');pair(2,name);pair(70,0);pair(62,color);pair(6,'CONTINUOUS');}
  // Keep semantic centerlines separate from the visible, segmented wall edges.
  // This layer is off, frozen and non-plotting so CAD drawings retain their appearance.
  pair(0,'LAYER');pair(2,'ROOMCRAFT_WALL_AXIS');pair(70,1);pair(62,-8);pair(6,'CONTINUOUS');pair(290,0);
  pair(0,'ENDTAB');pair(0,'ENDSEC');pair(0,'SECTION');pair(2,'ENTITIES');
  for(const w of plan.walls) {
    const dx=w.end.x-w.start.x,dy=w.end.y-w.start.y,len=Math.hypot(dx,dy);if(len<.001)continue;
    line(w.start,w.end,'ROOMCRAFT_WALL_AXIS');
    pair(1001,'ROOMCRAFT');pair(1000,JSON.stringify({type:'wall',height:w.height,thickness:w.thickness}));
    const spans=plan.openings.filter(o=>o.wallId===w.id).map(o=>({a:Math.max(0,o.position*len-o.width/2),b:Math.min(len,o.position*len+o.width/2),o})).sort((a,b)=>a.a-b.a);
    const at=(t:number,offset:number=0)=>({x:w.start.x+dx*t/len-dy*offset/len,y:w.start.y+dy*t/len+dx*offset/len});
    let prev=0;
    for(const s of [...spans,{a:len,b:len,o:null}]){if(s.a>prev)for(const off of [-w.thickness/2,w.thickness/2])line(at(prev,off),at(s.a,off),'WALL');if(s.o){line(at(s.a),at(s.b),'OPENING');text(at((s.a+s.b)/2),s.o.kind==='door'?'DOOR':'WINDOW','OPENING');}prev=Math.max(prev,s.b);}
  }
  for(const f of plan.furniture){const rad=f.rotation*Math.PI/180;const pts=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:f.x+x*f.width/2*Math.cos(rad)-y*f.depth/2*Math.sin(rad),y:f.y+x*f.width/2*Math.sin(rad)+y*f.depth/2*Math.cos(rad)}));pts.forEach((p,i)=>line(p,pts[(i+1)%4],'FURNITURE'));text({x:f.x,y:f.y},f.name,'FURNITURE');}
  for(const r of plan.routes)r.points.slice(1).forEach((p,i)=>line(r.points[i],p,r.kind.toUpperCase()));
  for(const node of plan.nodes){const layer=node.kind==='water'?'COLDWATER':node.kind==='drain'?'DRAIN':node.kind==='light'?'LIGHTING':'POWER';pair(0,'CIRCLE');pair(8,layer);pair(10,node.x*1000);pair(20,-node.y*1000);pair(30,0);pair(40,70);text({x:node.x+.1,y:node.y},`${node.kind} H=${Math.round(node.height*1000)}`,layer);}
  for(const room of plan.rooms)text(roomLabelPoint(room),`${room.name} ${roomArea(room).toFixed(1)}m2`);
  text({x:0,y:-1},`${plan.name} | 单位:mm | 设计草稿-非施工交付 | 尺寸、回路和现场条件须专业校核`);
  pair(0,'ENDSEC');pair(0,'EOF');save(new Blob([chunks.join('\r\n')+'\r\n'],{type:'application/dxf'}),`${plan.name}-设计草稿.dxf`);
}
