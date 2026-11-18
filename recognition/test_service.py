from io import BytesIO
import math
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

from .app import app
from .recognizer import MAX_UPLOAD_BYTES, RecognitionError, polygon_area, preprocess, recognize_bytes, trace_polygon
from .sample import KNOWN_WIDTH_M, sample_png


class RecognitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sample = sample_png()
        cls.result = recognize_bytes(cls.sample, known_width_m=KNOWN_WIDTH_M)

    def test_sample_has_editable_walls_openings_and_concave_rooms(self):
        result = self.result
        self.assertGreaterEqual(len(result["wallSegments"]), 7)
        self.assertEqual(len(result["roomPolygons"]), 3)
        self.assertEqual(sorted(o["kind"] for o in result["openings"]), ["door", "door", "window", "window"])
        self.assertTrue(any(len(room["polygon"]) >= 6 for room in result["roomPolygons"]))
        for room in result["roomPolygons"]:
            self.assertGreater(abs(polygon_area(room["polygon"])), 400)

    def test_scale_uses_wall_axes_and_meters_only_for_heights(self):
        points = [p for w in self.result["wallSegments"] for p in [w["start"], w["end"]]]
        axis_width = max(p["x"] for p in points) - min(p["x"] for p in points)
        self.assertAlmostEqual(axis_width * self.result["metersPerPixel"], 10.0)
        self.assertAlmostEqual(self.result["ceilingHeight"], 2.8)
        wall_ids = {wall["id"] for wall in self.result["wallSegments"]}
        for opening in self.result["openings"]:
            self.assertIn(opening["wallId"], wall_ids)
            self.assertTrue(0 <= opening["position"] <= 1)
            self.assertGreater(opening["width"], 20)
            self.assertLess(opening["height"], 3)

    def test_missing_scale_is_explicitly_estimated(self):
        result = recognize_bytes(self.sample)
        self.assertEqual(result["metersPerPixel"], .02)
        self.assertTrue(any("estimated" in warning for warning in result["warnings"]))
        self.assertTrue(result["needsReview"])

    def test_preview_obj_is_derived_not_editor_authority(self):
        mesh = self.result["mesh"]
        self.assertFalse(mesh["editable"])
        self.assertEqual(mesh["format"], "obj")
        self.assertIn("\nv ", mesh["data"])
        self.assertIn("\nf ", mesh["data"])
        self.assertIn("edit JSON semantics", mesh["data"])

    def test_complex_room_is_reported_without_poisoning_editor_response(self):
        # Exercise the boundary between extraction and the editor's 128-vertex contract.
        # Keep the image, wall recognition and other room extraction real.
        complex_polygon = [{"x": 200 + 80 * math.cos(index * math.tau / 140), "y": 200 + 80 * math.sin(index * math.tau / 140)} for index in range(140)]
        boundary_results = [(complex_polygon, False)] + [(room["polygon"], False) for room in self.result["roomPolygons"][1:]]
        with patch("recognition.recognizer.trace_polygon", side_effect=boundary_results):
            result = recognize_bytes(self.sample, known_width_m=KNOWN_WIDTH_M)
        self.assertEqual(len(result["roomPolygons"]), 2)
        self.assertTrue(all(len(room["polygon"]) <= 128 for room in result["roomPolygons"]))
        self.assertTrue(any("140" in warning and "128" in warning and "手工" in warning for warning in result["warnings"]))
        self.assertTrue(result["needsReview"])

    def test_original_l_shaped_boundary_is_not_replaced_by_a_box(self):
        width = 12
        cells = [y * width + x for y in range(1, 8) for x in range(1, 8) if x < 4 or y < 4]
        polygon, holes = trace_polygon(cells, width)
        self.assertEqual(len(polygon), 6)
        self.assertAlmostEqual(abs(polygon_area(polygon)), 33)
        self.assertFalse(holes)

    def test_exif_transparency_and_resizing(self):
        image = Image.new("RGBA", (1800, 1200), (0, 0, 0, 0))
        buffer = BytesIO()
        image.save(buffer, "PNG")
        prepared, original, notices = preprocess(buffer.getvalue())
        self.assertEqual(prepared.size, (960, 640))
        self.assertEqual(prepared.getpixel((0, 0)), (255, 255, 255))
        self.assertEqual(original, {"width": 1800, "height": 1200})
        self.assertTrue(notices)
        jpeg = Image.new("RGB", (80, 40), "white")
        exif = Image.Exif()
        exif[274] = 6
        buffer = BytesIO()
        jpeg.save(buffer, "JPEG", exif=exif)
        oriented, original, _ = preprocess(buffer.getvalue())
        self.assertEqual(oriented.size, (40, 80))
        self.assertEqual(original, {"width": 40, "height": 80})

    def test_opening_height_fits_the_assumed_ceiling(self):
        result = recognize_bytes(self.sample, known_width_m=10, ceiling_height_m=1.8)
        for opening in result["openings"]:
            self.assertLessEqual(opening["sill"] + opening["height"], 1.8)

    def test_invalid_blank_oversized_and_unsafe_values_fail_clearly(self):
        for data in [b"", b"not an image", b"x" * (MAX_UPLOAD_BYTES + 1)]:
            with self.assertRaises(RecognitionError):
                recognize_bytes(data)
        buffer = BytesIO()
        Image.new("RGB", (100, 100), "white").save(buffer, "PNG")
        with self.assertRaises(RecognitionError):
            recognize_bytes(buffer.getvalue())
        for width in [float("nan"), float("inf"), -.1, 200]:
            with self.assertRaises(RecognitionError):
                recognize_bytes(self.sample, known_width_m=width)

    def test_fastapi_real_multipart_contract(self):
        with TestClient(app) as client:
            health = client.get("/health")
            self.assertEqual(health.status_code, 200)
            self.assertFalse(health.json()["trainedWeights"])
            sample = client.get("/sample")
            self.assertEqual(sample.headers["content-type"], "image/png")
            self.assertEqual(float(sample.headers["x-known-width-m"]), 10)
            response = client.post("/recognize", files={"file": ("sample.png", sample.content, "image/png")}, data={"known_width_m": "10"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["provider"], "cpu-geometric")
            self.assertEqual(len(response.json()["roomPolygons"]), 3)
            self.assertEqual(client.post("/recognize").status_code, 400)
            self.assertEqual(client.post("/recognize", files={"image": ("bad.png", b"bad", "image/png")}).status_code, 415)


if __name__ == "__main__":
    unittest.main()
