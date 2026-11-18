"""Run house-plan-designer's MIT recognizer and convert its draft to editable semantics.

The upstream script returns wall/opening candidates, not recognized room polygons.
All results need human review; bearing classifications are deliberately discarded.
"""
from __future__ import annotations
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
from .recognizer import RecognitionError, preprocess

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT.parent / 'refs' / 'core' / 'house-plan-designer'

def recognize_house(data: bytes, known_width_m: float | None = None, ceiling_height_m: float = 2.8) -> dict:
    if known_width_m is not None and (not math.isfinite(known_width_m) or not 0 < known_width_m <= 100):
        raise RecognitionError('参考宽度必须在 0 到 100 米之间。', 400)
    if not math.isfinite(ceiling_height_m) or not 1.8 <= ceiling_height_m <= 20:
        raise RecognitionError('层高必须在 1.8 到 20 米之间。', 400)
    source = Path(os.environ.get('HOUSE_PLAN_DESIGNER_DIR', str(UPSTREAM)))
    python = Path(os.environ.get('HOUSE_PLAN_PYTHON', str(ROOT / 'recognition' / '.venv-house312' / 'Scripts' / 'python.exe')))
    script = source / 'scripts' / 'analyze.py'
    if not script.is_file() or not python.is_file():
        raise RecognitionError('House Plan 识别器未安装，请配置 HOUSE_PLAN_DESIGNER_DIR 和 HOUSE_PLAN_PYTHON。', 503)
    image, original, warnings = preprocess(data)
    with tempfile.TemporaryDirectory(prefix='roomcraft-house-') as directory:
        directory = Path(directory)
        input_path, output = directory / 'input.png', directory / 'out'
        image.save(input_path)
        command = [str(python), str(script), str(input_path), '--out', str(output)]
        if known_width_m is not None:
            command += ['--total-width', str(known_width_m * 1000)]
        try:
            env = dict(os.environ, OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1', OPENCV_FOR_THREADS_NUM='1')
            completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
                                       timeout=60, check=False, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except subprocess.TimeoutExpired:
            raise RecognitionError('House Plan 识别超时，请使用较清晰的图片。', 422) from None
        if completed.returncode != 0 or not (output / 'draft.json').is_file():
            raise RecognitionError('House Plan 无法识别这张图，请核对比例或手工校正。', 422)
        try:
            draft = json.loads((output / 'draft.json').read_text(encoding='utf-8'))
            analysis = json.loads((output / 'analysis.json').read_text(encoding='utf-8'))
            walls, openings = [], []
            for wall in draft['walls'][:600]:
                a, b = wall['a'], wall['b']
                x0,y0,x1,y1 = (float(a[0])/1000,float(a[1])/1000,float(b[0])/1000,float(b[1])/1000)
                length=math.hypot(x1-x0,y1-y0); thickness=float(wall['t'])/1000
                if length < .05 or not .01 <= thickness <= 3: continue
                wid=str(wall['id'])[:100]
                walls.append({'id':wid,'start':{'x':x0,'y':y0},'end':{'x':x1,'y':y1},'thickness':thickness,'height':ceiling_height_m})
                horizontal=abs(x1-x0)>=abs(y1-y0); first=x0 if horizontal else y0; last=x1 if horizontal else y1
                if abs(last-first)<.001: continue
                for opening in wall.get('openings', []):
                    start,end=float(opening['from'])/1000,float(opening['to'])/1000
                    position=((start+end)/2-first)/(last-first); width=abs(end-start)
                    if not 0 <= position <= 1 or not .05 <= width <= length: continue
                    kind='window' if opening['type']=='window' else 'door'
                    openings.append({'id':f'{wid}-opening-{len(openings)}','wallId':wid,'kind':kind,'position':position,'width':width,'height':1.4 if kind=='window' else 2.05,'sill':.9 if kind=='window' else 0})
            if not walls: raise ValueError('no walls')
            scale=float(analysis['mmPerPx'])/1000
            if not math.isfinite(scale) or scale <= 0: raise ValueError('invalid scale')
        except (ValueError, TypeError, KeyError, IndexError, OSError):
            raise RecognitionError('House Plan 返回了无效结构，原户型未修改。', 422) from None
    warnings += ['House Plan 识别的墙线与门窗为候选，门窗高和窗台高为估计值，必须人工核对。',
                 '该识别器不输出房间轮廓，请在校正界面手动绘制房间；承重墙不能由图片颜色确定。']
    if known_width_m is None: warnings.append('没有提供已知宽度，比例由识别器估算，必须手动校准。')
    return {'provider':'house-plan-designer','coordinateSpace':'meter','imageSize':{'width':image.width,'height':image.height},
            'metersPerPixel':scale,'ceilingHeight':ceiling_height_m,'wallSegments':walls,'openings':openings[:300],
            'roomPolygons':[],'warnings':warnings,'needsReview':True}
