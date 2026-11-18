"""Original geometric image recognizer; no external project code or weights.

This intentionally limited baseline handles clean orthogonal, dark wall bands.
It emits editable semantics alongside an optional derived OBJ, never OBJ as the
editor's source of truth. Recognition is always marked as requiring review.
"""
from __future__ import annotations

from collections import deque
from io import BytesIO
import math
import warnings as python_warnings

import numpy as np
from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MAX_IMAGE_PIXELS = 24_000_000
MAX_WORKING_EDGE = 960
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


class RecognitionError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def preprocess(data: bytes) -> tuple[Image.Image, dict, list[str]]:
    if not data:
        raise RecognitionError("Please upload a nonempty PNG, JPEG or WEBP image.", 400)
    if len(data) > MAX_UPLOAD_BYTES:
        raise RecognitionError("Image exceeds the 12 MiB input limit.", 413)
    try:
        with python_warnings.catch_warnings():
            python_warnings.simplefilter("error", Image.DecompressionBombWarning)
            source = Image.open(BytesIO(data))
            if source.format not in {"PNG", "JPEG", "WEBP"}:
                raise RecognitionError("Only PNG, JPEG and WEBP are supported.", 415)
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise RecognitionError("Image exceeds the 24 megapixel limit.", 413)
            if min(source.size) < 32:
                raise RecognitionError("Image must be at least 32 pixels on each side.")
            # Correct camera orientation before establishing the working coordinates.
            source = ImageOps.exif_transpose(source)
            original = {"width": source.width, "height": source.height}
            rgba = source.convert("RGBA")
            white = Image.new("RGBA", rgba.size, "white")
            white.alpha_composite(rgba)
            image = white.convert("RGB")
    except RecognitionError:
        raise
    except (UnidentifiedImageError, OSError, ValueError):
        raise RecognitionError("The uploaded file is not a readable supported image.", 415) from None
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise RecognitionError("Image exceeds the safe decoding limit.", 413) from None
    notices: list[str] = []
    if max(image.size) > MAX_WORKING_EDGE:
        image.thumbnail((MAX_WORKING_EDGE, MAX_WORKING_EDGE), Image.Resampling.LANCZOS)
        notices.append("The image was downsampled; pixel coordinates refer to the reported working image size.")
    return image, original, notices


def runs(row: np.ndarray, minimum: int) -> list[tuple[int, int]]:
    padded = np.pad(row.astype(np.int8), (1, 1))
    changes = np.diff(padded)
    starts, ends = np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)
    return [(int(a), int(b - 1)) for a, b in zip(starts, ends) if b - a >= minimum]


def extract_bands(mask: np.ndarray, horizontal: bool, minimum: int) -> list[dict]:
    """Group long runs in adjacent scanlines into centerline wall segments."""
    scan = mask if horizontal else mask.T
    active: list[dict] = []
    finished: list[dict] = []
    for line_index, row in enumerate(scan):
        current = runs(row, minimum)
        claimed: set[int] = set()
        next_active: list[dict] = []
        for begin, end in current:
            matches = []
            for index, band in enumerate(active):
                if index in claimed:
                    continue
                previous_begin, previous_end = band["spans"][-1]
                overlap = max(0, min(end, previous_end) - max(begin, previous_begin) + 1)
                shorter = min(end - begin + 1, previous_end - previous_begin + 1)
                if overlap / shorter >= .8 and abs(begin - previous_begin) <= 18 and abs(end - previous_end) <= 18:
                    matches.append((overlap, index))
            if matches:
                _, index = max(matches)
                claimed.add(index)
                band = active[index]
                band["end_line"] = line_index
                band["spans"].append((begin, end))
                next_active.append(band)
            else:
                next_active.append({"start_line": line_index, "end_line": line_index, "spans": [(begin, end)]})
        finished.extend(band for index, band in enumerate(active) if index not in claimed)
        active = next_active
    finished.extend(active)
    result = []
    for band in finished:
        thickness = band["end_line"] - band["start_line"] + 1
        if thickness < 3 or thickness > 60:
            continue
        begin = float(np.median([span[0] for span in band["spans"]]))
        end = float(np.median([span[1] for span in band["spans"]]))
        center = (band["start_line"] + band["end_line"]) / 2
        if end - begin < max(minimum, thickness * 2):
            continue
        start_point = {"x": begin, "y": center} if horizontal else {"x": center, "y": begin}
        end_point = {"x": end, "y": center} if horizontal else {"x": center, "y": end}
        result.append({"start": start_point, "end": end_point, "thickness": float(thickness)})
    return result


def components(mask: np.ndarray, keep_pixels: bool = False) -> list[dict]:
    """Four-connected components using only NumPy and the standard library."""
    height, width = mask.shape
    occupied = mask.astype(np.uint8).ravel().tobytes()
    visited = bytearray(width * height)
    result = []
    for seed in range(width * height):
        if visited[seed] or not occupied[seed]:
            continue
        visited[seed] = 1
        queue = deque([seed])
        pixels = []
        count = 0
        min_x = max_x = seed % width
        min_y = max_y = seed // width
        boundary = False
        while queue:
            index = queue.popleft()
            y, x = divmod(index, width)
            count += 1
            if keep_pixels:
                pixels.append(index)
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)
            boundary = boundary or x == 0 or y == 0 or x == width - 1 or y == height - 1
            if x and not visited[index - 1] and occupied[index - 1]:
                visited[index - 1] = 1
                queue.append(index - 1)
            if x + 1 < width and not visited[index + 1] and occupied[index + 1]:
                visited[index + 1] = 1
                queue.append(index + 1)
            if y and not visited[index - width] and occupied[index - width]:
                visited[index - width] = 1
                queue.append(index - width)
            if y + 1 < height and not visited[index + width] and occupied[index + width]:
                visited[index + width] = 1
                queue.append(index + width)
        result.append({"count": count, "bbox": (min_x, min_y, max_x, max_y), "boundary": boundary, "pixels": pixels})
    return result


def snap_wall_junctions(walls: list[dict]) -> None:
    """Snap scan-band ends to nearby perpendicular axes, not outer ink edges."""
    for wall in walls:
        horizontal = abs(wall["end"]["x"] - wall["start"]["x"]) > abs(wall["end"]["y"] - wall["start"]["y"])
        for endpoint in [wall["start"], wall["end"]]:
            choices = []
            for other in walls:
                other_horizontal = abs(other["end"]["x"] - other["start"]["x"]) > abs(other["end"]["y"] - other["start"]["y"])
                if horizontal == other_horizontal:
                    continue
                axis = "x" if horizontal else "y"
                along = "y" if horizontal else "x"
                center = (other["start"][axis] + other["end"][axis]) / 2
                distance = abs(endpoint[axis] - center)
                reach = max(wall["thickness"], other["thickness"]) * .8 + 3
                low, high = sorted([other["start"][along], other["end"][along]])
                if distance <= reach and low - reach <= endpoint[along] <= high + reach:
                    choices.append((distance, center))
            if choices:
                endpoint["x" if horizontal else "y"] = min(choices)[1]


def polygon_area(polygon: list[dict]) -> float:
    return sum(p["x"] * polygon[(i + 1) % len(polygon)]["y"] - polygon[(i + 1) % len(polygon)]["x"] * p["y"] for i, p in enumerate(polygon)) / 2


def trace_polygon(pixels: list[int], width: int) -> tuple[list[dict], bool]:
    cells = set(pixels)
    edges: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for index in pixels:
        y, x = divmod(index, width)
        if index - width not in cells:
            edges.setdefault((x, y), []).append((x + 1, y))
        if index + 1 not in cells:
            edges.setdefault((x + 1, y), []).append((x + 1, y + 1))
        if index + width not in cells:
            edges.setdefault((x + 1, y + 1), []).append((x, y + 1))
        if index - 1 not in cells:
            edges.setdefault((x, y + 1), []).append((x, y))
    rings = []
    budget = sum(map(len, edges.values())) + 1
    while edges:
        start = min(edges)
        point = start
        ring = []
        for _ in range(budget):
            ring.append({"x": float(point[0]), "y": float(point[1])})
            candidates = edges.get(point)
            if not candidates:
                break
            following = candidates.pop()
            if not candidates:
                del edges[point]
            point = following
            if point == start:
                break
        if point != start or len(ring) < 4:
            continue
        # Exact orthogonal simplification; it preserves concave/L-shaped rooms.
        simplified = []
        for i, vertex in enumerate(ring):
            previous, following = ring[i - 1], ring[(i + 1) % len(ring)]
            cross = (vertex["x"] - previous["x"]) * (following["y"] - vertex["y"]) - (vertex["y"] - previous["y"]) * (following["x"] - vertex["x"])
            if cross:
                simplified.append(vertex)
        if len(simplified) >= 3:
            rings.append(simplified)
    if not rings:
        return [], False
    rings.sort(key=lambda ring: abs(polygon_area(ring)), reverse=True)
    return rings[0], len(rings) > 1


def openings_from_mask(mask: np.ndarray, walls: list[dict], kind: str) -> list[dict]:
    result = []
    for component in components(mask):
        if component["count"] < 10:
            continue
        left, top, right, bottom = component["bbox"]
        width, height = right - left + 1, bottom - top + 1
        if max(width, height) < 12:
            continue
        horizontal = width >= height
        center = {"x": (left + right) / 2, "y": (top + bottom) / 2}
        choices = []
        for wall in walls:
            dx, dy = wall["end"]["x"] - wall["start"]["x"], wall["end"]["y"] - wall["start"]["y"]
            if (abs(dx) >= abs(dy)) != horizontal:
                continue
            length_squared = dx * dx + dy * dy
            if length_squared < 1:
                continue
            t = ((center["x"] - wall["start"]["x"]) * dx + (center["y"] - wall["start"]["y"]) * dy) / length_squared
            if not 0 <= t <= 1:
                continue
            distance = math.hypot(center["x"] - wall["start"]["x"] - t * dx, center["y"] - wall["start"]["y"] - t * dy)
            if distance <= wall["thickness"] * .75 + 3:
                choices.append((distance, wall["id"], t))
        if choices:
            _, wall_id, position = min(choices)
            result.append({"wallId": wall_id, "kind": kind, "position": round(position, 6), "width": float(max(width, height)), "height": 2.15 if kind == "door" else 1.3, "sill": 0 if kind == "door" else .9})
    return result


def obj_preview(walls: list[dict], openings: list[dict], meters_per_pixel: float) -> str:
    """Derived static preview only. The JSON semantics remain authoritative."""
    lines = ["# Roomcraft original CPU recognition preview; edit JSON semantics, not this mesh"]
    offset = 0
    for wall in walls:
        sx, sy = wall["start"]["x"] * meters_per_pixel, wall["start"]["y"] * meters_per_pixel
        ex, ey = wall["end"]["x"] * meters_per_pixel, wall["end"]["y"] * meters_per_pixel
        length = math.hypot(ex - sx, ey - sy)
        if length <= 0:
            continue
        cuts = sorted((max(0, o["position"] * length - o["width"] * meters_per_pixel / 2), min(length, o["position"] * length + o["width"] * meters_per_pixel / 2), o) for o in openings if o["wallId"] == wall["id"])
        parts = []
        previous = 0.0
        full_height = wall.get("height", 2.8)
        for begin, end, opening in cuts + [(length, length, None)]:
            if begin > previous:
                parts.append((previous, begin, 0.0, full_height))
            if opening:
                if opening["sill"] > 0:
                    parts.append((begin, end, 0.0, opening["sill"]))
                lintel = opening["sill"] + opening["height"]
                if lintel < full_height:
                    parts.append((begin, end, lintel, full_height))
            previous = max(previous, end)
        ux, uy = (ex - sx) / length, (ey - sy) / length
        half = wall["thickness"] * meters_per_pixel / 2
        for begin, end, lower, upper in parts:
            vertices = []
            for height in [lower, upper]:
                for along, side in [(begin, -1), (end, -1), (end, 1), (begin, 1)]:
                    vertices.append((sx + ux * along - uy * half * side, height, sy + uy * along + ux * half * side))
            lines.append("o " + wall["id"])
            lines.extend("v %.6f %.6f %.6f" % vertex for vertex in vertices)
            for face in [(1, 4, 3, 2), (5, 6, 7, 8), (1, 2, 6, 5), (2, 3, 7, 6), (3, 4, 8, 7), (4, 1, 5, 8)]:
                lines.append("f " + " ".join(str(offset + index) for index in face))
            offset += 8
    return "\n".join(lines) + "\n"


def recognize_bytes(data: bytes, known_width_m: float | None = None, ceiling_height_m: float = 2.8) -> dict:
    if known_width_m is not None and (not math.isfinite(known_width_m) or not .5 <= known_width_m <= 100):
        raise RecognitionError("Known exterior width must be between 0.5 m and 100 m.")
    if not math.isfinite(ceiling_height_m) or not 1.8 <= ceiling_height_m <= 12:
        raise RecognitionError("Ceiling height must be between 1.8 m and 12 m.")
    image, original, notices = preprocess(data)
    rgb = np.asarray(image).astype(np.int16)
    maximum, minimum = rgb.max(axis=2), rgb.min(axis=2)
    dark = (maximum < 110) & (maximum - minimum < 45)
    red = (rgb[:, :, 0] > 150) & (rgb[:, :, 1] < 130) & (rgb[:, :, 2] < 130)
    blue = (rgb[:, :, 2] > 145) & (rgb[:, :, 0] < 130) & (rgb[:, :, 1] < 205) & (rgb[:, :, 2] - rgb[:, :, 0] > 40)
    structure = dark | red | blue
    minimum_run = max(24, int(min(image.size) * .045))
    walls = extract_bands(structure, True, minimum_run) + extract_bands(structure, False, minimum_run)
    if not walls:
        raise RecognitionError("No clear orthogonal wall bands were found. Use a cleaner image or the manual correction editor.")
    if len(walls) > 400:
        raise RecognitionError("Too many candidate wall lines. Crop the floor plan and remove furniture/dimension annotations.")
    snap_wall_junctions(walls)
    for index, wall in enumerate(walls):
        wall["id"] = f"wall-{index + 1:04d}"
        wall["height"] = ceiling_height_m
    all_x = [point["x"] for wall in walls for point in [wall["start"], wall["end"]]]
    axis_width = max(all_x) - min(all_x)
    if axis_width <= 0:
        raise RecognitionError("The recognized wall geometry has no measurable exterior width.")
    meters_per_pixel = known_width_m / axis_width if known_width_m else .02
    if known_width_m is None:
        notices.append("Scale is estimated at 0.02 m per working pixel. Calibrate a known exterior width before using dimensions.")
    opening_items = openings_from_mask(red, walls, "door") + openings_from_mask(blue, walls, "window")
    for index, opening in enumerate(opening_items):
        opening["id"] = f"opening-{index + 1:04d}"
        opening["height"] = min(opening["height"], ceiling_height_m - opening["sill"])
    closed = Image.new("1", image.size, 0)
    painter = ImageDraw.Draw(closed)
    for wall in walls:
        painter.line([(wall["start"]["x"], wall["start"]["y"]), (wall["end"]["x"], wall["end"]["y"])], fill=1, width=max(1, round(wall["thickness"])))
    free = ~np.asarray(closed).astype(bool)
    regions = [c for c in components(free, keep_pixels=True) if not c["boundary"] and c["count"] >= max(400, image.width * image.height * .0015)]
    regions.sort(key=lambda region: (region["bbox"][1], region["bbox"][0]))
    if len(regions) > 100:
        regions = regions[:100]
        notices.append("More than 100 enclosed regions were found; only the first 100 are returned for manual review.")
    rooms = []
    for index, region in enumerate(regions):
        polygon, has_holes = trace_polygon(region["pixels"], image.width)
        if len(polygon) > 128:
            notices.append(f"有房间轮廓包含 {len(polygon)} 个顶点，超过编辑器的 128 个顶点限额，已跳过该房间；请简化图纸或在校正界面手工补充边界。")
            continue
        if polygon:
            rooms.append({"id": f"room-{index + 1:04d}", "name": f"Room {index + 1}", "polygon": polygon, "floorMaterialId": "oak-natural"})
            if has_holes:
                notices.append("A room contains an internal island; its outer polygon is returned and the island needs manual review.")
    notices.extend([
        "原型使用几何算法识别清晰、正交的深色墙带，并非经过训练的语义分割模型。",
        "仅识别图中明确的红色门标记和蓝色窗标记；未标记或弧形门窗需要人工校正。",
        "层高、墙厚、门高及窗台高度均为待核对的估计或默认值，必须结合现场尺寸校正。",
    ])
    if not rooms:
        notices.append("No enclosed rooms were found. Close missing wall gaps or draw room polygons manually.")
    return {
        "provider": "cpu-geometric", "coordinateSpace": "pixel", "imageSize": {"width": image.width, "height": image.height},
        "sourceImageSize": original, "metersPerPixel": meters_per_pixel, "ceilingHeight": ceiling_height_m,
        "wallSegments": walls, "openings": opening_items, "roomPolygons": rooms,
        "warnings": list(dict.fromkeys(notices)), "needsReview": True,
        "mesh": {"format": "obj", "editable": False, "data": obj_preview(walls, opening_items, meters_per_pixel)},
    }
