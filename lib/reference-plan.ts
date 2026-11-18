import { DEFAULT_ENVIRONMENT } from './environment';
import { normalizePlan } from './layout';
import type { Furniture, Opening, Plan, Room, Wall } from './plan';

const furnitureKinds = {
  sofa: 'sofa', rug: 'table', curtain: 'cabinet', 'coffee-table': 'table',
  'round-dining': 'table', 'dining-chair': 'chair', 'media-console': 'cabinet',
  'double-bed': 'bed', 'single-bed': 'bed', nightstand: 'cabinet', wardrobe: 'cabinet',
  desk: 'table', bookcase: 'cabinet', kitchen: 'cabinet', vanity: 'cabinet',
  shower: 'cabinet', plant: 'plant',
} as const satisfies Record<string, Furniture['kind']>;

function item(
  variant: keyof typeof furnitureKinds, sequence: number, name: string,
  x: number, y: number, width: number, depth: number, height: number,
  materialId: string, rotation = 0,
): Furniture {
  return { id: `ref:${variant}:${String(sequence).padStart(2, '0')}`,
    kind: furnitureKinds[variant], name, x, y, width, depth, height, materialId, rotation };
}

function room(id: string, name: string, x: number, y: number, width: number, depth: number, floorMaterialId = 'oak-natural'): Room {
  return { id: `ref-room-${id}`, name, x, y, width, depth, floorMaterialId, wallMaterialId: 'plaster-warm' };
}

function wall(id: string, x1: number, y1: number, x2: number, y2: number, thickness = .15): Wall {
  return { id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, height: 2.8, materialId: 'plaster-warm' };
}

// Distances are measured along each wall from its start in metres.
function opening(wall: Wall, id: string, kind: Opening['kind'], offset: number, width: number, sill = 0, height = 2.15): Opening {
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  return { id, wallId: wall.id, kind, position: offset / length, width, sill, height, isOpen: kind === 'door' };
}

export function isReferencePlan(plan: Plan): boolean {
  return plan.rooms.some(r => r.id === 'ref-room-living') || plan.furniture.some(f => f.id.startsWith('ref:'));
}

export function makeReferencePlan(): Plan {
  const north = wall('ref-north', 0, 0, 11.4, 0, .22);
  const east = wall('ref-east', 11.4, 0, 11.4, 9.2, .22);
  const south = wall('ref-south', 11.4, 9.2, 0, 9.2, .22);
  const west = wall('ref-west', 0, 9.2, 0, 0, .22);
  const masterSide = wall('ref-master-side', 6.6, 0, 6.6, 4.08);
  const masterBack = wall('ref-master-back', 6.6, 4.08, 11.4, 4.08);
  const frontRooms = wall('ref-front-rooms', 0, 5.2, 8.65, 5.2);
  const studySide = wall('ref-study-side', 3.45, 5.2, 3.45, 9.2);
  const guestSide = wall('ref-guest-side', 6.21, 5.2, 6.21, 9.2);
  const bathSide = wall('ref-bath-side', 8.65, 4.08, 8.65, 9.2);

  return normalizePlan({
    version: 1, name: '原木奶油风 · 六空间样板间', width: 11.4, depth: 9.2, ceilingHeight: 2.8,
    verified: false, building: { activeFloor: 1, totalFloors: 1, floorHeight: 3.2, floors: {} },
    environment: { ...DEFAULT_ENVIRONMENT, enabled: false, landscape: 'none', hour: 12, north: 0 },
    materials: [{ id: 'ref-limestone', name: '灰米色石灰岩砖', category: 'floor', color: '#b2a799', pattern: 'tile', roughness: .72 }],
    rooms: [
      { ...room('living', '客餐厅', 0, 0, 8.65, 5.2),
        polygon: [{ x: 0, y: 0 }, { x: 6.6, y: 0 }, { x: 6.6, y: 4.08 },
          { x: 8.65, y: 4.08 }, { x: 8.65, y: 5.2 }, { x: 0, y: 5.2 }] },
      room('master', '主卧', 6.6, 0, 4.8, 4.08),
      room('study', '书房', 0, 5.2, 3.45, 4),
      room('guest', '次卧', 3.45, 5.2, 2.76, 4),
      room('kitchen', '厨房', 6.21, 5.2, 2.44, 4, 'ref-limestone'),
      room('bath', '卫浴', 8.65, 4.08, 2.75, 5.12, 'ref-limestone'),
    ],
    walls: [north, east, south, west, masterSide, masterBack, frontRooms, studySide, guestSide, bathSide],
    openings: [
      opening(west, 'ref-entry', 'door', 6.53, 1.04),
      opening(masterSide, 'ref-master-door', 'door', 3.36, .92),
      opening(frontRooms, 'ref-study-door', 'door', 2.58, .88),
      opening(frontRooms, 'ref-guest-door', 'door', 5.65, .87),
      opening(frontRooms, 'ref-kitchen-door', 'door', 7.16, .89),
      opening(bathSide, 'ref-bath-door', 'door', .57, .83),
      opening(north, 'ref-living-window', 'window', 3.70, 3.23, .68, 1.65),
      opening(north, 'ref-master-window', 'window', 9.30, 2.10, .76, 1.57),
      opening(south, 'ref-study-window', 'window', 9.48, 1.42, .62, 1.62),
      opening(south, 'ref-guest-window', 'window', 6.72, 1.11, .62, 1.62),
      opening(south, 'ref-kitchen-window', 'window', 4.64, .95, .62, 1.62),
    ],
    furniture: [
      item('rug', 1, '燕麦色羊毛地毯', 4.30, 2.42, 2.96, 2.64, .025, 'carpet-sand'),
      item('sofa', 1, '奶油色三人沙发', 4.30, 1.56, 2.63, 1.06, .88, 'linen-cream'),
      item('coffee-table', 1, '圆角胡桃木茶几', 4.30, 2.89, 1.27, .72, .38, 'wood-walnut'),
      item('media-console', 1, '客厅影音矮柜', 4.12, 4.33, 2.03, .43, .52, 'wood-oak', 180),
      item('round-dining', 1, '原木圆餐桌', 1.82, 2.65, 1.22, 1.22, .74, 'wood-oak'),
      item('dining-chair', 1, '餐椅 · 北', 1.82, 1.81, .47, .50, .79, 'wood-oak'),
      item('dining-chair', 2, '餐椅 · 东', 2.62, 2.39, .47, .50, .79, 'wood-oak', 72),
      item('dining-chair', 3, '餐椅 · 东南', 2.31, 3.33, .47, .50, .79, 'wood-oak', 144),
      item('dining-chair', 4, '餐椅 · 西南', 1.33, 3.33, .47, .50, .79, 'wood-oak', -144),
      item('dining-chair', 5, '餐椅 · 西', 1.02, 2.39, .47, .50, .79, 'wood-oak', -72),
      item('plant', 1, '客厅落地绿植', 5.98, .69, .69, .69, 1.55, 'marble-white'),
      item('curtain', 1, '客厅落地亚麻窗帘', 3.70, .22, 3.45, .15, 2.57, 'linen-cream'),

      item('rug', 2, '主卧浅米色地毯', 9.68, 2.20, 2.78, 2.83, .023, 'carpet-sand'),
      item('double-bed', 1, '主卧软包双人床', 10.08, 2.20, 2.01, 2.31, 1.02, 'linen-cream', 90),
      item('nightstand', 1, '主卧北侧床头柜', 10.90, .83, .48, .45, .49, 'wood-oak', 90),
      item('nightstand', 2, '主卧南侧床头柜', 10.90, 3.57, .48, .45, .49, 'wood-oak', 90),
      item('wardrobe', 1, '通顶橡木衣柜', 7.01, 1.53, 2.54, .61, 2.49, 'wood-oak', -90),
      item('curtain', 2, '主卧亚麻窗帘', 9.30, .22, 2.34, .15, 2.56, 'linen-cream'),

      item('rug', 3, '书房编织地毯', 1.84, 7.78, 1.91, 1.46, .023, 'carpet-sand'),
      item('desk', 1, '书房原木书桌', 1.82, 7.75, 1.60, .73, .76, 'wood-oak'),
      item('dining-chair', 6, '书桌椅', 1.80, 7.04, .53, .54, .85, 'linen-cream'),
      item('bookcase', 1, '开放式书架', .36, 6.70, 2.34, .45, 1.74, 'wood-oak', -90),
      item('plant', 2, '书房盆栽', .51, 8.56, .52, .52, 1.10, 'marble-white'),

      item('rug', 4, '次卧床边地毯', 4.33, 7.54, 1.43, 2.39, .022, 'carpet-sand'),
      item('single-bed', 1, '次卧原木单人床', 4.11, 7.39, .94, 2.21, .82, 'linen-cream'),
      item('nightstand', 3, '次卧床尾矮柜', 3.91, 8.80, .46, .43, .48, 'wood-oak'),
      item('wardrobe', 2, '次卧橡木衣柜', 5.93, 7.55, 2.45, .40, 1.45, 'wood-oak', 90),

      item('kitchen', 1, '灶台与水槽组合柜', 8.24, 7.30, 3.43, .64, .91, 'wood-oak', 90),
      item('vanity', 1, '浴室柜与面盆', 10.95, 7.87, 1.98, .59, .86, 'wood-oak', 90),
      item('shower', 1, '玻璃淋浴间', 10.58, 5.07, 1.28, 1.72, 2.06, 'marble-white'),
    ],
    nodes: [], routes: [],
  });
}
