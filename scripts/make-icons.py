"""Regenerate the install icons: python scripts/make-icons.py (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / "public" / "icons"
root.mkdir(parents=True, exist_ok=True)
scale = 1024
image = Image.new("RGB", (scale, scale), "#16463b")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((88, 88, 936, 936), radius=226, fill="#174c40", outline="#30715a", width=9)

lime = "#b8ec8c"
soft = "#eaf8e5"
stroke = 32
# A face inside the four corners of a camera focus frame.
for coords, start, end in [
    ((218, 218, 396, 396), 180, 270),
    ((628, 218, 806, 396), 270, 360),
    ((218, 628, 396, 806), 90, 180),
    ((628, 628, 806, 806), 0, 90),
]:
    draw.arc(coords, start=start, end=end, fill=lime, width=stroke)

draw.ellipse((355, 297, 669, 704), outline=soft, width=26)
draw.ellipse((422, 458, 455, 491), fill=soft)
draw.ellipse((569, 458, 602, 491), fill=soft)
draw.arc((446, 515, 578, 607), start=15, end=165, fill=soft, width=20)

for size in (192, 512):
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / f"icon-{size}.png", optimize=True)
