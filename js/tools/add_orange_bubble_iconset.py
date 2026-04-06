"""Ajoute une bulle orange/marron sur la ligne des bulles (ligne 11) de IconSet.png."""
import colorsys
import sys
from pathlib import Path

from PIL import Image

ASSET = Path(
    r"C:\Users\33663\.cursor\projects\c-pascal-rpgmaker-pokemon-carbonne-arena-js\assets"
    r"\c__Users_33663_AppData_Roaming_Cursor_User_workspaceStorage_9ab6fc3da895554d8d6a666640bbac70_images_IconSet-cd07e1a3-d5c0-4ec4-90ba-5cb6ac4989d4.png"
)
OUT = Path(__file__).resolve().parent.parent / "IconSet_with_orange_bubble.png"


def orange_brown_from_red(red_cell: Image.Image, frame_cell: Image.Image) -> Image.Image:
    """Cadre depuis la bulle blanche (perle), sphère teintée orange/marron depuis la bulle rouge."""
    rpx = red_cell.load()
    fpx = frame_cell.load()
    w, h = red_cell.size
    out = Image.new("RGBA", (w, h))
    ox = out.load()
    target_h = 0.076

    for j in range(h):
        for i in range(w):
            rr, rg, rb, ra = rpx[i, j]
            fr, fg, fb, fa = fpx[i, j]
            if ra < 8:
                ox[i, j] = (0, 0, 0, 0)
                continue

            rf, gf, bf = rr / 255.0, rg / 255.0, rb / 255.0
            hh, s, v = colorsys.rgb_to_hsv(rf, gf, bf)

            if s < 0.18:
                ox[i, j] = (fr, fg, fb, ra)
                continue

            nh = target_h + (hh - 0.0) * 0.1
            ns = min(1.0, s * 1.02)
            nv = v
            if nv < 0.42:
                ns *= 0.86
                nh += 0.014
            nr, ng, nb = colorsys.hsv_to_rgb(nh, ns, nv)
            ox[i, j] = (
                int(max(0, min(255, nr * 255))),
                int(max(0, min(255, ng * 255))),
                int(max(0, min(255, nb * 255))),
                int(ra),
            )
    return out


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ASSET
    if not src.is_file():
        print("Fichier introuvable:", src, file=sys.stderr)
        sys.exit(1)

    im = Image.open(src).convert("RGBA")
    row = 10
    red = im.crop((2 * 32, row * 32, 3 * 32, (row + 1) * 32))
    white = im.crop((0, row * 32, 32, (row + 1) * 32))
    new_cell = orange_brown_from_red(red, white)

    dx, dy = 12 * 32, row * 32
    im2 = im.copy()
    im2.paste(new_cell, (dx, dy), new_cell)
    im2.save(OUT)
    print("Écrit:", OUT)


if __name__ == "__main__":
    main()
