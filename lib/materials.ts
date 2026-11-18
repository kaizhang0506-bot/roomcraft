import type { MaterialDefinition } from './plan';
export const MATERIAL_LIBRARY: MaterialDefinition[] = [
  {id:'oak-natural',name:'浅橡木地板',category:'floor',color:'#d7bf97',roughness:.78,pattern:'wood',pricePerM2:180},
  {id:'walnut-floor',name:'胡桃木地板',category:'floor',color:'#826247',roughness:.72,pattern:'wood',pricePerM2:240},
  {id:'tile-warm',name:'暖灰地砖',category:'floor',color:'#d5d1c5',roughness:.62,pattern:'tile',pricePerM2:120},
  {id:'marble-white',name:'浅色石材',category:'floor',color:'#e7e3dc',roughness:.28,pattern:'stone',pricePerM2:320},
  {id:'carpet-sand',name:'砂色地毯',category:'floor',color:'#bbaa91',roughness:1,pattern:'carpet',pricePerM2:150},
  {id:'plaster-warm',name:'暖白乳胶漆',category:'wall',color:'#eae3d6',roughness:.95,pattern:'solid',pricePerM2:38},
  {id:'plaster-sage',name:'鼠尾草绿墙面',category:'wall',color:'#aab39d',roughness:.9,pattern:'solid',pricePerM2:45},
  {id:'concrete-wall',name:'微水泥墙面',category:'wall',color:'#a9aaa5',roughness:.9,pattern:'stone',pricePerM2:160},
  {id:'linen-cream',name:'奶油亚麻',category:'furniture',color:'#e2d7c0',roughness:.95,pattern:'carpet'},
  {id:'wood-oak',name:'自然橡木',category:'furniture',color:'#c4a77c',roughness:.72,pattern:'wood'},
  {id:'wood-walnut',name:'深胡桃木',category:'furniture',color:'#70523d',roughness:.65,pattern:'wood'},
  {id:'charcoal',name:'炭灰织物',category:'furniture',color:'#555a57',roughness:.92,pattern:'carpet'},
];
export function getMaterial(id?:string, fallback='oak-natural'):MaterialDefinition {
  return MATERIAL_LIBRARY.find(m=>m.id===id)||MATERIAL_LIBRARY.find(m=>m.id===fallback)||MATERIAL_LIBRARY[0];
}
