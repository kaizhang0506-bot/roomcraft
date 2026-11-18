import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.sites-runtime','room-lighting-check');
await mkdir(output,{recursive:true});
await build({entryPoints:[path.join(root,'components/RoomLightSwitches.tsx'),path.join(root,'components/InteriorFixtures.tsx'),path.join(root,'lib/plan.ts'),path.join(root,'lib/layout.ts')],outdir:output,bundle:true,platform:'node',format:'esm',packages:'external',outExtension:{'.js':'.mjs'},logLevel:'silent'});
const {collectRoomSwitches}=await import(pathToFileURL(path.join(output,'components','RoomLightSwitches.mjs')).href);
const {collectInteriorFixtures,fixtureLightLevel}=await import(pathToFileURL(path.join(output,'components','InteriorFixtures.mjs')).href);
const {SAMPLE_PLAN}=await import(pathToFileURL(path.join(output,'lib','plan.mjs')).href);
const {pointInPolygon,roomPolygon}=await import(pathToFileURL(path.join(output,'lib','layout.mjs')).href);
const results=[];function check(name,run){run();results.push(name);}
check('room overrides take precedence while keeping the global dimmer',()=>{
  assert.equal(fixtureLightLevel({},.8,.6),.8);assert.equal(fixtureLightLevel({lightOn:true},0,.6),.6);assert.equal(fixtureLightLevel({lightOn:false},.8,.6),0);assert.equal(fixtureLightLevel({lightOn:true},.8,0),0);
});
check('sample rooms get one switch on a solid wall, facing into the room',()=>{
 const switches=collectRoomSwitches(SAMPLE_PLAN);assert.equal(switches.length,SAMPLE_PLAN.rooms.length);assert.equal(new Set(switches.map(item=>item.roomId)).size,switches.length);
 for(const item of switches){
  const room=SAMPLE_PLAN.rooms.find(room=>room.id===item.roomId),wall=SAMPLE_PLAN.walls.find(wall=>wall.id===item.wallId),nx=Math.sin(item.rotation),nz=Math.cos(item.rotation);
  assert.ok(pointInPolygon({x:item.x,y:item.z},roomPolygon(room)));assert.ok(pointInPolygon({x:item.x+nx*.08,y:item.z+nz*.08},roomPolygon(room)));
  const dx=wall.end.x-wall.start.x,dz=wall.end.y-wall.start.y,length=Math.hypot(dx,dz),along=((item.x-wall.start.x)*dx+(item.z-wall.start.y)*dz)/length;
  for(const opening of SAMPLE_PLAN.openings.filter(opening=>opening.wallId===wall.id))assert.ok(Math.abs(along-opening.position*length)>=opening.width/2+.099);
 }
});
check('per-room overrides follow authored and preview fixtures without modifying input',()=>{
 const plan=structuredClone(SAMPLE_PLAN);plan.rooms[0].lightOn=false;plan.rooms[1].lightOn=true;const before=JSON.stringify(plan),fixtures=collectInteriorFixtures(plan,8);
 assert.equal(fixtures.find(item=>item.roomId===plan.rooms[0].id).lightOn,false);assert.equal(fixtures.find(item=>item.roomId===plan.rooms[1].id).lightOn,true);assert.equal(JSON.stringify(plan),before);
});
console.log(JSON.stringify({passed:results.length,checks:results},null,2));
