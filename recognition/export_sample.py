"""Rebuild the original public sample and its auditable recognition result."""
from pathlib import Path
import json

from .recognizer import recognize_bytes
from .sample import KNOWN_WIDTH_M, sample_png


def main():
    root = Path(__file__).resolve().parent.parent
    destination = root / "public" / "samples"
    destination.mkdir(parents=True, exist_ok=True)
    image = sample_png()
    (destination / "prototype-floorplan.png").write_bytes(image)
    result = recognize_bytes(image, known_width_m=KNOWN_WIDTH_M)
    (destination / "cpu-recognition.expected.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (destination / "cpu-preview.obj").write_text(result["mesh"]["data"], encoding="utf-8")
    print(json.dumps({"walls": len(result["wallSegments"]), "openings": len(result["openings"]), "rooms": len(result["roomPolygons"]), "roomVertices": [len(room["polygon"]) for room in result["roomPolygons"]], "metersPerPixel": result["metersPerPixel"]}))


if __name__ == "__main__":
    main()
