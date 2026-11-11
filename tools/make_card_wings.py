"""Makes card_wings.webp: a web-sized copy of the wings that attach to the outside of a card.

The source is the wings layer from the layered card template (final/wings.png,
1400 x 2000, see-through, drawn where the wings sit around the card).
The card hands (Ranks and Players) show it on last month's number one.

    python tools/make_card_wings.py path/to/final/wings.png

Needs Pillow (pip install pillow).
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    with Image.open(sys.argv[1]) as source:
        wings = source.convert("RGBA")
    if wings.size != (1400, 2000):
        print("Expected the 1400 x 2000 wings layer, got", wings.size)
        return 1
    wings = wings.resize((700, 1000), Image.LANCZOS)
    wings.save(ROOT / "card_wings.webp", "WEBP", quality=88, method=6)
    print("wrote card_wings.webp")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
