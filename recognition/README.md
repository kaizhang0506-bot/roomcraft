# Original CPU floor-plan recognition prototype

This service is an original implementation. It contains no code from Blueprint3D,
no GPL/AGPL project code, and no trained weights or CubiCasa5K data.

The prototype follows the general **image → structural mask → vector semantics →
derived mesh** architecture. The editor must use its wall/opening/room semantics.
An OBJ is returned only as a derived static preview and is explicitly not editable.

## Start locally

From the Roomcraft project root, using Python 3.12+ (tested with Python 3.14):

```powershell
python -m venv recognition/.venv
recognition/.venv/Scripts/python.exe -m pip install -r recognition/requirements.txt
recognition/.venv/Scripts/python.exe -m uvicorn recognition.app:app --host 127.0.0.1 --port 8001
```

On macOS/Linux, use `recognition/.venv/bin/python` instead of the Windows path.
The web app connects through its server-side recognition bridge; do not expose
this unauthenticated prototype directly to the public internet. Bind to loopback.

## HTTP interface

- `GET /health` reports provider, limits and the absence of trained weights.
- `GET /sample` returns an original three-room PNG, including one concave room,
  two red door bars and two blue window bars. `X-Known-Width-M: 10.0` is the sample's
  known exterior wall-axis span.
- `POST /recognize`: multipart field `file` (or `image`, not both), optional
  `known_width_m` and `ceiling_height_m` (default 2.8). Supports PNG/JPEG/WEBP based
  on decoded file content rather than its extension.

```bash
curl http://127.0.0.1:8001/sample -o sample.png
curl http://127.0.0.1:8001/recognize \
  -F file=@sample.png -F known_width_m=10
```

## Semantic response and units

The response contains `provider: "cpu-geometric"`, `coordinateSpace: "pixel"`,
`imageSize`, `sourceImageSize`, `metersPerPixel`, `ceilingHeight`, `wallSegments`,
`openings`, `roomPolygons`, `warnings`, `needsReview: true` and an optional `mesh`.

- Wall starts/ends, wall thickness, room polygon vertices and opening widths use
  **working-image pixels**. Downsampling preserves aspect ratio.
- Wall heights, ceiling height, opening height and sill height use **meters**.
- Opening `position` is the center fraction along the referenced wall (`0..1`).
- The frontend conversion layer multiplies pixel dimensions by `metersPerPixel`
  and translates the recognized wall bounding box to the editor's origin.
- The optional OBJ uses meters, Y-up height, and X/Z as plan coordinates. It
  remains a preview; raw OBJ vertices do not define editable rooms or walls.

When `known_width_m` is provided, scale is computed from the recognized exterior
wall-axis X span. Without it, scale is explicitly estimated at 0.02 m/working px.
No dimension OCR or hidden construction assumptions are claimed.

## What this baseline can and cannot recognize

EXIF orientation is corrected; alpha is composited over white; input is limited
to 12 MiB/24 megapixels and downsampled to a 960 px longest side. Dark, long
horizontal/vertical bands become candidate wall centerlines. Nearby perpendicular
endpoints snap to each other. Red and blue elongated components can mark doors
and windows. Closing those opening bands allows enclosed region tracing, which
preserves concave room polygons instead of replacing them with bounding boxes.

This is **classical geometric recognition, not a learned segmentation model**.
It is suited to clean orthogonal prototype plans. Furniture, dimension lines,
parallel wall outlines, skewed scans, curves, black backgrounds and unmarked
door symbols may be missed or misinterpreted. Colored annotations can be mistaken
for openings. Room labels are generated, not OCR. Interior islands require review.
All results require manual correction and calibrated dimensions; none are
construction-ready or a claim about structural load-bearing walls.

## Tests and reproducible sample

```powershell
recognition/.venv/Scripts/python.exe -m unittest recognition.test_service -v
recognition/.venv/Scripts/python.exe -m recognition.export_sample
```

`export_sample` writes `public/samples/prototype-floorplan.png`, an auditable
`cpu-recognition.expected.json`, and a derived `cpu-preview.obj`. The expected
JSON is a test artifact, not an inference shortcut; the web sample route should
POST the PNG to `/recognize` on every recognition run.

Dependency versions are pinned in `requirements.txt`; license metadata is listed
in `THIRD_PARTY_LICENSES.md`. No model download is required.
# House Plan Designer 识别适配器

`POST /recognize/house` 运行 `refs/core/house-plan-designer/scripts/analyze.py`，将其 HouseSpec 草稿墙线与候选门窗转换为本站可编辑的米制语义数据。它不生成房间轮廓；门窗类别、高度与比例需要人工校核，不能据此判断承重。不会用 OBJ/GLB 代替编辑数据。网站 `POST /api/recognize` 指定 `provider: "house"`。

默认引用相邻目录 `../refs/core/house-plan-designer` 与 `recognition/.venv-house312/Scripts/python.exe`；可设置 `HOUSE_PLAN_DESIGNER_DIR` 和 `HOUSE_PLAN_PYTHON` 到其他位置。本机虚拟环境复用了既有 Python 3.12 的站点包；可重新创建独立环境并安装 `numpy pillow opencv-python-headless`。项目本身（MIT）保留上游许可，应用依赖需各自核查。

参考宽度以米提供且指最外圈墙体宽度；不提供时上游可能估算比例，必须校准。服务只应监听 127.0.0.1 或通过安全网关访问。检查：`recognition/.venv/Scripts/python.exe -m unittest recognition.test_house_adapter recognition.test_house_http`；后者在本机临时端口启动服务并执行真实样图。

