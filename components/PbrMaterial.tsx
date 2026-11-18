"use client";
import {createContext,useContext,useEffect,useMemo} from 'react';
import {useTexture} from '@react-three/drei';
import {Color,NoColorSpace,RepeatWrapping,SRGBColorSpace,Vector2} from 'three';
import type {Side} from 'three';
import type {MaterialDefinition} from '@/lib/plan';

export const WhiteModel=createContext(false);
type Props={material:MaterialDefinition;repeat?:[number,number];kind?:'wood'|'wall'|'stone'|'fabric';selected?:boolean;side?:Side};
const directory='/assets/realistic/';
function Textile({material,repeat=[2.5,2.5],selected,side}:Props){
 const sources=useTexture([directory+'linen-weave.jpg',directory+'linen-normal.jpg']);
 const maps=useMemo(()=>sources.map((original,i)=>{const map=original.clone();map.wrapS=map.wrapT=RepeatWrapping;map.repeat.set(...repeat);map.anisotropy=8;map.colorSpace=NoColorSpace;map.needsUpdate=true;return map;}),[sources,repeat[0],repeat[1]]);
 useEffect(()=>()=>maps.forEach(m=>m.dispose()),[maps]);
 return <meshPhysicalMaterial color={material.color} map={maps[0]} normalMap={maps[1]} normalScale={new Vector2(.27,.27)} roughness={.93} sheen={.51} sheenColor={material.color} sheenRoughness={.92} side={side} emissive={selected?'#8b552b':'#000000'} emissiveIntensity={selected?.06:0}/>;
}function Surface({material,repeat=[1,1],kind,selected,side}:Props){
 const chosen=kind??(material.category==='wall'?'wall':material.pattern==='wood'?'wood':'stone');const stem=chosen==='wood'?'oak':chosen==='wall'?'plaster':'marble';
 const sources=useTexture([`${directory}${stem}-color.jpg`,`${directory}${stem}-normal.jpg`,`${directory}${stem}-roughness.jpg`]);
 const textures=useMemo(()=>sources.map((source,index)=>{const texture=source.clone();texture.wrapS=texture.wrapT=RepeatWrapping;texture.repeat.set(...repeat);texture.anisotropy=8;texture.colorSpace=index===0?SRGBColorSpace:NoColorSpace;texture.needsUpdate=true;return texture;}),[sources,repeat[0],repeat[1]]);
 useEffect(()=>()=>textures.forEach(texture=>texture.dispose()),[textures]);
 const tint=new Color(material.color);const reference=new Color(chosen==='wood'?'#d7bf97':chosen==='wall'?'#eae3d6':'#e7e3dc');
 tint.r=Math.min(1.6,tint.r/Math.max(.01,reference.r));tint.g=Math.min(1.6,tint.g/Math.max(.01,reference.g));tint.b=Math.min(1.6,tint.b/Math.max(.01,reference.b));
 return <meshPhysicalMaterial name={`PBR-${material.id}`} color={tint} map={textures[0]} normalMap={textures[1]} normalScale={new Vector2(chosen==='wall'?.18:.45,chosen==='wall'?.18:.45)} roughnessMap={textures[2]} roughness={material.roughness} metalness={0} clearcoat={chosen==='wood'?.035:0} clearcoatRoughness={.5} side={side} emissive={selected?'#8b552b':'#000000'} emissiveIntensity={selected?.06:0}/>;
}
/** Local licensed base color, normal and roughness maps; no untextured loading phase. */
export default function PbrMaterial(props:Props){const white=useContext(WhiteModel);if(white)return <meshStandardMaterial name="white-model" side={props.side} roughness={.95} color={props.selected?'#b5c9a5':props.material.category==='floor'?'#c8c8c1':props.material.category==='furniture'?'#dddcd5':'#f1f0e9'}/>;return props.kind==='fabric'||props.material.pattern==='carpet'?<Textile {...props}/>:<Surface {...props}/>;}
