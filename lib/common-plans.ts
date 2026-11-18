import {normalizePlan} from './layout';
import type {Furniture, Opening, Plan, Room, Wall} from './plan';

export interface CommonPlanTemplate {id:string;title:string;description:string;make:()=>Plan}

function builder(name:string,width:number,depth:number){
  const rooms:Room[]=[], walls:Wall[]=[], openings:Opening[]=[], furniture:Furniture[]=[];
  function room(id:string,label:string,left:number,top:number,span:number,length:number,wet=false){
    rooms.push({id,name:label,x:left,y:top,width:span,depth:length,floorMaterialId:wet?'tile-warm':'oak-natural',wallMaterialId:'plaster-warm'});
  }
  function wall(id:string,x1:number,y1:number,x2:number,y2:number,external=false){
    walls.push({id,start:{x:x1,y:y1},end:{x:x2,y:y2},height:2.8,thickness:external?.2:.14,materialId:'plaster-warm'});
  }
  function opening(kind:Opening['kind'],wallId:string,distance:number,span:number,sill=0){
    const host=walls.find(segment=>segment.id===wallId)!;
    openings.push({id:`opening-${openings.length+1}`,wallId,kind,position:distance/Math.hypot(host.end.x-host.start.x,host.end.y-host.start.y),width:span,height:kind==='door'?2.12:Math.min(1.6,2.48-sill),sill});
  }
  function piece(kind:Furniture['kind'],label:string,centerX:number,centerY:number,span:number,length:number,height:number,rotation=0){
    furniture.push({id:`item-${furniture.length+1}`,kind,name:label,x:centerX,y:centerY,width:span,depth:length,height,rotation,materialId:['bed','chair','sofa'].includes(kind)?'linen-cream':'wood-oak'});
  }
  wall('north',0,0,width,0,true);wall('south',0,depth,width,depth,true);wall('west',0,0,0,depth,true);wall('east',width,0,width,depth,true);
  return {room,wall,piece,door:(wallId:string,at:number,span=.9)=>opening('door',wallId,at,span),window:(wallId:string,at:number,span:number,sill=.8)=>opening('window',wallId,at,span,sill),finish:()=>normalizePlan({version:1,name,width,depth,ceilingHeight:2.8,rooms,walls,openings,furniture,nodes:[],routes:[],verified:false})};
}
function oneBedroom(){
  const home=builder('阳光一居 · 开放式餐厨',7.8,6.4);
  home.room('living','客餐厨',0,0,4.2,6.4);home.room('master','卧室',4.2,0,3.6,4.05);home.room('bath','卫浴',4.2,4.05,3.6,2.35,true);
  home.wall('bed-split',4.2,0,4.2,6.4);home.wall('wet-split',4.2,4.05,7.8,4.05);
  home.door('south',3.55,1);home.door('bed-split',3.15);home.door('bed-split',5.25);
  home.window('north',2,2.55);home.window('north',6.1,1.9);home.window('east',5.46,1.1,1.3);home.window('west',4.85,1.25,1.06);
  home.piece('sofa','布艺沙发',1.8,.83,2.28,.88,.83);home.piece('table','椭圆茶几',1.82,2.04,1.12,.58,.42);
  home.piece('table','早餐桌',2.78,4,1.13,.68,.76);home.piece('chair','木餐椅',2.78,4.83,.49,.5,.85,180);
  home.piece('cabinet','一字型厨房',.52,4.68,2.8,.63,.88,90);home.piece('bed','双人床',6.24,1.62,1.68,2.05,.83);
  home.piece('cabinet','衣柜',6.72,3.56,1.58,.59,2.39);home.piece('cabinet','洗面台',6.92,5.87,1.2,.51,.89);return home.finish();
}
function corridorHome(three:boolean){
  const width=three?11.4:10,depth=three?9.2:7.2,upper=three?4.35:3.43,corridor=1.18,lower=upper+corridor;
  const living=three?6.95:5.52;
  const southRooms=three?
    [{id:'second',name:'次卧',width:3.37},{id:'third',name:'儿童房',width:3.17},{id:'kitchen',name:'厨房',width:2.72},{id:'bath',name:'卫浴',width:2.14}]:
    [{id:'second',name:'次卧',width:4.04},{id:'kitchen',name:'厨房',width:3.43},{id:'bath',name:'卫浴',width:2.53}];
  const home=builder(three?'晴庭三居 · 三卧家庭户型':'双向采光 · 两室一厅',width,depth);
  home.room('living','客餐厅',0,0,living,upper);home.room('master','主卧',living,0,width-living,upper);home.room('hall','走廊',0,upper,width,corridor);
  home.wall('upper-partition',living,0,living,upper);home.wall('corridor-upper',0,upper,width,upper);home.wall('corridor-lower',0,lower,width,lower);
  home.door('west',upper+corridor/2,.96);home.door('corridor-upper',living-.79,1.04);home.door('corridor-upper',living+.82,.92);
  home.window('north',living*.48,living*.5);home.window('north',(width+living)/2,(width-living)*.55);
  home.piece('sofa','三人布艺沙发',living*.57,.78,three?2.7:2.3,.9,.88);home.piece('table','橡木茶几',living*.57,2.08,1.3,.65,.43);
  home.piece('table','小餐桌',1.06,upper-1.12,1.1,.85,.75);home.piece('chair','餐椅',1.08,upper-.38,.49,.46,.85,180);
  home.piece('bed','双人床',living+(width-living)*.6,1.53,1.7,2.08,.83);
  home.piece('cabinet','主卧衣柜',width-1.45,upper-.49,2.05,.59,2.4);
  let left=0;
  for(const section of southRooms){
    const span=section.width,length=depth-lower,wet=section.id==='kitchen'||section.id==='bath';
    home.room(section.id,section.name,left,lower,span,length,wet);
    if(left>0)home.wall('partition-'+section.id,left,lower,left,depth);
    home.door('corridor-lower',left+(wet?span*.39:.72),wet?.82:.9);
    home.window('south',left+span*.55,span*.48,wet?1.24:.82);
    if(!wet){
      if(three)home.piece('bed','单人床',left+span*.64,lower+length*.52,1.22,2,.73);
      else home.piece('bed','次卧床',left+span*.63,lower+length*.55,1.28,1.95,.75,90);
      if(three)home.piece('table','阅读书桌',left+.65,depth-.53,.85,.55,.73);
    }else if(section.id==='kitchen')home.piece('cabinet','备餐与洗涤台',left+span-.5,lower+length*.53,length*.72,.58,.88,90);
    else home.piece('cabinet','浴室柜',left+span*.62,depth-.44,span*.48,.5,.86);
    left+=span;
  }
  return home.finish();
}
export const COMMON_PLANS:CommonPlanTemplate[]=[
  {id:'sunny-one',title:'开放式一居',description:'约 50 m² · 一室一厅，客厅与餐厨相连',make:oneBedroom},
  {id:'cross-two',title:'双向采光两居',description:'72 m² · 两室一厅，中间走廊连接各房间',make:()=>corridorHome(false)},
  {id:'family-three',title:'家庭三居',description:'约 105 m² · 主卧、次卧与儿童房，各自独立出入',make:()=>corridorHome(true)},
];
