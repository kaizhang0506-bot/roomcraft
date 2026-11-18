import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.sites-runtime','environment-building-check');
await mkdir(out,{recursive:true});
await build({entryPoints:['environment','building','plan','validation','share'].map(name=>path.join(root,'lib',name+'.ts')),outdir:out,bundle:true,platform:'node',format:'esm',target:'node24',outExtension:{'.js':'.mjs'},logLevel:'silent'});
const load=name=>import(pathToFileURL(path.join(out,name+'.mjs')).href);
const {deriveEnvironment,DEFAULT_ENVIRONMENT,sanitizeEnvironmentSettings,isEnvironmentDate}=await load('environment');
const {setBuildingFloorCount,switchBuildingFloor,setBuildingFloorHeight,getBuildingSettings,getBuildingFloor,buildingBounds}=await load('building');
const {SAMPLE_PLAN,clonePlan}=await load('plan');
const {validatePlan}=await load('validation');
const {createProjectShareUrl,readSharedProject}=await load('share');
const checks=[];
async function check(name,run){await run();checks.push(name);}
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const env=(date,hour,extra={})=>deriveEnvironment({...DEFAULT_ENVIRONMENT,date,...extra},hour,0);
const assertFinite=value=>{
  if(typeof value==='number')assert.ok(Number.isFinite(value));
  else if(value&&typeof value==='object')Object.values(value).forEach(assertFinite);
};

await check('Shanghai summer and winter sunlight follow latitude and season',()=>{
  const summer=env('2026-06-21',12),winter=env('2026-12-21',12);
  assert.ok(summer.sunAltitude>80&&summer.sunAltitude<83);
  assert.ok(winter.sunAltitude>34&&winter.sunAltitude<37);
  assert.ok(summer.sunriseHour>4.7&&summer.sunriseHour<5.1);
  assert.ok(summer.sunsetHour>18.8&&summer.sunsetHour<19.3);
  assert.ok(winter.sunriseHour>6.7&&winter.sunriseHour<7.1);
  assert.ok(winter.sunsetHour>16.7&&winter.sunsetHour<17.2);
});
await check('sun moves east to west and both celestial direction vectors are normalized',()=>{
  const morning=env('2026-03-20',8),evening=env('2026-03-20',16);
  assert.ok(morning.sunDirection[0]>0);assert.ok(evening.sunDirection[0]<0);
  for(const state of [morning,evening]){near(Math.hypot(...state.sunDirection),1);near(Math.hypot(...state.moonDirection),1);}
});
await check('rotating true north rotates both visible and lighting directions without changing elevation',()=>{
  const a=deriveEnvironment(DEFAULT_ENVIRONMENT,8,0),b=deriveEnvironment(DEFAULT_ENVIRONMENT,8,90);
  for(const key of ['sunDirection','moonDirection']){near(b[key][0],-a[key][2]);near(b[key][1],a[key][1]);near(b[key][2],a[key][0]);}
  near(a.sunIntensity,b.sunIntensity);near(a.moonIllumination,b.moonIllumination);
});
await check('same instant in different UTC offsets has identical celestial directions',()=>{
  const local=env('2026-06-21',4),utc=env('2026-06-20',20,{utcOffset:0});
  for(const key of ['sunDirection','moonDirection'])local[key].forEach((value,i)=>near(value,utc[key][i]));
});
await check('sunset darkens exterior, removes direct sun and automatically enables room lamps',()=>{
  const noon=env('2026-06-21',12),midnight=env('2026-06-21',0);
  assert.ok(noon.daylight>.99&&midnight.night>.99);assert.equal(midnight.sunIntensity,0);
  assert.ok(midnight.environmentIntensity<noon.environmentIntensity*.15);
  assert.equal(noon.indoorLightLevel,0);near(midnight.indoorLightLevel,DEFAULT_ENVIRONMENT.indoorIntensity);
  assert.notEqual(noon.skyTopColor,midnight.skyTopColor);
});
await check('manual indoor lighting and weather attenuation are independent of room geometry',()=>{
  assert.equal(env('2026-06-21',0,{indoorLights:'off'}).indoorLightLevel,0);
  near(env('2026-06-21',12,{indoorLights:'on',indoorIntensity:.35}).indoorLightLevel,.35);
  const clear=env('2026-06-21',12),rain=env('2026-06-21',12,{weather:'rain'});
  assert.ok(rain.sunIntensity<clear.sunIntensity*.25);assert.ok(rain.clouds>clear.clouds);
});
await check('mean lunar phase agrees with published January 2000 new and full moon dates',()=>{
  const fresh=env('2000-01-06',18+14/60,{utcOffset:0}),full=env('2000-01-21',4+40/60,{utcOffset:0});
  near(fresh.moonIllumination,0);assert.ok(full.moonIllumination>.99);
  assert.ok(fresh.moonPhase<.001&&full.moonPhase>.47&&full.moonPhase<.53);
});
await check('polar summer/winter and invalid persisted preferences remain finite',()=>{
  for(const latitude of [-90,90])for(const date of ['2026-06-21','2026-12-21']){
    const state=env(date,12,{latitude});assertFinite(state);assert.equal(state.sunriseHour,null);assert.equal(state.sunsetHour,null);
  }
  const sanitized=sanitizeEnvironmentSettings({date:'2026-02-30',latitude:NaN,longitude:500,utcOffset:Infinity,indoorIntensity:-1});
  assert.equal(sanitized.date,DEFAULT_ENVIRONMENT.date);assert.equal(sanitized.longitude,180);assert.equal(sanitized.indoorIntensity,0);
  assertFinite(deriveEnvironment(sanitized,NaN,Infinity));
  assert.equal(isEnvironmentDate('2028-02-29'),true);assert.equal(isEnvironmentDate('2026-02-29'),false);
});

await check('old single-floor projects load unchanged without new required settings',()=>{
  assert.deepEqual(validatePlan(SAMPLE_PLAN),SAMPLE_PLAN);assert.equal(getBuildingSettings(SAMPLE_PLAN).activeFloor,1);
  const legacy=clonePlan();delete legacy.schemaVersion;delete legacy.ceilingHeight;delete legacy.materials;
  assert.equal(validatePlan(legacy).schemaVersion,2);
});
await check('floor 10 starts as an independent copy and later edits preserve floor 1',()=>{
  const original=clonePlan(),before=JSON.stringify(original);
  const tenth=switchBuildingFloor(setBuildingFloorCount(original,50),10);
  assert.equal(tenth.building.activeFloor,10);assert.deepEqual(tenth.rooms,original.rooms);
  tenth.furniture[0].x=9;tenth.rooms[0].polygon[0].x=.5;tenth.walls[0].start.x=.3;tenth.routes[0].points[0].x=.7;
  const first=switchBuildingFloor(tenth,1);
  assert.deepEqual(first.furniture,original.furniture);assert.deepEqual(first.rooms,original.rooms);assert.deepEqual(first.walls,original.walls);assert.deepEqual(first.routes,original.routes);
  assert.equal(JSON.stringify(original),before);
  const back=switchBuildingFloor(first,10);assert.equal(back.furniture[0].x,9);assert.equal(back.rooms[0].polygon[0].x,.5);
  assert.equal(first.building.floors['10'].furniture[0].x,9);assert.equal(back.building.floors['10'],undefined);
});
await check('reducing floor count archives higher-floor edits and restores them when expanded',()=>{
  let plan=switchBuildingFloor(setBuildingFloorCount(clonePlan(),20),10);plan.furniture[0].name='第十层家具';
  plan=setBuildingFloorCount(plan,3);assert.equal(plan.building.activeFloor,3);assert.equal(plan.building.totalFloors,3);
  assert.equal(plan.building.floors['10'].furniture[0].name,'第十层家具');validatePlan(plan);
  plan=switchBuildingFloor(setBuildingFloorCount(plan,20),10);assert.equal(plan.furniture[0].name,'第十层家具');
});
await check('floor count and height bounds reject invalid input before modifying data',()=>{
  const original=clonePlan(),before=JSON.stringify(original);
  for(const count of [0,51,1.5,Infinity,NaN])assert.throws(()=>setBuildingFloorCount(original,count));
  for(const floor of [0,2,51,NaN])assert.throws(()=>switchBuildingFloor(original,floor));
  for(const height of [0,2,13,NaN])assert.throws(()=>setBuildingFloorHeight(original,height));
  assert.equal(JSON.stringify(original),before);
});
await check('building floor height fits walls and archived floors without clipping stored geometry',()=>{
  const tall=clonePlan();tall.walls[0].height=4.1;
  const building=setBuildingFloorCount(tall,10);near(building.building.floorHeight,4.1);
  const second=switchBuildingFloor(building,2);second.walls[0].height=2.8;
  assert.throws(()=>setBuildingFloorHeight(second,3.2));near(setBuildingFloorHeight(second,4.5).building.floorHeight,4.5);
  assert.equal(getBuildingFloor(second,1).walls[0].height,4.1);
});
await check('only the active floor is authoritative; selecting it again keeps unsaved edits',()=>{
  const plan=setBuildingFloorCount(clonePlan(),3);plan.furniture[0].name='当前编辑';
  assert.equal(switchBuildingFloor(plan,1).furniture[0].name,'当前编辑');
  assert.equal(getBuildingFloor(plan,1),plan);
});
await check('all 50 floors retain independent edits without recursive project snapshots',()=>{
  let plan=setBuildingFloorCount(clonePlan(),50);
  for(let floor=1;floor<=50;floor++){
    plan=switchBuildingFloor(plan,floor);plan.furniture[0].name=`第 ${floor} 层沙发`;
  }
  assert.equal(Object.keys(plan.building.floors).length,49);
  for(const floor of [1,25,50,10]){
    plan=switchBuildingFloor(plan,floor);assert.equal(plan.furniture[0].name,`第 ${floor} 层沙发`);
    assert.equal(plan.building.floors[String(floor)],undefined);
  }
  const stored=JSON.parse(JSON.stringify(plan));validatePlan(stored);
  for(const floor of Object.values(stored.building.floors)){assert.equal(floor.building,undefined);assert.equal(floor.environment,undefined);assert.equal(floor.name,undefined);}
  assert.ok(JSON.stringify(stored).length<1024*1024,'sample building must remain usable with the existing share size budget');
});
await check('whole-building camera bounds include wider saved floors while excluding archived floors',()=>{
  let plan=setBuildingFloorCount(clonePlan(),50);plan.walls[0].start.x=-8;
  plan=switchBuildingFloor(plan,10);plan.walls[0].start.x=0;
  assert.ok(buildingBounds(plan).x<-8);
  plan=switchBuildingFloor(plan,50);plan.walls[0].start.x=-30;
  plan=setBuildingFloorCount(plan,10);
  const bounds=buildingBounds(plan);assert.ok(bounds.x<-8&&bounds.x>-9);
  plan=setBuildingFloorCount(plan,50);assert.ok(buildingBounds(plan).x<-30);
});
await check('deleting furniture or changing recognition on one floor does not leak to another floor',()=>{
  let plan=setBuildingFloorCount(clonePlan(),2);
  plan.recognition={provider:'floor-one',needsReview:true,warnings:['仅第一层需要校对']};
  plan=switchBuildingFloor(plan,2);plan.furniture=[];plan.recognition=undefined;
  plan=switchBuildingFloor(plan,1);assert.equal(plan.furniture.length,SAMPLE_PLAN.furniture.length);assert.equal(plan.recognition.provider,'floor-one');
  plan=switchBuildingFloor(plan,2);assert.equal(plan.furniture.length,0);assert.equal(plan.recognition,undefined);
});
await check('environment and independent floors survive JSON save/load with common project name',()=>{
  let plan=setBuildingFloorCount(clonePlan(),12);plan.environment={...DEFAULT_ENVIRONMENT,hour:21,north:45};
  plan=switchBuildingFloor(plan,10);plan.name='独立楼层项目';plan.furniture[0].name='十层沙发';
  const roundtrip=validatePlan(JSON.parse(JSON.stringify(plan)));
  assert.deepEqual(roundtrip.environment,plan.environment);assert.equal(roundtrip.building.activeFloor,10);
  const first=switchBuildingFloor(roundtrip,1);assert.equal(first.name,'独立楼层项目');assert.deepEqual(first.environment,plan.environment);
  assert.notEqual(first.furniture[0].name,'十层沙发');assert.equal(first.building.floors['10'].furniture[0].name,'十层沙发');
});
await check('saved floors validate their own material and wall references, not the active floor IDs',()=>{
  const plan=switchBuildingFloor(setBuildingFloorCount(clonePlan(),2),2);validatePlan(plan);
  plan.building.floors['1'].openings[0].wallId='missing-wall';assert.throws(()=>validatePlan(plan));
});
await check('door/window and individual room-light state persist independently per floor',()=>{
  let plan=setBuildingFloorCount(clonePlan(),2);plan.openings[0].isOpen=false;plan.rooms[0].lightOn=false;
  plan=switchBuildingFloor(plan,2);plan.openings[0].isOpen=true;plan.rooms[0].lightOn=true;
  const window=plan.openings.find(opening=>opening.kind==='window');window.isOpen=true;
  plan=validatePlan(JSON.parse(JSON.stringify(plan)));assert.equal(plan.openings[0].isOpen,true);assert.equal(plan.rooms[0].lightOn,true);assert.equal(plan.openings.find(opening=>opening.id===window.id).isOpen,true);
  plan=switchBuildingFloor(plan,1);assert.equal(plan.openings[0].isOpen,false);assert.equal(plan.rooms[0].lightOn,false);
  plan.openings[0].isOpen='yes';assert.throws(()=>validatePlan(plan));plan.openings[0].isOpen=false;plan.rooms[0].lightOn=1;assert.throws(()=>validatePlan(plan));
});
await check('nested projects, invalid floor keys, overheight geometry and invalid dates are rejected on import',()=>{
  const base=switchBuildingFloor(setBuildingFloorCount(clonePlan(),10),10);
  const badNested=structuredClone(base);badNested.building.floors['1'].building={floors:{}};assert.throws(()=>validatePlan(badNested));
  const badKey=structuredClone(base);badKey.building.floors['51']=badKey.building.floors['1'];assert.throws(()=>validatePlan(badKey));
  const badActive=structuredClone(base);badActive.building.activeFloor=11;assert.throws(()=>validatePlan(badActive));
  const badHeight=structuredClone(base);badHeight.building.floorHeight=2;assert.throws(()=>validatePlan(badHeight));
  const badDate=structuredClone(base);badDate.environment={...DEFAULT_ENVIRONMENT,date:'2026-02-31',hour:12,north:0};assert.throws(()=>validatePlan(badDate));
});
await check('compressed share links preserve the building, active floor and sunlight settings',async()=>{
  const previous=globalThis.window;
  try{
    globalThis.window={location:{origin:'http://127.0.0.1:5173',pathname:'/',hash:''}};
    let plan=setBuildingFloorCount(clonePlan(),50);plan.environment={...DEFAULT_ENVIRONMENT,date:'2026-06-21',hour:18,north:-35};
    plan=switchBuildingFloor(plan,10);plan.furniture[0].name='分享的第十层';
    const link=await createProjectShareUrl(plan);window.location.hash=new URL(link).hash;
    const shared=await readSharedProject();assert.deepEqual(shared,validatePlan(JSON.parse(JSON.stringify(plan))));
  }finally{globalThis.window=previous;}
});

await writeFile(path.join(out,'report.json'),JSON.stringify({passed:checks.length,checks},null,2));
console.log(`${checks.length} environment / independent-floor / persistence checks passed.`);
