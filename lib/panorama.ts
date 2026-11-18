import type { Plan } from './plan';
import { normalizePlan, roomPolygon } from './layout';

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    const items = value.every(item => item && typeof item === 'object' && 'id' in item)
      ? [...value].sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0) : value;
    return '[' + items.map(stableValue).join(',') + ']';
  }
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + stableValue(object[key])).join(',') + '}';
}

/** A change detector for cached visualizations, never an authorization credential. */
function fingerprint(value: unknown): string {
  const input = stableValue(value);
  let first = 2166136261, second = 0x9e3779b9;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
}

/** A conservative local cache namespace. Imported Plan currently has no true project UUID.
 * Geometry/material edits preserve this key; renaming or changing room IDs can change it.
 * Projects imported with the same name and room IDs must still use scene-key staleness checks. */
export function getPanoramaProjectKey(plan: Plan): string {
  return 'pano-project-v1-' + fingerprint({ name: plan.name, roomIds: plan.rooms.map(room => room.id).sort() });
}

/** Hash the complete visible semantic scene, not OBJ/GLB or generated image data.
 * Room/wall array ordering and verification/warning changes do not invalidate a panorama. */
export function getPanoramaSceneKey(plan: Plan, roomId: string, styleId: string, prompt = ''): string {
  const scene = normalizePlan(plan);
  return 'pano-scene-v1-' + fingerprint({
    projection: 'equirectangular-360x180', roomId, styleId, prompt: prompt.slice(0, 2400),
    units: 'm', width: scene.width, depth: scene.depth, ceilingHeight: scene.ceilingHeight,
    rooms: scene.rooms.map(room => ({ id: room.id, name: room.name, polygon: roomPolygon(room), floorMaterialId: room.floorMaterialId, wallMaterialId: room.wallMaterialId })),
    walls: scene.walls, openings: scene.openings, furniture: scene.furniture, materials: scene.materials,
  });
}

/** A full spherical equirectangular image must cover 360 by 180 degrees (2:1).
 * Small encoder rounding is tolerated; ordinary 3:2 perspective renders are rejected. */
export function isPanoramaImageAspect(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Math.abs(width / height - 2) <= .04;
}
