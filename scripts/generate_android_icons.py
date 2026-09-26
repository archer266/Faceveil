"""Regenerate Faceveil's Android launcher PNGs and 512px store icon.

Requires Pillow: python -m pip install pillow
The matching adaptive icon is defined in android/app/src/main/res/drawable/faceveil_mark.xml.
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android/app/src/main/res"
SIZE = 1024
SCALE = SIZE / 108
GREEN = "#164A3B"
MINT = "#E8F8E9"


def curve(start, control1, control2, end):
    points = []
    for step in range(19):
        t = step / 18
        u = 1 - t
        points.append((
            u**3 * start[0] + 3 * u*u*t * control1[0] + 3 * u*t*t * control2[0] + t**3 * end[0],
            u**3 * start[1] + 3 * u*u*t * control1[1] + 3 * u*t*t * control2[1] + t**3 * end[1],
        ))
    return points


def draw_icon(round_icon=False, store_icon=False):
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if round_icon:
        draw.ellipse((0, 0, SIZE - 1, SIZE - 1), fill=GREEN)
    elif store_icon:
        draw.rectangle((0, 0, SIZE - 1, SIZE - 1), fill=GREEN)
    else:
        draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=220, fill=GREEN)

    def stroke(points, width=5.8):
        points = [(x*SCALE, y*SCALE) for x, y in points]
        diameter = round(width*SCALE)
        draw.line(points, fill=MINT, width=diameter)
        radius = diameter / 2
        for x, y in points:
            draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=MINT)

    stroke([(27, 39), (27, 33)] + curve((27, 33), (27, 29.7), (29.7, 27), (33, 27)) + [(39, 27)])
    stroke([(69, 27), (75, 27)] + curve((75, 27), (78.3, 27), (81, 29.7), (81, 33)) + [(81, 39)])
    stroke([(81, 69), (81, 75)] + curve((81, 75), (81, 78.3), (78.3, 81), (75, 81)) + [(69, 81)])
    stroke([(39, 81), (33, 81)] + curve((33, 81), (29.7, 81), (27, 78.3), (27, 75)) + [(27, 69)])
    stroke(curve((42, 60), (46.5, 66), (49.5, 66), (54, 66)) + curve((54, 66), (58.5, 66), (61.5, 66), (66, 60)))
    for x in (45, 63):
        radius = 3.35*SCALE
        center_x, center_y = x*SCALE, 45*SCALE
        draw.ellipse((center_x-radius, center_y-radius, center_x+radius, center_y+radius), fill=MINT)
    return image


for density, pixels in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
    folder = RES / f"mipmap-{density}"
    draw_icon().resize((pixels, pixels), Image.Resampling.LANCZOS).save(folder / "ic_launcher.png")
    draw_icon(round_icon=True).resize((pixels, pixels), Image.Resampling.LANCZOS).save(folder / "ic_launcher_round.png")

store = ROOT / "assets/faceveil-play-icon.png"
store.parent.mkdir(exist_ok=True)
draw_icon(store_icon=True).resize((512, 512), Image.Resampling.LANCZOS).convert("RGB").save(store)
