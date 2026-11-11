"""Makes wings_cutout.webp: the wings with the black background removed.

The card hands (Ranks and Players) put it behind last month's number one.
The darker a pixel is in wings.png, the more see-through it becomes.

Run it again if wings.png changes:  python tools/make_wings_cutout.py
Needs Pillow (pip install pillow).
"""
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
BRIGHTEN = 2.2      # how quickly dark feathers become solid; higher keeps more of the dim ones


def main() -> int:
    with Image.open(ROOT / "wings.png") as source:
        image = source.convert("RGB")
    image.thumbnail((560, 840), Image.LANCZOS)
    r, g, b = image.split()
    brightest = ImageChops.lighter(ImageChops.lighter(r, g), b)
    alpha = brightest.point(lambda v: min(255, int(v * BRIGHTEN)))
    # the black background darkened the feather edges, so lift the colour a little
    lift = lambda channel: channel.point(lambda v: min(255, int(v * 1.25)))
    cutout = Image.merge("RGBA", (lift(r), lift(g), lift(b), alpha))
    cutout.save(ROOT / "wings_cutout.webp", "WEBP", quality=82, method=6)
    print("wrote wings_cutout.webp", cutout.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
