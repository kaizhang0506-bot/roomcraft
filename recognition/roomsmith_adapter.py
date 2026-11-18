"""Roomcraft-to-Roomsmith adapter for a single measured room drawing.

The upstream MIT project remains in refs/ai/roomsmith. Only semantic values are
passed into its actual Room and draw_plan implementation; no generated image is
used as geometry and no rendering service or agent is invoked.
"""
from __future__ import annotations

import importlib.util
import math
import os
from pathlib import Path
import sys
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter()
BASE = Path(__file__).resolve().parents[2] / 'refs' / 'ai' / 'roomsmith'


class InputModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='ignore')


class Point(InputModel):
    x: float = Field(ge=-1000, le=1000)
    y: float = Field(ge=-1000, le=1000)


class Room(InputModel):
    id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=160)
    x: float = Field(ge=-1000, le=1000)
    y: float = Field(ge=-1000, le=1000)
    width: float = Field(gt=0, le=100)
    depth: float = Field(gt=0, le=100)
    polygon: list[Point] | None = Field(default=None, min_length=3, max_length=128)


class Wall(InputModel):
    id: str = Field(min_length=1, max_length=120)
    start: Point
    end: Point
    thickness: float = Field(gt=0, le=3)


class Opening(InputModel):
    id: str = Field(min_length=1, max_length=120)
    wallId: str = Field(min_length=1, max_length=120)
    kind: str = Field(pattern='^(door|window)$')
    position: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=100)
    height: float = Field(gt=0, le=20)
    sill: float = Field(ge=0, le=20)


class Furniture(InputModel):
    name: str = Field(min_length=1, max_length=160)
    x: float = Field(ge=-1000, le=1000)
    y: float = Field(ge=-1000, le=1000)
    width: float = Field(gt=0, le=30)
    depth: float = Field(gt=0, le=30)
    rotation: float = Field(ge=-360, le=360)


class Plan(InputModel):
    rooms: list[Room] = Field(max_length=100)
    walls: list[Wall] = Field(max_length=200)
    openings: list[Opening] = Field(max_length=200)
    furniture: list[Furniture] = Field(max_length=100)
    ceilingHeight: float = Field(default=2.8, gt=0, le=20)


class DrawingRequest(InputModel):
    roomId: str = Field(min_length=1, max_length=120)
    plan: Plan


@lru_cache(maxsize=1)
def _upstream():
    base = Path(os.environ.get('ROOMSMITH_SOURCE_DIR', str(BASE))).resolve()
    def load(name: str):
        filename = base / 'engine' / f'{name}.py'
        if not filename.is_file():
            raise FileNotFoundError('Roomsmith 源码不可用，请配置 ROOMSMITH_SOURCE_DIR。')
        module_name = f'roomcraft_roomsmith_{name}'
        spec = importlib.util.spec_from_file_location(module_name, filename)
        if spec is None or spec.loader is None:
            raise RuntimeError('无法加载 Roomsmith。')
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module
    return load('room'), load('drawings')


def _inside(x: float, y: float, pts: list[tuple[float, float]]) -> bool:
    inside = False
    for a, b in zip(pts, pts[1:] + pts[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            inside = not inside
    return inside


def make_drawing(job: DrawingRequest) -> dict:
    room = next((r for r in job.plan.rooms if r.id == job.roomId), None)
    if room is None:
        raise ValueError('请先选择一个有效的房间。')
    pts = [(p.x, p.y) for p in room.polygon] if room.polygon else [(room.x, room.y), (room.x+room.width, room.y), (room.x+room.width, room.y+room.depth), (room.x, room.y+room.depth)]
    signed = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(pts,pts[1:]+pts[:1]))
    if abs(signed) < .01 or any(math.dist(a,b) < .001 for a,b in zip(pts,pts[1:]+pts[:1])):
        raise ValueError('房间边界无效，请先校正房间轮廓。')
    if signed < 0:
        pts.reverse()
    config = {'name': room.name, 'units': 'm', 'ceiling_height': job.plan.ceilingHeight, 'shape': {'type': 'polygon', 'points': pts}, 'openings': []}
    warnings = ['图纸根据当前房间多边形生成，墙体、比例和门窗需人工核对；不是施工图。']
    wall_by_id = {wall.id: wall for wall in job.plan.walls}
    omitted_openings = 0
    for opening in job.plan.openings:
        wall = wall_by_id.get(opening.wallId)
        if wall is None:
            continue
        x = wall.start.x + (wall.end.x-wall.start.x)*opening.position
        y = wall.start.y + (wall.end.y-wall.start.y)*opening.position
        matches = []
        near_boundary = False
        wall_dx,wall_dy=wall.end.x-wall.start.x,wall.end.y-wall.start.y
        wall_length=math.hypot(wall_dx,wall_dy)
        if wall_length < .001:
            continue
        for i,(a,b) in enumerate(zip(pts,pts[1:]+pts[:1])):
            dx,dy=b[0]-a[0],b[1]-a[1]; length=math.hypot(dx,dy)
            along=((x-a[0])*dx+(y-a[1])*dy)/length
            distance=abs((x-a[0])*dy-(y-a[1])*dx)/length
            if distance <= wall.thickness/2+.08 and 0 <= along <= length:
                near_boundary = True
            parallel = abs(dx*wall_dy-dy*wall_dx)/(length*wall_length) <= .05
            if parallel and distance <= wall.thickness/2+.08 and opening.width/2 <= along <= length-opening.width/2:
                matches.append((distance,i,along))
        if matches:
            _,index,along=min(matches)
            # The semantic plan has no hinge/swing; don't invent a door arc.
            config['openings'].append({'tag': ('门 ' if opening.kind=='door' else '窗 ')+opening.id, 'type': 'opening' if opening.kind=='door' else 'window', 'wall': f'w{index+1}', 'pos': along, 'width': opening.width, 'sill': opening.sill, 'head': opening.sill+opening.height})
        elif near_boundary:
            omitted_openings += 1
    if omitted_openings:
        warnings.append(f'{omitted_openings} 个靠近房间的门窗未能匹配边界，请手动核对。')
    items=[]; skipped=0
    for item in job.plan.furniture:
        if not _inside(item.x,item.y,pts):
            continue
        angle = item.rotation % 180
        if min(abs(angle),abs(angle-90),abs(angle-180)) > .01:
            skipped+=1; continue
        w,d=(item.depth,item.width) if abs(angle-90) <= .01 else (item.width,item.depth)
        items.append({'x': item.x-w/2, 'y': item.y-d/2, 'w': w, 'd': d, 'label': item.name})
    if skipped:
        warnings.append(f'{skipped} 件斜向家具暂未画入：Roomsmith 平面图仅显示轴对齐家具。')
    room_module, drawings = _upstream()
    model = room_module.Room.from_config(config)
    svg = drawings.draw_plan(model, {'id':'', 'name':room.name, 'layout':{'plan':items}}, title=room.name)
    return {'svg': svg, 'room': room.name, 'provider': 'roomsmith-draw-plan', 'warnings': warnings}


@router.post('/roomsmith/drawing')
def roomsmith_drawing(job: DrawingRequest, request: Request):
    if request.headers.get('origin') is not None:
        raise HTTPException(403, '只允许本地服务端调用。')
    if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        raise HTTPException(415, '需要 JSON 请求。')
    try:
        return make_drawing(job)
    except FileNotFoundError:
        raise HTTPException(503, 'Roomsmith 未安装，请检查本机参考项目路径。') from None
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
