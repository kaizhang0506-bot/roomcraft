import { ExtrudeGeometry, Shape, ShapeGeometry } from 'three';
import type { MaterialDefinition, Plan, Room } from './plan';
import { roomPolygon } from './layout';
import { getMaterial } from './materials';

/** Room polygons are the only source of floor topology; bounds never create fill. */
function roomShape(room: Room): Shape {
  const points = roomPolygon(room);
  const shape = new Shape();
  if (points.length) {
    shape.moveTo(points[0].x, -points[0].y);
    points.slice(1).forEach(point => shape.lineTo(point.x, -point.y));
    shape.closePath();
  }
  return shape;
}

export function createRoomFloorGeometry(room: Room): ShapeGeometry {
  return new ShapeGeometry(roomShape(room)).rotateX(-Math.PI / 2);
}

export function createRoomSlabGeometry(room: Room, thickness = .2): ExtrudeGeometry {
  return new ExtrudeGeometry(roomShape(room), { depth: thickness, bevelEnabled: false })
    .rotateX(-Math.PI / 2).translate(0, -thickness, 0);
}

/** Imported projects may define their own material ids or override bundled ones. */
export function resolvePlanMaterial(plan: Plan, id?: string, fallback = 'oak-natural'): MaterialDefinition {
  return plan.materials?.find(material => material.id === id) ?? getMaterial(id, fallback);
}

/** Cut away walls to expose the plan, but retain actual windows and their sills. */
export function wallRenderSegments(wall: Plan['walls'][number], openings: Plan['openings'], cutaway: boolean) {
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const height = cutaway ? Math.min(wall.height, 1.05) : wall.height;
  const parts: { start: number; end: number; bottom: number; top: number }[] = [];
  const holes = openings.filter(opening => opening.wallId === wall.id).map(opening => {
    const renderBottom = Math.max(0, opening.sill);
    // A 1.05 m wall cut used to reduce most windows to 25 cm slits and
    // completely hide high-sill windows. Only doors follow the wall cut.
    const openingTop = opening.kind === 'window' ? wall.height : height;
    return { ...opening, a: Math.max(0, opening.position * length - opening.width / 2), b: Math.min(length, opening.position * length + opening.width / 2), renderBottom, renderHeight: Math.max(0, Math.min(opening.height, openingTop - renderBottom)) };
  }).sort((a, b) => a.a - b.a);
  let start = 0;
  for (const opening of holes) {
    if (opening.a > start) parts.push({ start, end: opening.a, bottom: 0, top: height });
    const bottom = Math.max(0, opening.sill);
    if (bottom > 0) parts.push({ start: Math.max(start, opening.a), end: opening.b, bottom: 0, top: Math.min(opening.kind === 'window' ? wall.height : height, bottom) });
    const lintel = bottom + opening.height;
    if (lintel < height) parts.push({ start: Math.max(start, opening.a), end: opening.b, bottom: lintel, top: height });
    start = Math.max(start, opening.b);
  }
  if (start < length) parts.push({ start, end: length, bottom: 0, top: height });
  return { parts: parts.filter(part => part.end - part.start > .001 && part.top - part.bottom > .001), holes, height };
}
