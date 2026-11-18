"""Local isolated adapter from Roomcraft semantic plans to New Era render_photo.

Run: python -m uvicorn recognition.newera_bridge:app --host 127.0.0.1 --port 8002
An independent `newera mcp --standalone` process is used per render; no request
is sent to the user's existing editor at 7878 and no project file is modified.
"""
from __future__ import annotations

import asyncio
import base64
import json
import math
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EXE = ROOT / 'newera-test' / 'app' / '3D New Era AI' / 'newera.exe'
app = FastAPI(title='Roomcraft local New Era renderer', docs_url=None, redoc_url=None)
slots = asyncio.Semaphore(1)

class Point(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='ignore')
    x: float = Field(ge=-1000, le=1000)
    y: float = Field(ge=-1000, le=1000)

class Wall(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    start: Point
    end: Point
    height: float = Field(gt=0, le=20, allow_inf_nan=False)
    thickness: float = Field(gt=0, le=3, allow_inf_nan=False)
    materialId: str | None = None

class Room(BaseModel):
    name: str = Field(max_length=100)
    x: float = Field(ge=-1000, le=1000, allow_inf_nan=False)
    y: float = Field(ge=-1000, le=1000, allow_inf_nan=False)
    width: float = Field(gt=0, le=100, allow_inf_nan=False)
    depth: float = Field(gt=0, le=100, allow_inf_nan=False)
    polygon: list[Point] | None = Field(default=None, min_length=3, max_length=128)
    floorMaterialId: str | None = None

class Opening(BaseModel):
    wallId: str
    kind: Literal['door', 'window']
    position: float = Field(ge=0, le=1, allow_inf_nan=False)
    width: float = Field(gt=0, le=100, allow_inf_nan=False)
    height: float = Field(gt=0, le=20, allow_inf_nan=False)
    sill: float = Field(ge=0, le=20, allow_inf_nan=False)

class Furniture(BaseModel):
    kind: Literal['sofa', 'table', 'bed', 'cabinet', 'chair', 'plant']
    name: str = Field(max_length=100)
    x: float = Field(ge=-1000, le=1000, allow_inf_nan=False)
    y: float = Field(ge=-1000, le=1000, allow_inf_nan=False)
    width: float = Field(gt=0, le=30, allow_inf_nan=False)
    depth: float = Field(gt=0, le=30, allow_inf_nan=False)
    height: float = Field(gt=0, le=20, allow_inf_nan=False)
    rotation: float = Field(ge=-360, le=360, allow_inf_nan=False)

class Plan(BaseModel):
    model_config = ConfigDict(extra='ignore')
    walls: list[Wall] = Field(min_length=1, max_length=200)
    rooms: list[Room] = Field(max_length=100)
    openings: list[Opening] = Field(max_length=200)
    furniture: list[Furniture] = Field(max_length=100)
    nodes: list[dict] = Field(default_factory=list, max_length=600)
    routes: list[dict] = Field(default_factory=list, max_length=300)

class Camera(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='ignore')
    x: float = Field(ge=-1000, le=1000)
    y: float = Field(ge=-1000, le=1000)
    z: float = Field(ge=.05, le=100)
    look_at: tuple[float, float, float]
    fov: float = Field(default=65, ge=10, le=150)

class Input(BaseModel):
    plan: Plan
    camera: Camera | None = None
    quality: Literal['draft', 'good'] = 'draft'

def render(job: Input) -> dict:
    exe = Path(os.environ.get('NEWERA_EXECUTABLE', str(DEFAULT_EXE)))
    if not exe.is_file():
        raise RuntimeError('未找到 New Era 本地程序，请先安装并配置 NEWERA_EXECUTABLE。')
    env = dict(os.environ, NEWERA_TELEMETRY='0', NO_PROXY='127.0.0.1,localhost', no_proxy='127.0.0.1,localhost')
    process = subprocess.Popen([str(exe), 'mcp', '--standalone'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, env=env, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    messages: queue.Queue[bytes | None] = queue.Queue()
    def read_lines():
        assert process.stdout
        try:
            while line := process.stdout.readline(32 * 1024 * 1024): messages.put(line)
        finally: messages.put(None)
    threading.Thread(target=read_lines, daemon=True).start()
    seq = 0
    deadline = time.monotonic() + 300
    def send(method, params=None, notification=False):
        nonlocal seq
        seq += 1
        identifier = seq
        request = {'jsonrpc': '2.0', 'method': method}
        if not notification: request['id'] = identifier
        if params is not None: request['params'] = params
        assert process.stdin
        process.stdin.write((json.dumps(request, ensure_ascii=False, allow_nan=False)+'\n').encode('utf8')); process.stdin.flush()
        if notification: return None
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0: raise RuntimeError('渲染超时，已停止独立渲染进程。')
            try: line = messages.get(timeout=remaining)
            except queue.Empty: raise RuntimeError('渲染超时，已停止独立渲染进程。') from None
            if line is None: raise RuntimeError('独立渲染进程意外退出。')
            try: message = json.loads(line)
            except (ValueError, UnicodeDecodeError): continue
            if message.get('id') != identifier or not ('result' in message or 'error' in message): continue
            if 'error' in message: raise RuntimeError('New Era MCP 请求失败。')
            result = message['result']
            if isinstance(result, dict) and result.get('isError'):
                details = ' '.join(str(x.get('text','')) for x in result.get('content',[]) if x.get('type') == 'text')[:500]
                raise RuntimeError('New Era 无法转换或渲染此方案：'+details)
            return result
    def call(name, args): return send('tools/call', {'name':name, 'arguments':args})
    try:
        send('initialize', {'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'roomcraft-render-adapter','version':'1.0'}})
        send('notifications/initialized', notification=True)
        ids = [w.id for w in job.plan.walls]
        if len(ids) != len(set(ids)): raise RuntimeError('墙体 ID 重复，无法关联门窗。')
        if any(math.hypot(w.end.x-w.start.x,w.end.y-w.start.y)<.01 for w in job.plan.walls): raise RuntimeError('存在长度过短的墙体。')
        if any(o.wallId not in ids for o in job.plan.openings): raise RuntimeError('存在未关联墙体的门窗。')
        wall_specs = [{'pts':[[w.start.x*100,w.start.y*100],[w.end.x*100,w.end.y*100]],'h':w.height*100,'t':w.thickness*100,'sides':'#e9e4d9'} for w in job.plan.walls]
        def polygon(room):
            return room.polygon or [Point(x=room.x,y=room.y),Point(x=room.x+room.width,y=room.y),Point(x=room.x+room.width,y=room.y+room.depth),Point(x=room.x,y=room.y+room.depth)]
        room_specs = [{'name':r.name or 'Room','pts':[[p.x*100,p.y*100] for p in polygon(r)],'floor_mat':'tiles #ddd7cb 60' if (r.floorMaterialId or '').startswith(('tile','marble')) else 'wood'} for r in job.plan.rooms]
        created = call('create', {'exact':True,'walls':wall_specs,'rooms':room_specs})
        new_ids = created.get('structuredContent',{}).get('ids',[])
        if len(new_ids) < len(ids) or not all(str(v).startswith('w') for v in new_ids[:len(ids)]): raise RuntimeError('墙体转换结果无法确认，未生成效果图。')
        wall_map = dict(zip(ids,new_ids))
        specs=[]
        for o in job.plan.openings:
            wall = job.plan.walls[ids.index(o.wallId)]
            specs.append({'cat':o.kind,'wall':wall_map[o.wallId],'along':o.position*math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y)*100,'w':o.width*100,'h':o.height*100,'elev':o.sill*100})
        cats={'sofa':'sofa-3','table':'coffee-table','bed':'bed-queen','cabinet':'wardrobe','chair':'chair','plant':'plant'}
        for f in job.plan.furniture:
            cat='dining-table-4' if f.kind=='table' and f.height>=.65 else cats[f.kind]
            specs.append({'cat':cat,'name':f.name or f.kind,'at':[f.x*100,f.y*100],'w':f.width*100,'d':f.depth*100,'h':f.height*100,'angle':f.rotation})
        if specs: call('place', {'items':specs})
        options={'quality':job.quality,'w':960 if job.quality=='draft' else 1280,'h':640 if job.quality=='draft' else 800,'hour':15,'threads':4}
        if job.camera:
            c=job.camera
            if not all(math.isfinite(n) and abs(n)<=1000 for n in c.look_at): raise RuntimeError('相机目标坐标无效。')
            call('edit_cameras', {'action':'store','name':'Roomcraft view','x':c.x*100,'y':c.y*100,'z':c.z*100,'look_at':[n*100 for n in c.look_at],'fov':c.fov})
            options['cam']=0
        else: options['view']='aerial'
        result=call('render_photo',options)
        item=next((c for c in result.get('content',[]) if c.get('type')=='image' and c.get('mimeType')=='image/png'),None)
        if not item or not isinstance(item.get('data'),str): raise RuntimeError('路径追踪没有返回有效 PNG。')
        image=base64.b64decode(item['data'],validate=True)
        if len(image)>20*1024*1024 or not image.startswith(b'\x89PNG\r\n\x1a\n'): raise RuntimeError('路径追踪返回了无效图片。')
        warnings=['本图由 New Era 独立路径追踪生成；家具使用近似目录模型，外观可能与三维和 AI 图片不同。','颜色、材质、光照和门扇朝向可能与原方案不同，请核对。']
        if job.plan.nodes or job.plan.routes: warnings.append('水电点位和线路未进入本次效果图。')
        return {'image':'data:image/png;base64,'+item['data'],'warnings':warnings,'renderer':'newera-render-photo'}
    finally:
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)

@app.get('/health')
async def health(request:Request):
    if request.client and request.client.host not in ('127.0.0.1','::1','localhost','testclient'): raise HTTPException(403,'Local access only')
    return {'ok':True,'renderer':'newera-render-photo','installed':Path(os.environ.get('NEWERA_EXECUTABLE',str(DEFAULT_EXE))).is_file()}

@app.post('/render')
async def render_endpoint(request:Request):
    if request.client and request.client.host not in ('127.0.0.1','::1','localhost','testclient'): raise HTTPException(403,'Local access only')
    # Only the server-side adapter may call this expensive local endpoint.
    # Browser origins, including Origin: null, are never trusted: a remote page
    # could otherwise send a simple text/plain POST to the loopback interface.
    if 'origin' in request.headers: raise HTTPException(403,'浏览器不能直接调用本地渲染桥。')
    if request.headers.get('content-type','').split(';',1)[0].strip().lower() != 'application/json':
        raise HTTPException(415,'需要 application/json 请求。')
    if int(request.headers.get('content-length','0') or '0')>1024*1024: raise HTTPException(413,'Plan too large')
    raw=await request.body()
    if len(raw)>1024*1024: raise HTTPException(413,'Plan too large')
    try: job=Input.model_validate_json(raw)
    except ValueError: raise HTTPException(422,'户型或相机数据无效。') from None
    if slots.locked(): raise HTTPException(429,'已有路径追踪任务，请等待完成。')
    async with slots:
        try: return await asyncio.to_thread(render,job)
        except (RuntimeError,ValueError,OSError) as error: raise HTTPException(422,str(error)) from None
