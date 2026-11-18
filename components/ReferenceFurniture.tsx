"use client";

import {useEffect, useMemo} from 'react';
import {Line} from '@react-three/drei';
import {BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, DoubleSide, Euler, Float32BufferAttribute, Matrix4, Quaternion, SphereGeometry, TubeGeometry, Vector3} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import type {MaterialDefinition} from '@/lib/plan';
import type {RealisticFurnitureProps} from './RealisticFurniture';
import PbrMaterial from './PbrMaterial';

type Point3 = [number,number,number];
type Surface = 'body'|'oak'|'darkWood'|'linen'|'ivory'|'flax'|'seam'|'metal'|'brass'|'ceramic'|'stone'|'glass'|'leaf'|'leafLight'|'leafDark'|'earth'|'light'|'ink';
type Parts = Map<Surface,BufferGeometry[]>;
const origin:Point3=[0,0,0];
const sides=[-1,1];
const woven=(id:string,color:string):MaterialDefinition=>({id,name:id,category:'furniture',color,roughness:.94,pattern:'carpet'});
const timber=(id:string,color:string):MaterialDefinition=>({id,name:id,category:'furniture',color,roughness:.75,pattern:'wood'});
const library:Partial<Record<Surface,MaterialDefinition>>={
  oak:timber('reference-oak','#c3a080'), darkWood:timber('reference-walnut','#927456'),
  ivory:woven('reference-ivory','#f1ebe0'),linen:woven('reference-linen','#e4d8c3'),flax:woven('reference-flax','#b6a48c'),
  stone:{id:'reference-limestone',name:'米白石材',category:'furniture',color:'#dbd6ce',roughness:.55,pattern:'stone'},
};
const finish:Partial<Record<Surface,[string,number,number]>>={
  seam:['#b1a694',1,0],metal:['#9d9d96',.28,.78],brass:['#b39764',.38,.65],ceramic:['#ddd4c4',.34,.02],leaf:['#516b39',.61,0],leafLight:['#788449',.64,0],leafDark:['#374a2d',.63,0],earth:['#45372c',.99,0],light:['#fff2d4',.79,0],ink:['#393a38',.53,.09],
};

function add(parts:Parts,role:Surface,geometry:BufferGeometry,position:Point3=origin,size:Point3=[1,1,1],angles:Point3=origin){
  geometry.applyMatrix4(new Matrix4().compose(new Vector3(...position),new Quaternion().setFromEuler(new Euler(...angles)),new Vector3(...size)));
  geometry.clearGroups();
  const flat=geometry.index?geometry.toNonIndexed():geometry;
  if(flat!==geometry)geometry.dispose();
  const batch=parts.get(role)??[];batch.push(flat);parts.set(role,batch);
}
function box(parts:Parts,role:Surface,pos:Point3,size:Point3,angles:Point3=origin){add(parts,role,role==='body'||role==='oak'?new RoundedBoxGeometry(1,1,1,2,.012):new BoxGeometry(1,1,1),pos,size,angles);}
function cylinder(parts:Parts,role:Surface,pos:Point3,size:Point3,top=1,bottom=1,segments=28){add(parts,role,new CylinderGeometry(top/2,bottom/2,1,segments),pos,size);}
function signedPower(value:number,exponent:number){return Math.sign(value)*Math.pow(Math.abs(value),exponent);}
function pillow(parts:Parts,role:Surface,pos:Point3,size:Point3,angles:Point3=origin,exponent=.44,curve=0){
  const foliage=role==='leaf'||role==='leafLight'||role==='leafDark';
  const shell=new SphereGeometry(1,foliage?12:44,foliage?8:24),vertices=shell.attributes.position;
  for(let index=0;index<vertices.count;index++){
    const x=signedPower(vertices.getX(index),exponent),y=signedPower(vertices.getY(index),exponent),z=signedPower(vertices.getZ(index),exponent);
        const cloth=!foliage&&['body','linen','flax','ivory'].includes(role);
    const fold=cloth?.016*Math.sin(11*x+3.1*y)*Math.cos(4.6*y-3*z)*(1-y*y)*Math.exp(-((Math.abs(x)-.74)**2)*17):0;
    vertices.setXYZ(index,x*(.5+fold),y/2+curve*(1-z)*.5,z*(.5+fold));
  }
  shell.computeVertexNormals();add(parts,role,shell,pos,size,angles);
}
function path(parts:Parts,role:Surface,points:Point3[],radius:number,steps=10){
  const curve=new CatmullRomCurve3(points.map(point=>new Vector3(...point)),false,'centripetal');
  add(parts,role,new TubeGeometry(curve,steps,radius,8,false));
}
function chairLegs(parts:Parts,top:number,width=.34,depth=.34){
  for(const side of sides)for(const end of sides)path(parts,'darkWood',[[side*(width+.055),.02,end*(depth+.05)],[side*width,top,end*depth]],.027,1);
}
function bowl(parts:Parts,pos:Point3,size=.14){
  cylinder(parts,'ceramic',pos,[size,size*.27,size],1,.52);
  cylinder(parts,'earth',[pos[0],pos[1]+size*.14,pos[2]],[size*.76,.005,size*.76]);
}
function books(parts:Parts,pos:Point3,scale=.17){
  box(parts,'flax',pos,[scale,.029,scale*.72],[0,.11,0]);
  box(parts,'ivory',[pos[0]+.008,pos[1]+.026,pos[2]],[scale*.86,.025,scale*.62],[0,-.09,0]);
}
function tinyPlant(parts:Parts,pos:Point3,scale:number){
  cylinder(parts,'ceramic',[pos[0],pos[1]+scale*.19,pos[2]],[scale*.57,scale*.38,scale*.57],1,.72,20);
  for(let index=0;index<7;index++){
    const angle=index*2.39996;
    pillow(parts,index%2?'leaf':'leafLight',[pos[0]+Math.sin(angle)*scale*.16,pos[1]+scale*(.44+(index%3)*.08),pos[2]+Math.cos(angle)*scale*.16],[scale*.19,scale*.38,scale*.075],[.5,angle,.48],.9);
  }
}
function sofa(parts:Parts){
  pillow(parts,'darkWood',[0,.075,.005],[.85,.09,.8],origin,.34);
  pillow(parts,'body',[0,.265,0],[.98,.38,.95],origin,.42);
  for(const side of sides)pillow(parts,'body',[side*.199,.485,.055],[.399,.215,.74],[0,side*.009,side*.012],.41);
  pillow(parts,'body',[0,.675,-.335],[.905,.605,.265],[-.1,0,0],.66);
  for(const side of sides){
    pillow(parts,'body',[side*.423,.494,-.004],[.163,.34,.855],[.17,side*.096,side*-.105],.64,.28);
    pillow(parts,side===1?'flax':'linen',[side*.265,.71,-.105],[.17,.44,.195],[-.22,side*.22,side*.24],.57);
  }
}
function bedding(parts:Parts,single:boolean){
  pillow(parts,'oak',[0,.25,0],[.98,.22,.99],origin,.22);
  box(parts,'darkWood',[0,.085,0],[.9,.12,.9]);
  pillow(parts,'ivory',[0,.46,0],[.975,.285,.96],origin,.3);
  pillow(parts,'body',[0,.56,-.464],[1,.88,.076],origin,.29);
  pillow(parts,'body',[0,.59,.117],[.996,.23,.704],origin,.33);
  pillow(parts,'flax',[0,.64,.276],[.998,.17,.243],origin,.37);
  for(const side of single?[0]:sides){
    pillow(parts,'ivory',[side*.239,.69,-.292],[single?.72:.436,.19,.22],[-.15,side*.035,0],.55);
  }
}
function meals(parts:Parts,variant:string){
  if(variant==='dining-chair'){
    chairLegs(parts,.5,.32,.3);
    pillow(parts,'body',[0,.53,0],[.88,.11,.87],origin,.58);
    for(const side of sides)path(parts,'oak',[[side*.34,.48,-.27],[side*.4,.72,-.32],[side*.385,.88,-.28]],.034,5);
    path(parts,'oak',[[-.433,.8,-.14],[-.37,.899,-.316],[0,.95,-.395],[.37,.899,-.316],[.433,.8,-.14]],.066,22);
    return;
  }
  if(variant==='round-dining'){
    cylinder(parts,'body',[0,.891,0],[1,.083,1],1,.98,64);
    cylinder(parts,'darkWood',[0,.425,0],[.36,.86,.36],.72,1,40);
    cylinder(parts,'darkWood',[0,.047,0],[.54,.077,.54],.94,1,40);
    bowl(parts,[0,.957,0],.18);return;
  }
  if(variant==='coffee-table'){
    pillow(parts,'body',[0,.74,0],[1,.158,.95],origin,.58);
    for(const side of sides)cylinder(parts,'darkWood',[side*.285,.335,0],[.167,.68,.55],.87,1,24);
    bowl(parts,[-.197,.857,.045],.21);tinyPlant(parts,[.207,.821,-.023],.206);return;
  }
  box(parts,'body',[0,.833,0],[1,.074,.94]);chairLegs(parts,.83,.434,.352);
  box(parts,'oak',[.21,.722,-.005],[.41,.145,.74]);books(parts,[-.288,.887,.067],.225);tinyPlant(parts,[.303,.874,-.12],.234);
}
function cabinet(parts:Parts,variant:string){
  const night=variant==='nightstand',short=variant==='media-console',bath=variant==='vanity',kitchen=variant==='kitchen';
  if(variant==='bookcase'){
    box(parts,'darkWood',[0,.49,-.43],[.97,.97,.076]);
    for(const side of sides)box(parts,'body',[side*.478,.5,0],[.043,1,1]);
    for(let shelf=0;shelf<=4;shelf++)box(parts,'body',[0,.055+shelf*.228,0],[.98,.035,.99]);
    for(let shelf=0;shelf<4;shelf++)for(let index=0;index<4;index++){
      const height=.11+((shelf+index)%3)*.028;
      box(parts,['linen','flax','darkWood','ivory'][(index+shelf)%4] as Surface,[-.357+shelf*.038+index*.099,.073+shelf*.228+height/2,.01],[.071,height,.6]);
    }return;
  }
  const cabinetTop=night?.53:(short?.875:(bath||kitchen)?.837:1);
  box(parts,'darkWood',[0,.059,0],[.918,.112,.87]);box(parts,'body',[0,cabinetTop*.535,-.016],[.99,cabinetTop*.925,.934]);
  const panels=night?1:short?3:2;
  for(let index=0;index<panels;index++){
    const center=-.5+(index+.5)/panels;
    box(parts,'body',[center,cabinetTop*.535,.46],[1/panels-.01,cabinetTop*.855,.067]);
    box(parts,'brass',[center+.21/panels,cabinetTop*.57,.498],[.009,cabinetTop*.123,.011]);
  }
  if(kitchen||bath){
    box(parts,'stone',[0,.864,0],[1,.074,.99]);
    const sink=kitchen?.18:0;
    pillow(parts,'metal',[sink,.905,.02],[.29,.031,.569],origin,.23);
    pillow(parts,'ink',[sink,.919,.024],[.228,.012,.43],origin,.32);
    path(parts,'metal',[[sink,.904,-.34],[sink,.985,-.35],[sink,1,-.272],[sink,.968,-.199]],.012,10);
    if(kitchen){box(parts,'ink',[-.309,.906,.04],[.229,.017,.66]);for(const end of sides)cylinder(parts,'metal',[-.309,.921,.04+end*.155],[.12,.011,.17],1,1,20);}
    else tinyPlant(parts,[-.37,.904,-.16],.17);
  }else if(night){
    cylinder(parts,'brass',[0,.615,0],[.14,.16,.14]);pillow(parts,'light',[0,.785,0],[.5,.396,.5],origin,.92);
  }else if(short){
    books(parts,[-.29,.895,.015],.147);bowl(parts,[.268,.904,-.02],.147);
  }
}
function greenery(parts:Parts){
  cylinder(parts,'body',[0,.155,0],[.43,.31,.43],1,.72,48);
  cylinder(parts,'earth',[0,.312,0],[.412,.01,.412]);
  path(parts,'darkWood',[[0,.279,0],[.02,.554,-.024],[-.045,.735,.022],[.015,.935,-.012]],.019,12);
  for(let branch=0;branch<10;branch++){
    const angle=branch*2.39996,reach=.315-(branch%3)*.035,base=.385+branch*.046;
    const ex=Math.sin(angle)*reach,ez=Math.cos(angle)*reach;
    path(parts,'darkWood',[[0,base,0],[ex*.49,base+.08,ez*.49],[ex,base+.128,ez]],.007,5);
    for(let pair=0;pair<5;pair++){
      const sign=pair%2?1:-1,spread=.045+pair*.009,along=.33+pair*.138;
      pillow(parts,(branch+pair)%3===0?'leafLight':(branch+pair)%3===1?'leaf':'leafDark',[ex*along+sign*Math.cos(angle)*spread,base+.077+pair*.017,ez*along-sign*Math.sin(angle)*spread],[.117,.137,.032],[.33,angle+sign*.55,sign*.58],.92);
    }
  }
}
function curtains(parts:Parts){
  for(const side of sides){
    const vertices:number[]=[],uv:number[]=[],indices:number[]=[];
    const columns=36,rows=9;
    for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++){
      const fraction=column/columns,fromFloor=row/rows,spread=.19+.035*(1-fromFloor),fold=fraction*Math.PI*9+.24*Math.sin(fraction*9+fromFloor*3);
      vertices.push(side*(.49-fraction*spread),.035+fromFloor*.93+.008*Math.cos(fold)*(1-fromFloor),Math.cos(fold)*(.23+.15*(1-fromFloor))+.05*Math.sin(fromFloor*6+fold)*Math.sin(fromFloor*Math.PI));
      uv.push(fraction,fromFloor);
      if(row<rows&&column<columns){const base=row*(columns+1)+column;indices.push(base,base+1,base+columns+2,base,base+columns+2,base+columns+1);}
    }
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();add(parts,'body',geometry);
  }
  box(parts,'brass',[0,.984,-.25],[1,.013,.12]);
}
function shower(parts:Parts){
  box(parts,'body',[0,.025,0],[1,.045,1]);
  box(parts,'glass',[-.476,.5,0],[.012,.98,.99]);box(parts,'glass',[0,.5,.478],[.945,.98,.012]);
  for(const side of sides)box(parts,'metal',[side*.473,.5,.478],[.02,.996,.024]);
  box(parts,'metal',[0,.988,.478],[.96,.018,.024]);box(parts,'metal',[-.476,.988,0],[.02,.018,.97]);
  path(parts,'metal',[[.12,.46,-.437],[.12,.86,-.437],[.12,.865,-.203]],.013,8);
  cylinder(parts,'metal',[.12,.855,-.198],[.14,.018,.14],1,1,20);
}
function model(variant:string){
  const parts:Parts=new Map();
  if(variant==='sofa')sofa(parts);
  else if(variant==='double-bed'||variant==='single-bed')bedding(parts,variant==='single-bed');
  else if(['dining-chair','round-dining','coffee-table','desk'].includes(variant))meals(parts,variant);
  else if(variant==='plant')greenery(parts);
  else if(variant==='curtain')curtains(parts);
  else if(variant==='shower')shower(parts);
  else if(variant==='toilet'){
    pillow(parts,'body',[0,.225,.025],[.69,.45,.69],origin,.69);
    pillow(parts,'body',[0,.465,.075],[.97,.244,.795],origin,.74);
    pillow(parts,'ivory',[0,.601,.077],[.935,.063,.775],origin,.7);
    pillow(parts,'body',[0,.726,-.326],[.92,.517,.315],origin,.31);
    box(parts,'metal',[0,.986,-.331],[.18,.009,.057]);
  }
  else if(variant==='rug'){box(parts,'flax',[0,.34,0],[1,.64,1]);box(parts,'body',[0,.74,0],[.981,.46,.977]);}
  else cabinet(parts,variant);
  return [...parts].map(([role,geometries])=>{
    const merged=mergeGeometries(geometries,false)!;geometries.forEach(piece=>piece.dispose());return {role,geometry:merged};
  });
}

function Finish({role,material}:{role:Surface;material:MaterialDefinition}){
  const chosen=role==='body'?material:library[role];
  if(chosen)return <PbrMaterial material={chosen} kind={chosen.pattern==='carpet'?'fabric':chosen.pattern==='wood'?'wood':'stone'} side={DoubleSide}/>;
  if(role==='glass')return <meshPhysicalMaterial transparent opacity={.18} color="#c7d7cc" roughness={.1} metalness={.02} depthWrite={false} side={DoubleSide}/>;
  const [color,roughness,metalness]=finish[role]??['#e8dfce',.8,0];
  return <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} emissive={role==='light'?'#ffe1b6':'#000000'} emissiveIntensity={role==='light'?.15:0}/>;
}
export default function ReferenceFurniture({variant,item,material,selected,onSelect}:RealisticFurnitureProps & {variant:string}){
  const batches=useMemo(()=>model(variant),[variant]);
  useEffect(()=>()=>batches.forEach(batch=>batch.geometry.dispose()),[batches]);
  const width=item.width,depth=item.depth;
  return <group name={`furniture-${item.id}`} userData={{furnitureId:item.id,kind:item.kind,referenceVariant:variant}} position={[item.x,0,item.y]} rotation={[0,-item.rotation*Math.PI/180,0]} onClick={event=>{event.stopPropagation();onSelect();}}>
    <group scale={[width,item.height,depth]}>{batches.map(({role,geometry})=><mesh key={role} geometry={geometry} castShadow={role!=='glass'} receiveShadow><Finish role={role} material={material}/></mesh>)}</group>
    {selected&&<Line points={[[-width/2-.035,.022,-depth/2-.035],[width/2+.035,.022,-depth/2-.035],[width/2+.035,.022,depth/2+.035],[-width/2-.035,.022,depth/2+.035],[-width/2-.035,.022,-depth/2-.035]]} color="#bc654c" lineWidth={1.5}/>}
  </group>;
}
