import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.sites-runtime/polygon-check');
await mkdir(output, { recursive: true });
await build({ entryPoints: [path.join(root, 'lib/room-rendering.ts'), path.join(root, 'lib/layout.ts'), path.join(root, 'lib/walkthrough.ts'), path.join(root, 'lib/plan-bounds.ts')], outdir: output, bundle: true, packages: 'external', platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, logLevel: 'silent' });
const load = file => import(pathToFileURL(path.join(output, file + '.mjs')).href);
const { createRoomFloorGeometry, createRoomSlabGeometry, resolvePlanMaterial, wallRenderSegments } = await load('room-rendering');
const { roomArea, roomLabelPoint, pointInPolygon } = await load('layout');
const { isWalkthroughPositionFree: free, findWalkthroughSpawn: spawn, moveWalkthrough: move, getWalkableDoorPortals } = await load('walkthrough');
const { planBounds } = await load('plan-bounds');
const cases = [];
const check = (name, test) => { test(); cases.push(name); };
const polygon = [{ x: 1, y: 1 }, { x: 7, y: 1 }, { x: 7, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 7 }, { x: 1, y: 7 }];
const room = { id: 'l-room', name: 'L形客厅', x: 1, y: 1, width: 6, depth: 6, polygon };
const base = () => ({ version: 1, schemaVersion: 2, units: 'm', ceilingHeight: 3, name: 'L形测试', width: 8, depth: 8, verified: false, rooms: [structuredClone(room)], walls: [], openings: [], furniture: [], nodes: [], routes: [] });

check('L-shaped area and label use the polygon, not the rectangle bounds', () => {
  assert.equal(roomArea(room), 20); assert.notEqual(roomArea(room), room.width * room.depth);
  assert.ok(pointInPolygon(roomLabelPoint(room), polygon));
});
check('triangulated floor and slab leave the concave notch empty', () => {
  for (const geometry of [createRoomFloorGeometry(room), createRoomSlabGeometry(room)]) {
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })); mesh.updateMatrixWorld();
    const hit = point => new Raycaster(new Vector3(point.x, 10, point.y), new Vector3(0, -1, 0)).intersectObject(mesh).length > 0;
    assert.equal(hit({ x: 2, y: 5 }), true); assert.equal(hit({ x: 5, y: 2 }), true); assert.equal(hit({ x: 5, y: 5 }), false);
    geometry.dispose(); mesh.material.dispose();
  }
});
check('no standing footprint or swept motion can enter an L-shaped notch', () => {
  const plan = base(); assert.equal(free(plan, { x: 5, y: 5 }), false);
  assert.equal(free(plan, { x: 2.9, y: 4 }), false);
  assert.equal(free(plan, { x: 2, y: 4 }), true);
  const end = move(plan, { x: 2, y: 5 }, { x: 4, y: 0 }); assert.ok(end.x < 2.79);
});
check('spawn remains in a concave polygon even when its bbox centre lies outside', () => {
  const plan = base(), next = spawn(plan, room.id);
  assert.ok(next); assert.equal(next.roomId, room.id); assert.ok(pointInPolygon(next.position, polygon)); assert.ok(free(plan, next.position));
});
check('door portals join interior polygons across wall-thickness gaps', () => {
  const plan = base(); plan.width = plan.depth = 6;
  plan.rooms = [{ id: 'left', name: '左室', x: .2, y: .2, width: 2.7, depth: 5.6 }, { id: 'right', name: '右室', x: 3.1, y: .2, width: 2.7, depth: 5.6 }];
  plan.walls = [{ id: 'divider', start: { x: 3, y: .2 }, end: { x: 3, y: 5.8 }, thickness: .2, height: 3 }];
  plan.openings = [{ id: 'door', wallId: 'divider', kind: 'door', position: .5, width: 1.2, height: 2.2, sill: 0 }];
  assert.equal(free(plan, { x: 3, y: 3 }), true);
  assert.ok(move(plan, { x: 2, y: 3 }, { x: 2, y: 0 }).x > 3.9);
  assert.equal(free(plan, { x: 3, y: 2 }), false);
  plan.openings[0].kind = 'window'; assert.equal(free(plan, { x: 3, y: 3 }), false);
});
check('adjacent room union does not create an invisible collision at shared edges', () => {
  const plan = base(); plan.rooms = [{ id: 'left', name: '左', x: 1, y: 1, width: 3, depth: 6 }, { id: 'right', name: '右', x: 4, y: 1, width: 3, depth: 6 }];
  assert.equal(free(plan, { x: 4, y: 4 }), true); assert.ok(move(plan, { x: 3, y: 4 }, { x: 2, y: 0 }).x > 4.9);
});
check('custom imported materials take precedence over the default catalogue', () => {
  const plan = base(); plan.materials = [{ id: 'oak-natural', name: '自定义红木', category: 'floor', color: '#c42216', roughness: .3, pattern: 'wood' }, { id: 'custom', name: '蓝地砖', category: 'floor', color: '#284fbe', roughness: .4, pattern: 'tile' }];
  assert.equal(resolvePlanMaterial(plan, 'oak-natural').color, '#c42216'); assert.equal(resolvePlanMaterial(plan, 'custom').roughness, .4); assert.equal(resolvePlanMaterial(plan, undefined, 'plaster-sage').color, '#aab39d');
});
check('editable polygons outside legacy extents remain visible, spawnable and walkable', () => {
  const plan = base(); plan.width = plan.depth = 6;
  plan.rooms = [{ id: 'expanded', name: '扩展房间', x: -4, y: -3, width: 14, depth: 12, polygon: [{ x: -4, y: -3 }, { x: 10, y: -3 }, { x: 10, y: 9 }, { x: -4, y: 9 }] }];
  assert.deepEqual(planBounds(plan), { x: -4, y: -3, width: 14, depth: 12 });
  assert.equal(free(plan, { x: -2, y: -1 }), true); assert.equal(free(plan, { x: 9, y: 8 }), true);
  assert.ok(move(plan, { x: 5, y: 5 }, { x: 3, y: 2 }).x > 7.9);
  assert.ok(spawn(plan, 'expanded'));
  plan.rooms = [{ id: 'negative', name: '负坐标房间', x: -4, y: -3, width: 3, depth: 2 }];
  const negative = spawn(plan, 'negative'); assert.ok(negative && negative.position.x < 0 && negative.position.y < 0);
});
check('raised door renders its visible sill and never creates a walkable floor portal', () => {
  const plan = base(); plan.rooms = [{ id: 'all', name: '全屋', x: 0, y: 0, width: 8, depth: 8 }];
  const wall = { id: 'raised-wall', start: { x: 0, y: 4 }, end: { x: 8, y: 4 }, thickness: .2, height: 3 };
  const door = { id: 'raised-door', wallId: wall.id, kind: 'door', position: .5, width: 1, height: 2.2, sill: .3 };
  plan.walls = [wall]; plan.openings = [door];
  const { parts } = wallRenderSegments(wall, [door], false);
  assert.ok(parts.some(part => part.start === 3.5 && part.end === 4.5 && part.bottom === 0 && part.top === .3));
  assert.ok(parts.some(part => part.bottom === 2.5 && part.top === 3));
  assert.equal(free(plan, { x: 4, y: 4 }), false); assert.equal(getWalkableDoorPortals(plan).length, 0);
  door.sill = 0; assert.equal(getWalkableDoorPortals(plan).length, 1); assert.equal(free(plan, { x: 4, y: 4 }), true);
});
check('cutaway retains complete real windows while walls and doors remain cut', () => {
  const wall = { id: 'window-wall', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, thickness: .2, height: 2.8 };
  const window = { id: 'window', wallId: wall.id, kind: 'window', position: .5, width: 2, height: 1.5, sill: .8 };
  const original = JSON.stringify(window);
  const cut = wallRenderSegments(wall, [window], true), full = wallRenderSegments(wall, [window], false);
  assert.equal(cut.height, 1.05); assert.equal(cut.holes[0].renderHeight, 1.5);
  assert.equal(cut.holes[0].renderBottom, full.holes[0].renderBottom);
  assert.equal(cut.holes[0].renderHeight, full.holes[0].renderHeight);
  assert.equal(JSON.stringify(window), original); assert.equal(cut.holes.length, 1);
  const door = wallRenderSegments(wall, [{ ...window, kind: 'door', sill: 0, height: 2.1 }], true);
  assert.equal(door.holes[0].renderHeight, 1.05);
});
check('high-sill windows have a full support panel; invalid vertical extents cannot create floating glass', () => {
  const wall = { id: 'high-wall', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, thickness: .2, height: 2.8 };
  const window = { id: 'high-window', wallId: wall.id, kind: 'window', position: .5, width: 2, height: .7, sill: 1.6 };
  const cut = wallRenderSegments(wall, [window], true);
  assert.equal(cut.holes[0].renderHeight, .7);
  assert.ok(cut.parts.some(part => part.start === 2 && part.end === 4 && part.bottom === 0 && part.top === 1.6));
  const tall = wallRenderSegments(wall, [{...window, height: 4}], true);
  assert.ok(Math.abs(tall.holes[0].renderHeight - 1.2) < 1e-9);
  const invalid = wallRenderSegments(wall, [{...window, sill: 3}], true);
  assert.equal(invalid.holes[0].renderHeight, 0);
  for (const result of [cut, tall, invalid]) for (const part of result.parts) {
    assert.ok(part.end > part.start && part.top > part.bottom);
    assert.ok(part.top <= wall.height);
  }
  const plan = base(); plan.rooms = [{id: 'one-room', name: '单间', x: 0, y: -2, width: 6, depth: 4}];
  plan.walls = [wall]; plan.openings = [window];
  assert.equal(free(plan, {x: 3, y: 0}), false); assert.equal(getWalkableDoorPortals(plan).length, 0);
});
check('roomless CAD walls outside legacy dimensions expand the floor and walking extent', () => {
  const plan = base(); plan.rooms = []; plan.width = plan.depth = 6;
  plan.walls = [{ id: 'expanded-wall', start: { x: -4, y: -3 }, end: { x: 10, y: -3 }, thickness: .2, height: 3 }, { id: 'extent-wall', start: { x: 10, y: -3 }, end: { x: 10, y: 9 }, thickness: .2, height: 3 }];
  const bounds = planBounds(plan); assert.ok(bounds.x < -4 && bounds.width > 14);
  assert.equal(free(plan, { x: -2, y: -1 }), true); assert.equal(free(plan, { x: 9, y: 8 }), true);
  assert.ok(move(plan, { x: 5, y: 5 }, { x: 3, y: 2 }).x > 7.9); assert.ok(spawn(plan));
  const geometry = createRoomFloorGeometry({ id: 'unassigned-floor', name: '未分区', ...bounds });
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })); mesh.updateMatrixWorld();
  assert.ok(new Raycaster(new Vector3(-2, 10, -1), new Vector3(0, -1, 0)).intersectObject(mesh).length > 0);
  geometry.dispose(); mesh.material.dispose();
});
await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: cases.length, cases }, null, 2));
console.log(`Passed ${cases.length} polygon geometry, material, and walkthrough checks.`);
