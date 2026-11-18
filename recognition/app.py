"""Local-only FastAPI adapter for the original CPU geometric recognizer."""
from __future__ import annotations

import asyncio
import os
from functools import lru_cache
from pathlib import Path
import subprocess
import time

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from .recognizer import MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES, MAX_WORKING_EDGE, RecognitionError, recognize_bytes
from .sample import KNOWN_WIDTH_M, sample_png
from .house_adapter import ROOT, UPSTREAM, recognize_house
from .roomsmith_adapter import BASE as ROOMSMITH_BASE, _upstream as roomsmith_upstream, router as roomsmith_router

app = FastAPI(title="Roomcraft CPU recognition", version="0.1.0", description="Editable semantic geometry, no trained weights or mesh-only editing.")
app.include_router(roomsmith_router)
semaphore = asyncio.Semaphore(2)


@lru_cache(maxsize=4)
def _integration_availability(house_source: str, house_python: str, roomsmith_source: str, time_bucket: int):
    """Probe installed dependencies once per minute, without recognizing an image."""
    source, python = Path(house_source), Path(house_python)
    house_available = False
    if python.is_file() and all((source / 'scripts' / name).is_file() for name in ('analyze.py', 'imgio.py')):
        try:
            result = subprocess.run(
                [str(python), '-c', 'import numpy, cv2; from PIL import Image, ImageDraw, ImageFont'],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                env=dict(os.environ, OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1'),
                timeout=3, check=False, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            )
            house_available = result.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            pass
    roomsmith_available = False
    if all((Path(roomsmith_source) / 'engine' / name).is_file() for name in ('room.py', 'drawings.py')):
        try:
            room, drawings = roomsmith_upstream()
            roomsmith_available = callable(getattr(getattr(room, 'Room', None), 'from_config', None)) and callable(getattr(drawings, 'draw_plan', None))
        except Exception:
            # A missing or incompatible optional package must not hide CPU recognition.
            pass
    return {'houseAvailable': house_available, 'roomsmithAvailable': roomsmith_available}


@app.get("/health")
def health():
    integrations = _integration_availability(
        os.environ.get('HOUSE_PLAN_DESIGNER_DIR', str(UPSTREAM)),
        os.environ.get('HOUSE_PLAN_PYTHON', str(ROOT / 'recognition' / '.venv-house312' / 'Scripts' / 'python.exe')),
        os.environ.get('ROOMSMITH_SOURCE_DIR', str(ROOMSMITH_BASE)),
        int(time.monotonic() // 60),
    )
    return {"status": "ok", "provider": "cpu-geometric", "trainedWeights": False, "maxUploadBytes": MAX_UPLOAD_BYTES, "maxImagePixels": MAX_IMAGE_PIXELS, "maxWorkingEdge": MAX_WORKING_EDGE, **integrations}


@app.get("/sample")
def sample():
    return Response(sample_png(), media_type="image/png", headers={"X-Known-Width-M": str(KNOWN_WIDTH_M), "X-Sample-Known-Width-M": str(KNOWN_WIDTH_M), "Cache-Control": "public, max-age=3600"})


@app.post("/recognize")
async def recognize(file: UploadFile | None = File(default=None), image: UploadFile | None = File(default=None), known_width_m: float | None = Form(default=None), ceiling_height_m: float = Form(default=2.8)):
    if file is not None and image is not None:
        raise HTTPException(400, "Provide one image field, either file or image.")
    upload = file or image
    if upload is None:
        raise HTTPException(400, "A floor-plan image is required.")
    data = bytearray()
    try:
        while chunk := await upload.read(1024 * 1024):
            data.extend(chunk)
            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "Image exceeds the 12 MiB input limit.")
        async with semaphore:
            try:
                return await run_in_threadpool(recognize_bytes, bytes(data), known_width_m, ceiling_height_m)
            except RecognitionError as error:
                raise HTTPException(error.status_code, str(error)) from None
    finally:
        await upload.close()

@app.post('/recognize/house')
async def recognize_house_image(file: UploadFile = File(), known_width_m: float | None = Form(default=None), ceiling_height_m: float = Form(default=2.8)):
    data = bytearray()
    try:
        while chunk := await file.read(1024 * 1024):
            data.extend(chunk)
            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, 'Image exceeds the 12 MiB input limit.')
        async with semaphore:
            try:
                return await run_in_threadpool(recognize_house, bytes(data), known_width_m, ceiling_height_m)
            except RecognitionError as error:
                raise HTTPException(error.status_code, str(error)) from None
    finally:
        await file.close()
