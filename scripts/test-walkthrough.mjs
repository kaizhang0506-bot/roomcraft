import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.sites-runtime', 'walkthrough-check');
await mkdir(output, { recursive: true });
await build({ entryPoints: [path.join(root, 'lib/walkthrough.ts'), path.join(root, 'lib/plan.ts')], outdir: output, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, logLevel: 'silent' });
const { isWalkthroughPositionFree: free, moveWalkthrough: move, findWalkthroughSpawn: spawn, getWalkableDoorPortals, isWithinWalkableFootprint, WALK_EYE_HEIGHT } = await import(pathToFileURL(path.join(output, 'walkthrough.mjs')).href);
const { SAMPLE_PLAN } = await import(pathToFileURL(path.join(output, 'plan.mjs')).href);

const base = () => ({ version: 1, name: '碰撞测试', width: 6, depth: 6, verified: false, walls: [], rooms: [], openings: [], furniture: [], nodes: [], routes: [] });
const divider = () => ({ id: 'wall', start: { x: 3, y: 0 }, end: { x: 3, y: 6 }, height: 2.8, thickness: .18 });
const portal = (kind = 'door', width = 1) => ({ id: 'opening', wallId: 'wall', kind, position: .5, width, height: 2.2, sill: 0 });
const table = (rotation = 0) => ({ id: 'table', kind: 'table', name: '碰撞家具', x: 3, y: 3, width: 2, depth: 1, height: .7, rotation });
const results = [];
function check(name, run) { run(); results.push(name); }

check('walking uses a real standing eye height of 1.65m', () => assert.equal(WALK_EYE_HEIGHT, 1.65));
check('sample project finds a safe indoor spawn instead of the occupied room center', () => {
  const start = spawn(SAMPLE_PLAN);
  assert.ok(start); assert.ok(free(SAMPLE_PLAN, start.position));
  const room = SAMPLE_PLAN.rooms.find(r => r.id === start.roomId);
  assert.ok(room);
  assert.ok(start.position.x >= room.x && start.position.x <= room.x + room.width);
  assert.ok(start.position.y >= room.y && start.position.y <= room.y + room.depth);
});
check('preferred room is used when it contains standing space', () => {
  const plan = base(); plan.rooms = [{ id: 'a', name: '甲', x: 0, y: 0, width: 3, depth: 6 }, { id: 'b', name: '乙', x: 3, y: 0, width: 3, depth: 6 }];
  const start = spawn(plan, 'b'); assert.equal(start.roomId, 'b'); assert.ok(start.position.x > 3);
});
check('sample entry faces usable space and allows a real first forward step', () => {
  const start = spawn(SAMPLE_PLAN);
  const end = move(SAMPLE_PLAN, start.position, { x: -Math.sin(start.yaw), y: -Math.cos(start.yaw) });
  assert.ok(Math.hypot(end.x - start.position.x, end.y - start.position.y) > .9);
});
check('furniture covering the entire floor returns no spawn', () => {
  const plan = base(); plan.furniture = [{ ...table(), width: 6, depth: 6 }];
  assert.equal(spawn(plan), null);
});
check('roomless imported CAD still finds safe standing space', () => {
  const plan = base(); plan.walls = [divider()];
  const start = spawn(plan); assert.ok(start); assert.ok(free(plan, start.position));
});
check('building boundaries prevent leaving the floor or invalid coordinates', () => {
  const plan = base(); assert.equal(free(plan, { x: .1, y: 3 }), false);
  assert.equal(free(plan, { x: 6, y: 3 }), false); assert.equal(free(plan, { x: NaN, y: 3 }), false);
  const end = move(plan, { x: 1, y: 1 }, { x: -10, y: -10 });
  assert.ok(end.x >= .22 && end.y >= .22);
});
check('a solid wall blocks both normal motion and a large frame step', () => {
  const plan = base(); plan.walls = [divider()];
  assert.equal(free(plan, { x: 3, y: 3 }), false);
  const end = move(plan, { x: 1, y: 3 }, { x: 4, y: 0 });
  assert.ok(end.x < 2.7); assert.ok(free(plan, end));
});
check('a full-height door opening permits crossing the same wall', () => {
  const plan = base(); plan.walls = [divider()]; plan.openings = [portal()];
  assert.equal(free(plan, { x: 3, y: 3 }), true);
  const end = move(plan, { x: 1, y: 3 }, { x: 4, y: 0 }); assert.ok(end.x > 4.9);
});
check('closing a door blocks crossing immediately; opening it restores passage', () => {
  const plan=base();plan.walls=[divider()];plan.openings=[{...portal(),isOpen:false}];
  assert.equal(free(plan,{x:3,y:3}),false);assert.ok(move(plan,{x:1,y:3},{x:4,y:0}).x<2.7);
  plan.openings[0].isOpen=true;assert.equal(free(plan,{x:3,y:3}),true);assert.ok(move(plan,{x:1,y:3},{x:4,y:0}).x>4.9);
  delete plan.openings[0].isOpen;assert.ok(move(plan,{x:1,y:3},{x:4,y:0}).x>4.9);
});
check('closed doors do not bridge room polygon gaps across their wall thickness', () => {
  const plan=base();plan.walls=[divider()];plan.rooms=[{id:'left',name:'左',x:0,y:0,width:2.9,depth:6},{id:'right',name:'右',x:3.1,y:0,width:2.9,depth:6}];plan.openings=[{...portal(),isOpen:true}];
  assert.equal(getWalkableDoorPortals(plan).length,1);assert.equal(isWithinWalkableFootprint(plan,{x:3,y:3}),true);assert.ok(move(plan,{x:1,y:3},{x:4,y:0}).x>4.9);
  plan.openings[0].isOpen=false;assert.equal(getWalkableDoorPortals(plan).length,0);assert.equal(isWithinWalkableFootprint(plan,{x:3,y:3}),false);assert.ok(move(plan,{x:1,y:3},{x:4,y:0}).x<2.7);
});
check('a window never permits walking through even when its sill is zero', () => {
  const plan = base(); plan.walls = [divider()]; plan.openings = [portal('window')];
  assert.equal(free(plan, { x: 3, y: 3 }), false);
  const end = move(plan, { x: 1, y: 3 }, { x: 4, y: 0 }); assert.ok(end.x < 2.7);
  plan.openings[0].isOpen=true;assert.equal(free(plan,{x:3,y:3}),false);assert.ok(move(plan,{x:1,y:3},{x:4,y:0}).x<2.7);
});
check('low doors, raised thresholds and narrow gaps cannot fit a standing person', () => {
  for (const opening of [{ ...portal(), height: 1.4 }, { ...portal(), sill: .3 }, portal('door', .35)]) {
    const plan = base(); plan.walls = [divider()]; plan.openings = [opening];
    assert.equal(free(plan, { x: 3, y: 3 }), false);
  }
});
check('door jamb collision keeps a person clear of the opening edges', () => {
  const plan = base(); plan.walls = [divider()]; plan.openings = [portal()];
  assert.equal(free(plan, { x: 3, y: 2.56 }), false);
  assert.equal(free(plan, { x: 3, y: 3 }), true);
});
check('rotated furniture uses its rotated footprint rather than unrotated bounds', () => {
  const plan = base(); plan.furniture = [table(90)];
  assert.equal(free(plan, { x: 3, y: 3.8 }), false);
  assert.equal(free(plan, { x: 3.8, y: 3 }), true);
});
check('furniture stops movement even if it is below eye height', () => {
  const plan = base(); plan.furniture = [table()];
  const end = move(plan, { x: 1, y: 3 }, { x: 4, y: 0 }); assert.ok(end.x < 1.8);
});
check('diagonal movement slides along a wall instead of tunnelling or freezing tangential motion', () => {
  const plan = base(); plan.walls = [divider()];
  const end = move(plan, { x: 2.6, y: 1 }, { x: 1, y: 2 });
  assert.ok(end.x < 2.7); assert.ok(end.y > 2.9); assert.ok(free(plan, end));
});
check('removing a wall changes actual collision without stale geometry', () => {
  const plan = base(); plan.walls = [divider()]; assert.ok(move(plan, { x: 1, y: 3 }, { x: 4, y: 0 }).x < 3);
  plan.walls = []; assert.ok(move(plan, { x: 1, y: 3 }, { x: 4, y: 0 }).x > 4.9);
});
check('overlapping door openings are merged for collision traversal', () => {
  const plan = base(); plan.walls = [divider()]; plan.openings = [portal(), { ...portal(), id: 'door2', position: .54 }];
  assert.equal(free(plan, { x: 3, y: 3.25 }), true);
});

const report = { status: 'passed', checks: results.length, cases: results, boundaries: ['Collision is a 2D standing-person footprint; no stairs, jumping, gravity simulation or structural assessment.', 'Closed doors block passage; legacy doors with no isOpen value remain open. Furniture uses conservative rectangular footprints.', 'Keyboard/camera integration is tested separately in the running browser.'] };
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
