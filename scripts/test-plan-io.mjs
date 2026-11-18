import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import DxfParser from 'dxf-parser';

// Exercise production modules; all generated bundles/reports remain checkout-local.
const project = path.resolve(import.meta.dirname, '..');
const output = path.join(project, '.sites-runtime', 'plan-io-check');
await mkdir(output, { recursive: true });
await build({
  entryPoints: ['lib/import.ts', 'lib/export.ts', 'lib/plan.ts', 'lib/validation.ts'].map(file => path.join(project, file)),
  outdir: output, bundle: true, platform: 'node', format: 'esm', target: 'node24',
  outExtension: { '.js': '.mjs' }, external: ['dxf-parser', 'pdfjs-dist'], logLevel: 'silent',
});
const { importFloorplan } = await import(pathToFileURL(path.join(output, 'import.mjs')).href);
const { exportDXF, downloadProject, downloadImage } = await import(pathToFileURL(path.join(output, 'export.mjs')).href);
const { SAMPLE_PLAN, clonePlan } = await import(pathToFileURL(path.join(output, 'plan.mjs')).href);
const { validatePlan } = await import(pathToFileURL(path.join(output, 'validation.mjs')).href);

const checks = [];
function check(name, run) { run(); checks.push(name); }
async function asyncCheck(name, run) { await run(); checks.push(name); }
const near = (a, b) => assert.ok(Math.abs(a - b) < .000001, `${a} != ${b}`);
const downloads = [];
let lastBlob;
const oldDocument = globalThis.document;
const oldCreate = URL.createObjectURL;
const oldRevoke = URL.revokeObjectURL;
URL.createObjectURL = blob => { lastBlob = blob; return `blob:roomcraft-test-${downloads.length}`; };
URL.revokeObjectURL = () => {};
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'a');
    return { href: '', download: '', click() { downloads.push({ href: this.href, filename: this.download }); } };
  },
};

function line(x1, y1, x2, y2, layer = 'A-WALL') {
  return [0, 'LINE', 8, layer, 10, x1, 20, y1, 30, 0, 11, x2, 21, y2, 31, 0];
}
function fixture(entities, units = 4) {
  return [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, units, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', ...entities.flat(), 0, 'ENDSEC', 0, 'EOF', ''].join('\r\n');
}
const file = (content, name) => new File([content], name, { type: 'application/octet-stream' });
const parse = text => { const result = new DxfParser().parseSync(text); assert.ok(result); return result; };

try {
  check('sample plan passes actual shared schema', () => assert.deepEqual(validatePlan(SAMPLE_PLAN), SAMPLE_PLAN));
  exportDXF(SAMPLE_PLAN);
  const cadText = await lastBlob.text();
  const cad = parse(cadText);
  const entities = cad.entities;
  const layerEntities = name => entities.filter(entity => entity.layer === name);
  check('export download is a DXF with the expected name', () => {
    assert.equal(lastBlob.type, 'application/dxf');
    assert.match(downloads.at(-1).filename, /-设计草稿\.dxf$/);
  });
  check('DXF millimeter unit and supported modern format', () => {
    assert.equal(cad.header.$INSUNITS, 4);
    assert.equal(cad.header.$ACADVER, 'AC1024');
  });
  check('all visible drawing layers exist', () => {
    for (const name of ['WALL', 'OPENING', 'FURNITURE', 'POWER', 'LIGHTING', 'COLDWATER', 'HOTWATER', 'DRAIN', 'ANNOTATION']) assert.ok(cad.tables.layer.layers[name], name);
  });
  check('one semantic centerline per wall is hidden from the drawing', () => {
    assert.equal(layerEntities('ROOMCRAFT_WALL_AXIS').length, SAMPLE_PLAN.walls.length);
    const layer = cad.tables.layer.layers.ROOMCRAFT_WALL_AXIS;
    assert.equal(layer.visible, false); assert.equal(layer.frozen, true);
    const first = layerEntities('ROOMCRAFT_WALL_AXIS')[0];
    near(first.vertices[0].x, 0); near(first.vertices[1].x, 11400);
  });
  check('wall openings have symbols and visible wall edges leave the gap clear', () => {
    assert.equal(layerEntities('OPENING').filter(e => e.type === 'LINE').length, SAMPLE_PLAN.openings.length);
    const opening = SAMPLE_PLAN.openings.find(o => o.id === 'win1');
    const gapCenter = opening.position * SAMPLE_PLAN.width * 1000;
    const outerWallEdges = layerEntities('WALL').filter(e => e.type === 'LINE' && e.vertices.every(p => Math.abs(Math.abs(p.y) - 90) < .001));
    assert.ok(outerWallEdges.length >= 2);
    for (const edge of outerWallEdges) assert.ok(!(Math.min(...edge.vertices.map(p => p.x)) < gapCenter && Math.max(...edge.vertices.map(p => p.x)) > gapCenter));
  });
  check('room names and Chinese draft warning are readable as TEXT', () => {
    const text = layerEntities('ANNOTATION').map(e => e.text ?? '').join('\n');
    for (const room of SAMPLE_PLAN.rooms) assert.ok(text.includes(room.name), room.name);
    assert.ok(text.includes('非施工交付'));
  });
  check('power, lighting, cold/hot water and drain routes use separate layers', () => {
    for (const name of ['POWER', 'LIGHTING', 'COLDWATER', 'HOTWATER', 'DRAIN']) assert.ok(layerEntities(name).some(e => e.type === 'LINE'), name);
  });
  check('each utility node uses the proper layer and retains elevation annotation', () => {
    for (const node of SAMPLE_PLAN.nodes) {
      const expected = node.kind === 'water' ? 'COLDWATER' : node.kind === 'drain' ? 'DRAIN' : node.kind === 'light' ? 'LIGHTING' : 'POWER';
      assert.ok(layerEntities(expected).some(e => e.type === 'CIRCLE' && Math.abs(e.center.x - node.x * 1000) < .001 && Math.abs(e.center.y + node.y * 1000) < .001), node.id);
      assert.ok(layerEntities(expected).some(e => e.type === 'TEXT' && e.text.includes(`${node.kind} H=${Math.round(node.height * 1000)}`)), node.id);
    }
  });
  await asyncCheck('own DXF import restores one wall per original centerline without doubled edges', async () => {
    const imported = await importFloorplan(file(cadText, '往返户型.dxf'));
    assert.equal(imported.plan.walls.length, SAMPLE_PLAN.walls.length);
    near(imported.plan.width, SAMPLE_PLAN.width); near(imported.plan.depth, SAMPLE_PLAN.depth);
    SAMPLE_PLAN.walls.forEach((wall, i) => {
      const restored = imported.plan.walls[i];
      near(restored.start.x, wall.start.x); near(restored.start.y, wall.start.y);
      near(restored.end.x, wall.end.x); near(restored.end.y, wall.end.y);
    });
    assert.ok(imported.warnings.some(w => w.includes('中心线')));
    assert.ok(imported.warnings.some(w => w.includes('门窗')));
    assert.equal(imported.plan.verified, false);
  });
  await asyncCheck('own wall height and thickness metadata survive DXF round trip', async () => {
    const custom = clonePlan(); custom.walls[0].height = 3.15; custom.walls[0].thickness = .24;
    exportDXF(custom);
    const imported = await importFloorplan(file(await lastBlob.text(), 'custom.dxf'));
    near(imported.plan.walls[0].height, 3.15); near(imported.plan.walls[0].thickness, .24);
  });
  await asyncCheck('JSON download and upload preserve all rooms, openings, furniture and utility data', async () => {
    downloadProject(SAMPLE_PLAN);
    assert.equal(lastBlob.type, 'application/json');
    const json = await lastBlob.text();
    assert.deepEqual(JSON.parse(json), SAMPLE_PLAN);
    const imported = await importFloorplan(file(json, '室内设计.ROOMCRAFT.JSON'));
    assert.deepEqual(imported.plan, SAMPLE_PLAN);
  });
  check('image download uses the supplied generated image', () => {
    downloadImage('data:image/png;base64,dGVzdA==', '真实生成.png');
    assert.deepEqual(downloads.at(-1), { href: 'data:image/png;base64,dGVzdA==', filename: '真实生成.png' });
  });
  await asyncCheck('generic millimeter CAD normalizes origin and excludes non-wall geometry', async () => {
    const source = fixture([line(1000, 2000, 6000, 2000), line(6000, 2000, 6000, 6000), line(6000, 6000, 1000, 6000), line(1000, 6000, 1000, 2000), line(-99999, -99999, 99999, 99999, 'FURNITURE')]);
    const imported = await importFloorplan(file(source, 'external.dxf'));
    assert.equal(imported.plan.walls.length, 4); near(imported.plan.width, 5); near(imported.plan.depth, 4);
    assert.ok(imported.warnings.some(w => w.includes('双边线')));
  });
  await asyncCheck('generic explicit centerline layer takes priority over parallel wall edges', async () => {
    const source = fixture([line(0, 0, 5000, 0, 'A-WALL-CNTR'), line(0, -100, 5000, -100), line(0, 100, 5000, 100)]);
    const imported = await importFloorplan(file(source, 'centerline.dxf'));
    assert.equal(imported.plan.walls.length, 1); near(imported.plan.width, 5);
  });
  await asyncCheck('exact reversed duplicate segments are removed; parallel edges remain explicitly unmerged', async () => {
    const source = fixture([line(0, 0, 5000, 0), line(5000, 0, 0, 0), line(0, 180, 5000, 180)]);
    const imported = await importFloorplan(file(source, 'outline.dxf'));
    assert.equal(imported.plan.walls.length, 2);
    assert.ok(imported.warnings.some(w => w.includes('重复线段')));
    assert.ok(imported.warnings.some(w => w.includes('不自动推断墙厚')));
  });
  await asyncCheck('closed lightweight polyline retains its closing wall', async () => {
    const source = fixture([[0, 'LWPOLYLINE', 8, 'WALL', 90, 3, 70, 1, 10, 0, 20, 0, 10, 5000, 20, 0, 10, 0, 20, 4000]]);
    const imported = await importFloorplan(file(source, 'triangle.dxf'));
    assert.equal(imported.plan.walls.length, 3); near(imported.plan.width, 5); near(imported.plan.depth, 4);
  });
  await asyncCheck('meter unit is honored and absent units produce a clear millimeter assumption', async () => {
    const meters = await importFloorplan(file(fixture([line(0, 0, 5, 0)], 6), 'meters.dxf'));
    near(meters.plan.width, 5);
    const unknown = await importFloorplan(file(fixture([line(0, 0, 5000, 0)], 0), 'unitless.dxf'));
    near(unknown.plan.width, 5); assert.ok(unknown.warnings.some(w => w.includes('暂按毫米')));
  });
  await asyncCheck('invalid DXF coordinates, DWG and oversized input fail clearly', async () => {
    await assert.rejects(importFloorplan(file(fixture([line('NaN', 0, 5000, 0)]), 'bad.dxf')), /无效坐标/);
    await assert.rejects(importFloorplan(file('', 'original.dwg')), /DWG.*DXF/);
    await assert.rejects(importFloorplan({ size: 15 * 1024 * 1024 + 1, name: 'big.png' }), /15 MB/);
  });
  check('shared schema rejects nonfinite and incomplete coordinates', () => {
    for (const value of [NaN, Infinity, -Infinity, undefined]) {
      const invalid = clonePlan(); invalid.walls[0].start.x = value;
      assert.throws(() => validatePlan(invalid));
    }
  });
  check('shared schema rejects duplicate IDs across different object collections', () => {
    const invalid = clonePlan(); invalid.furniture[0].id = invalid.walls[0].id;
    assert.throws(() => validatePlan(invalid), /构件 ID 不能重复/);
  });
  await asyncCheck('JSON import applies shared schema rather than accepting malformed coordinates', async () => {
    const invalid = clonePlan(); invalid.walls[0].start.x = null;
    await assert.rejects(importFloorplan(file(JSON.stringify(invalid), 'bad.json')));
  });
  check('CAD export rejects malformed plans before creating a file', () => {
    const invalid = clonePlan(); invalid.nodes[0].x = NaN;
    const previous = downloads.length;
    assert.throws(() => exportDXF(invalid)); assert.equal(downloads.length, previous);
  });
  const report = {
    status: 'passed', checks: checks.length, cases: checks,
    boundaries: [
      'DXF import restores straight wall geometry and recognized Roomcraft wall height/thickness metadata, not full project semantics.',
      'Door/window, room, furniture and utility annotations/layers are exported but not semantically reconstructed by generic DXF import. JSON is the full-fidelity project format.',
      'External parallel wall-edge lines are not automatically merged or assumed to be structural walls; the importer warns and requires designer correction.',
      'PDF rendering and browser download behavior require a browser and are not covered by this Node test.',
    ],
  };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  URL.createObjectURL = oldCreate;
  URL.revokeObjectURL = oldRevoke;
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
}
