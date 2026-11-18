import type { Plan, Point } from './plan';
import { pointInPolygon, polygonBounds, roomLabelPoint, roomPolygon } from './layout';
import { planBounds } from './plan-bounds';

export const WALK_EYE_HEIGHT = 1.65;
export const WALK_BODY_HEIGHT = 1.8;
export const WALK_RADIUS = .22;
export interface WalkSpawn { position: Point; yaw: number; pitch?: number; roomId?: string }

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Interior polygons can stop at each face of a wall. A real doorway bridges only
 * its wall thickness, never arbitrary exterior space or a concave room cutout. */
export function getWalkableDoorPortals(plan: Plan): { id: string; polygon: Point[] }[] {
  return plan.openings.flatMap(opening => {
    if (opening.kind !== 'door' || opening.isOpen === false || opening.sill > .04 || opening.height < WALK_BODY_HEIGHT) return [];
    const wall = plan.walls.find(item => item.id === opening.wallId);
    if (!wall) return [];
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y, length = Math.hypot(dx, dy);
    if (length < .001) return [];
    const start = Math.max(0, opening.position * length - opening.width / 2), end = Math.min(length, opening.position * length + opening.width / 2);
    const center = (start + end) / 2;
    const cx = wall.start.x + dx / length * center, cy = wall.start.y + dy / length * center;
    // Only connect two interior regions. An exterior door does not make the yard walkable.
    const offset = wall.thickness / 2 + .045;
    if (![-1, 1].every(side => plan.rooms.some(room => pointInPolygon({ x: cx - dy / length * offset * side, y: cy + dx / length * offset * side }, roomPolygon(room))))) return [];
    const halfWidth = (end - start) / 2;
    const halfDepth = wall.thickness / 2 + .055;
    return [{ id: opening.id, polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([along, across]) => ({ x: cx + dx / length * halfWidth * along - dy / length * halfDepth * across, y: cy + dy / length * halfWidth * along + dx / length * halfDepth * across })) }];
  });
}

export function isWithinWalkableFootprint(plan: Plan, point: Point): boolean {
  if (!plan.rooms.length) return true;
  if (plan.rooms.some(room => pointInPolygon(point, roomPolygon(room)))) return true;
  return getWalkableDoorPortals(plan).some(portal => pointInPolygon(point, portal.polygon));
}

/** A standing person's circular footprint against walls and rotated furniture.
 * Only open, sufficiently tall floor-level doors remove wall collision, never windows.
 * A missing isOpen retains legacy projects' open-door behavior.
 * Collision uses all geometry even when the drawing's layer is hidden.
 */
export function isWalkthroughPositionFree(plan: Plan, point: Point, radius = WALK_RADIUS): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(radius) || radius <= 0) return false;
  const bounds = planBounds(plan);
  if (point.x < bounds.x + radius || point.y < bounds.y + radius || point.x > bounds.x + bounds.width - radius || point.y > bounds.y + bounds.depth - radius) return false;
  // Sample the standing footprint rather than just its centre at concave corners.
  if (!isWithinWalkableFootprint(plan, point)) return false;
  if (plan.rooms.length) for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    if (!isWithinWalkableFootprint(plan, { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius })) return false;
  }
  for (const wall of plan.walls) {
    if (wall.height < .1) continue;
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy);
    if (length < .001) continue;
    // Cheap broad-phase avoids scanning openings for distant walls.
    if (distanceToSegment(point, wall.start, wall.end) >= radius + wall.thickness / 2) continue;
    const doors = plan.openings
      .filter(o => o.wallId === wall.id && o.kind === 'door' && o.isOpen !== false && o.sill <= .04 && o.height >= WALK_BODY_HEIGHT)
      .map(o => ({ start: Math.max(0, o.position * length - o.width / 2), end: Math.min(length, o.position * length + o.width / 2) }))
      .filter(o => o.end > o.start).sort((a, b) => a.start - b.start);
    let previous = 0;
    const at = (t: number): Point => ({ x: wall.start.x + dx * t / length, y: wall.start.y + dy * t / length });
    for (const door of [...doors, { start: length, end: length }]) {
      if (door.start > previous && distanceToSegment(point, at(previous), at(door.start)) < radius + wall.thickness / 2 - .000001) return false;
      previous = Math.max(previous, door.end);
    }
  }
  for (const item of plan.furniture) {
    if (item.height < .06) continue;
    const theta = item.rotation * Math.PI / 180;
    const dx = point.x - item.x, dy = point.y - item.y;
    const x = Math.cos(theta) * dx + Math.sin(theta) * dy;
    const y = -Math.sin(theta) * dx + Math.cos(theta) * dy;
    const nearestX = Math.max(-item.width / 2, Math.min(item.width / 2, x));
    const nearestY = Math.max(-item.depth / 2, Math.min(item.depth / 2, y));
    if (Math.hypot(x - nearestX, y - nearestY) < radius - .000001) return false;
  }
  return true;
}

/** Swept small steps prevent fast movement tunnelling through thin walls.
 * Try tangential movement when a diagonal step hits an obstacle.
 */
export function moveWalkthrough(plan: Plan, from: Point, delta: Point, radius = WALK_RADIUS): Point {
  if (![from.x, from.y, delta.x, delta.y].every(Number.isFinite)) return { ...from };
  const distance = Math.hypot(delta.x, delta.y);
  const count = Math.max(1, Math.ceil(distance / .07));
  // Public callers must not turn an accidental enormous input into an unbounded loop.
  if (count > 2000) return { ...from };
  const step = { x: delta.x / count, y: delta.y / count };
  let point = { ...from };
  for (let i = 0; i < count; i++) {
    const proposed = { x: point.x + step.x, y: point.y + step.y };
    if (isWalkthroughPositionFree(plan, proposed, radius)) { point = proposed; continue; }
    const horizontal = { x: point.x + step.x, y: point.y };
    if (isWalkthroughPositionFree(plan, horizontal, radius)) point = horizontal;
    const vertical = { x: point.x, y: point.y + step.y };
    if (isWalkthroughPositionFree(plan, vertical, radius)) point = vertical;
  }
  return point;
}

function clearFacing(plan: Plan, position: Point, preferredYaw: number): number {
  let bestYaw = preferredYaw, bestDistance = -1;
  // A safe spawn should look into usable space rather than straight at a close sofa.
  for (let i = 0; i < 8; i++) {
    const yaw = preferredYaw + i * Math.PI / 4;
    let distance = 0;
    for (let step = .15; step <= 2.4; step += .15) {
      if (!isWalkthroughPositionFree(plan, { x: position.x - Math.sin(yaw) * step, y: position.y - Math.cos(yaw) * step })) break;
      distance = step;
    }
    if (i === 0 && distance >= 1.35) return yaw;
    if (distance > bestDistance) { bestDistance = distance; bestYaw = yaw; }
  }
  return bestYaw;
}

/** Prefer the selected room, then other room centres and nearby safe positions.
 * Return null rather than spawning inside a wall, a bed or an overfilled room.
 */
export function findWalkthroughSpawn(plan: Plan, preferredRoomId?: string | null): WalkSpawn | null {
  const ordered = [...plan.rooms].sort((a, b) => Number(b.id === preferredRoomId) - Number(a.id === preferredRoomId));
  const bounds = planBounds(plan);
  const regions = ordered.length ? ordered.map(room => ({ ...room, ...polygonBounds(roomPolygon(room)) })) : [{ id: undefined, ...bounds, polygon: undefined }];
  for (const region of regions) {
    const center = region.id ? roomLabelPoint(region as Plan['rooms'][number]) : { x: region.x + region.width / 2, y: region.y + region.depth / 2 };
    const candidates = [{ ...center }];
    // Outward search keeps the first-person entry near the intended room.
    for (let ring = 1; ring <= 6; ring++) {
      for (let yi = -ring; yi <= ring; yi++) for (let xi = -ring; xi <= ring; xi++) {
        if (Math.max(Math.abs(xi), Math.abs(yi)) !== ring) continue;
        const p = { x: center.x + xi * .35, y: center.y + yi * .35 };
        if (p.x >= region.x + WALK_RADIUS && p.x <= region.x + region.width - WALK_RADIUS && p.y >= region.y + WALK_RADIUS && p.y <= region.y + region.depth - WALK_RADIUS) candidates.push(p);
      }
    }
    for (const position of candidates) {
      if (region.id && !pointInPolygon(position, roomPolygon(region as Plan['rooms'][number]))) continue;
      if (!isWalkthroughPositionFree(plan, position, WALK_RADIUS + .035)) continue;
      const target = Math.hypot(center.x - position.x, center.y - position.y) > .1 ? center : { x: center.x, y: region.y + Math.min(.5, region.depth * .2) };
      return { position, yaw: clearFacing(plan, position, Math.atan2(-(target.x - position.x), -(target.y - position.y))), roomId: region.id };
    }
  }
  // CAD files can have no room records, or a free corridor outside named rooms.
  const step = Math.max(.35, Math.max(bounds.width, bounds.depth) / 60);
  for (let y = bounds.y + WALK_RADIUS + .1; y <= bounds.y + bounds.depth - WALK_RADIUS; y += step) {
    for (let x = bounds.x + WALK_RADIUS + .1; x <= bounds.x + bounds.width - WALK_RADIUS; x += step) {
      const position = { x, y };
      if (isWalkthroughPositionFree(plan, position, WALK_RADIUS + .035)) return { position, yaw: clearFacing(plan, position, 0) };
    }
  }
  return null;
}
export function findFreeWalkSpawn(plan:Plan,preferredRoomId?:string|null):WalkSpawn {
  const room=plan.rooms.find(r=>r.id===preferredRoomId)??plan.rooms[0];
  if(room){
    const position=roomLabelPoint(room);
    if(!isWalkthroughPositionFree(plan,position)){const alternative=findWalkthroughSpawn(plan,room.id);if(alternative?.roomId===room.id)return alternative;}
    return {position,yaw:0,roomId:room.id};
  }
  const b=planBounds(plan);
  return {position:{x:b.x+b.width/2,y:b.y+b.depth/2},yaw:0};
}
