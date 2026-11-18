"use client";
import {useMemo,useEffect} from 'react';
import {BoxGeometry,CanvasTexture,SRGBColorSpace,Matrix4} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {pointInPolygon,roomPolygon} from '@/lib/layout';
import type {Plan} from '@/lib/plan';

function buildRails(plan:Plan,ceiling:boolean){
 const batches:BoxGeometry[][]=[[],[],[]];
 for(const w of plan.walls){
  const dx=w.end.x-w.start.x,dz=w.end.y-w.start.y,length=Math.hypot(dx,dz);if(length<.12)continue;
  const ux=dx/length,uz=dz/length,theta=-Math.atan2(dz,dx);
  const gaps=plan.openings.filter(o=>o.wallId===w.id);
  for(const [tier,h,y,projection] of [[0,.079,.05,.015],[1,.05,w.height-.062,.082],[2,.018,w.height-.018,.061]]){
   if(tier>0&&!ceiling)continue;
   const cuts=[0,length,...gaps.flatMap(o=>[Math.max(0,o.position*length-o.width/2-.024),Math.min(length,o.position*length+o.width/2+.024)])].sort((a,b)=>a-b);
   for(let i=1;i<cuts.length;i++){const a=cuts[i-1],b=cuts[i],mid=(a+b)/2;if(b-a<.02||gaps.some(o=>Math.abs(o.position*length-mid)<=o.width/2+.023&&o.sill<y+h/2&&o.sill+o.height>y-h/2))continue;
    for(const side of [-1,1]){const nx=-uz*side,nz=ux*side,cx=w.start.x+ux*mid,cz=w.start.y+uz*mid;
     if(!plan.rooms.some(r=>pointInPolygon({x:cx+nx*(w.thickness/2+.06),y:cz+nz*(w.thickness/2+.06)},roomPolygon(r))))continue;
     const g=new BoxGeometry(b-a,h,projection);g.applyMatrix4(new Matrix4().makeRotationY(theta).setPosition(cx+nx*(w.thickness/2+projection/2),y,cz+nz*(w.thickness/2+projection/2)));batches[tier].push(g);
    }
   }
  }
 }
 return batches.map(list=>{const geom=list.length?mergeGeometries(list):null;list.forEach(g=>g.dispose());return geom;});
}
export function FinishRails({plan,ceiling}:{plan:Plan;ceiling:boolean}){
 const rails=useMemo(()=>buildRails(plan,ceiling),[plan.rooms,plan.openings,plan.walls,ceiling]);useEffect(()=>()=>rails.forEach(g=>g?.dispose()),[rails]);
 return <group name="interior-finish-rails">{rails.map((g,i)=>g&&<mesh key={i} geometry={g} receiveShadow><meshStandardMaterial color={['#b9ab97','#ede5d7','#f3dcb7'][i]} roughness={.82}/></mesh>)}</group>;
}
function makePrint(){
 const c=document.createElement('canvas');c.width=768;c.height=360;const p=c.getContext('2d')!;
 p.fillStyle='#dfd4b9';p.fillRect(0,0,768,360);let seed=14;const rnd=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 for(let band=0;band<6;band++){
  const center=89+band*36,offset=rnd()*8;const path=(x:number)=>center+24*Math.sin(x*.014+offset)+11*Math.sin(x*.047+band)+50*Math.cos(x*.003+band*.63);
  p.beginPath();p.moveTo(0,360);for(let x=0;x<=770;x+=2)p.lineTo(x,path(x)+rnd()*2);p.lineTo(770,360);p.closePath();
  const g=p.createLinearGradient(0,center-30,0,center+65);g.addColorStop(0,'rgba(62,68,62,'+(.19+band*.055)+')');g.addColorStop(1,'rgba(170,164,146,.13)');p.fillStyle=g;p.fill();
  for(let i=0;i<1900;i++){const x=rnd()*768,y=path(x)+rnd()**2*49;p.fillStyle='rgba(77,73,59,'+rnd()*.18+')';p.fillRect(x,y,1+rnd()*2,1+rnd()*3);}
 }
 p.fillStyle='#9a5344';p.fillRect(710,42,7,14);const t=new CanvasTexture(c);t.colorSpace=SRGBColorSpace;return t;
}
export function ReferencePrint({plan}:{plan:Plan}){
 const tex=useMemo(makePrint,[]);useEffect(()=>()=>tex.dispose(),[tex]);
 const w=plan.walls.find(w=>w.id==='ref-north');if(!w)return null;
 const dx=w.end.x-w.start.x,dz=w.end.y-w.start.y,l=Math.hypot(dx,dz),x=1.12;if(l<3||plan.openings.some(o=>o.wallId===w.id&&Math.abs(o.position*l-x)<.79+o.width/2&&o.sill<2.02&&o.sill+o.height>1.1))return null;
 return <group name="sample-landscape-print" position={[w.start.x,0,w.start.y]} rotation={[0,-Math.atan2(dz,dx),0]}><group position={[x,1.57,w.thickness/2+.027]}>
  <mesh castShadow receiveShadow><boxGeometry args={[1.52,.84,.045]}/><meshStandardMaterial color="#67513a" roughness={.62}/></mesh>
  <mesh position={[0,0,.023]} receiveShadow><planeGeometry args={[1.485,.805]}/><meshStandardMaterial color="#f1e8d5" roughness={.96}/></mesh>
  <mesh position={[0,0,.024]} receiveShadow><planeGeometry args={[1.34,.64]}/><meshStandardMaterial map={tex} roughness={.97}/></mesh>
 </group></group>;
}
