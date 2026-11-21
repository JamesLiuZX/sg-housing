"""
The picture half of the demo block's bundled map, for scripts/build-demo.mjs:
stitches the OneMap tiles that script fetched into a folder, crops the result
to a rectangle of world pixels and writes it as WebP, one file per style.

  python3 -I scripts/demo-ground.py DIR ZOOM PX0 PY0 PX1 PY1 QUALITY STYLE [STYLE ...]

Reads DIR/STYLE-X-Y.png for every tile the rectangle touches and writes
DIR/STYLE.webp. Node has no image encoder, so this one step needs Python 3
with Pillow built with WebP (pip install Pillow). Exits 2 without it, and
build-demo.mjs then leaves the bundled map as it was.
"""

import os
import sys

try:
    from PIL import Image, features
except ImportError:
    sys.exit(2)

TILE = 256


def main() -> None:
    if not features.check('webp'):
        sys.exit(2)
    folder = sys.argv[1]
    z, px0, py0, px1, py1, quality = (int(v) for v in sys.argv[2:8])
    del z  # The tiles in the folder are already the ones for this zoom.
    tx0, ty0 = px0 // TILE, py0 // TILE
    tx1, ty1 = (px1 - 1) // TILE, (py1 - 1) // TILE
    for style in sys.argv[8:]:
        mosaic = Image.new('RGB', ((tx1 - tx0 + 1) * TILE, (ty1 - ty0 + 1) * TILE))
        for tx in range(tx0, tx1 + 1):
            for ty in range(ty0, ty1 + 1):
                with Image.open(os.path.join(folder, f'{style}-{tx}-{ty}.png')) as tile:
                    mosaic.paste(tile.convert('RGB'), ((tx - tx0) * TILE, (ty - ty0) * TILE))
        picture = mosaic.crop((px0 - tx0 * TILE, py0 - ty0 * TILE, px1 - tx0 * TILE, py1 - ty0 * TILE))
        picture.save(os.path.join(folder, f'{style}.webp'), 'WEBP', quality=quality, method=6)


if __name__ == '__main__':
    main()
