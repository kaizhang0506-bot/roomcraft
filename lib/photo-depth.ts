export interface PhotoVertex {distance:number;dx:number;dy:number;dz:number}
const furniture:{outline:number[][];distance:number}[]=[
 {outline:[[284,292],[291,278],[307,273],[328,274],[342,285],[347,302],[341,316],[319,323],[295,320],[287,311]],distance:1.45},
 {outline:[[329,260],[348,250],[394,248],[422,257],[431,286],[418,294],[348,301],[342,283]],distance:2.12},
 {outline:[[405,233],[412,216],[429,210],[450,211],[472,216],[493,214],[522,221],[530,234],[538,244],[530,290],[509,300],[478,294],[451,278],[430,266],[411,252]],distance:2.32},
 {outline:[[619,230],[629,219],[665,224],[686,221],[721,222],[750,230],[738,282],[733,302],[672,313],[626,294]],distance:2.0},
 {outline:[[300,216],[322,215],[345,231],[341,248],[300,261]],distance:2.95},
 {outline:[[183,242],[210,229],[262,224],[268,251],[206,287],[185,281]],distance:2.6}
];
function inside(x:number,y:number,points:number[][]){let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const [ax,ay]=points[j],[bx,by]=points[i];if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)hit=!hit;}return hit;}
export function photoVertex(u:number,v:number,sample:boolean):PhotoVertex {
 const az=(u-.5)*2*Math.PI,el=(.5-v)*Math.PI,ce=Math.cos(el);
 const dx=Math.sin(az)*ce,dy=Math.sin(el),dz=-Math.cos(az)*ce;
 const wall=Math.min(3.65/Math.max(Math.abs(dx),.001),4.35/Math.max(Math.abs(dz),.001));
 let distance=Math.min(wall,dy>0?1.35/Math.max(.001,dy):1.65/Math.max(.001,-dy));
 if(sample){const item=furniture.find(f=>inside(u*800,v*400,f.outline));if(item)distance=Math.min(distance,item.distance/Math.max(.65,ce));}
 return {dx,dy,dz,distance};
}
