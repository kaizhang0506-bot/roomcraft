import type { Plan, Point } from './plan';
import { polygonBounds, roomPolygon } from './layout';

/** Project dimensions remain a legacy extent, not a crop on editable geometry. */
export function planBounds(plan: Plan) {
  const points: Point[] = [{ x: 0, y: 0 }, { x: plan.width, y: plan.depth }];
  for (const room of plan.rooms) points.push(...roomPolygon(room));
  for (const wall of plan.walls) {
    const half = wall.thickness / 2;
    for (const point of [wall.start, wall.end]) points.push({ x: point.x - half, y: point.y - half }, { x: point.x + half, y: point.y + half });
  }
  return polygonBounds(points);
}
