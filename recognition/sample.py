"""Generate an original, deliberately clean prototype floor-plan image.

No third-party drawing or trained model is used. Red bars mark doors; blue bars
mark windows. Wall axes span 600 px, representing a known 10 m exterior width.
"""
from io import BytesIO

from PIL import Image, ImageDraw

KNOWN_WIDTH_M = 10.0


def sample_image() -> Image.Image:
    image = Image.new("RGB", (720, 540), "white")
    draw = ImageDraw.Draw(image)
    ink, width = (35, 35, 35), 13
    draw.line([(60, 60), (660, 60), (660, 480), (60, 480), (60, 60)], fill=ink, width=width)
    draw.line([(390, 60), (390, 480)], fill=ink, width=width)
    draw.line([(60, 270), (260, 270), (260, 480)], fill=ink, width=width)
    # Bars occupy the entire wall thickness and thus close room segmentation.
    draw.rectangle((170, 264, 230, 276), fill=(215, 72, 58))
    draw.rectangle((384, 175, 396, 235), fill=(215, 72, 58))
    draw.rectangle((170, 54, 280, 66), fill=(65, 145, 205))
    draw.rectangle((654, 325, 666, 420), fill=(65, 145, 205))
    label = (120, 120, 120)
    draw.text((70, 20), "ORIGINAL CPU SAMPLE  /  known exterior axis width: 10.00 m", fill=label)
    draw.text((150, 150), "L-SHAPED LIVING", fill=label)
    draw.text((100, 365), "STUDY", fill=label)
    draw.text((490, 270), "BEDROOM", fill=label)
    draw.text((70, 507), "Red: door   Blue: window   Gray: wall   Height: assumed 2.80 m", fill=label)
    return image


def sample_png() -> bytes:
    buffer = BytesIO()
    sample_image().save(buffer, format="PNG")
    return buffer.getvalue()
