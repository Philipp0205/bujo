"""Synthetic journal pages for the tests. Generated in code, never a photo.

make_page() draws a white or cream page, an optional light dot grid, and one line per entry: a drawn bullet
symbol (• x > < ○ –) followed by printed text. A line may be rotated a little and the page may get noise.
Same seed, same bytes.
"""
from __future__ import annotations

import io
import random
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont

# (symbol, text). The first entry has no symbol: a date line.
DEFAULT_LINES: list[tuple[str, str]] = [
    ("none", "20.11.2025"),
    ("•", "Task eins"),
    ("x", "Steuer abgeben"),
    (">", "Müller anrufen"),
    ("<", "Zahnarzt Termin"),
    ("○", "Geburtstag Oma"),
    ("–", "Idee für Wochenende"),
]

# Month-level pages, as the LLM is asked to return them: a heading line with no symbol, then the lines.
FUTURE_LINES: list[tuple[str, str]] = [
    ("none", "Future log 2027"),
    ("none", "Januar"),
    ("•", "Steuer machen"),
    ("○", "15 Zahnarzt"),
    ("none", "Februar"),
    ("•", "Urlaub buchen"),
]
CALENDAR_LINES: list[tuple[str, str]] = [
    ("none", "Dezember 2026"),
    ("none", "2 Mi Lunch mit Mira"),
    ("none", "4 Fr Konzert"),
    ("none", "7 Mo Team Meeting"),
]
MONTH_TASK_LINES: list[tuple[str, str]] = [
    ("none", "Dezember"),
    ("•", "Geschenke kaufen"),
    ("•", "Steuer"),
    ("–", "Weihnachtsfeier planen"),
]

# Dark enough that the detector's ink threshold catches the dots, so the size filter has real work to do.
GRID_GREY = (125, 125, 125)

_FONT_CANDIDATES = [
    "DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "Arial.ttf",
]


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)  # Pillow's bundled font, always present


@dataclass
class Expected:
    symbol: str
    text: str
    y_center: int  # in image pixels, before any rotation of the line


@dataclass
class Fixture:
    png: bytes
    width: int
    height: int
    expected: list[Expected]


def _draw_symbol(d: ImageDraw.ImageDraw, symbol: str, cx: int, cy: int, ink: int) -> None:
    s = 14  # half size of a stroke symbol
    if symbol == "•":
        d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=ink)
    elif symbol == "x":
        d.line([cx - s, cy - s, cx + s, cy + s], fill=ink, width=4)
        d.line([cx - s, cy + s, cx + s, cy - s], fill=ink, width=4)
    elif symbol == ">":
        d.line([cx - s, cy - s, cx + s, cy], fill=ink, width=4)
        d.line([cx + s, cy, cx - s, cy + s], fill=ink, width=4)
    elif symbol == "<":
        d.line([cx + s, cy - s, cx - s, cy], fill=ink, width=4)
        d.line([cx - s, cy, cx + s, cy + s], fill=ink, width=4)
    elif symbol == "○":
        d.ellipse([cx - 13, cy - 13, cx + 13, cy + 13], outline=ink, width=3)
    elif symbol == "–":
        d.line([cx - 14, cy, cx + 14, cy], fill=ink, width=4)


def make_page(
    lines: list[tuple[str, str]] | None = None,
    *,
    width: int = 900,
    cream: bool = False,
    grid: bool = False,
    noise: float = 0.0,
    rotate: float = 0.0,
    seed: int = 7,
    top: int = 80,
    pitch: int = 90,
    font_size: int = 34,
    text_gap: int = 26,
) -> Fixture:
    """`rotate` is the largest tilt (degrees) given to a line. `noise` is the gaussian sigma of the page noise.
    `text_gap` is the blank space in px between the right edge of a symbol and its text."""
    entries = lines if lines is not None else DEFAULT_LINES
    rng = random.Random(seed)
    height = top + pitch * len(entries) + 40
    paper = (247, 240, 220) if cream else (255, 255, 255)
    page = Image.new("RGB", (width, height), paper)
    d = ImageDraw.Draw(page)

    if grid:  # a light dot every 28 px, as on a dotted notebook
        for gy in range(14, height, 28):
            for gx in range(14, width, 28):
                d.ellipse([gx - 1, gy - 1, gx + 1, gy + 1], fill=GRID_GREY)

    font = _font(font_size)
    expected: list[Expected] = []
    for index, (symbol, text) in enumerate(entries):
        cy = top + index * pitch + pitch // 2 - 20
        layer = Image.new("RGBA", (width, 120), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ink = (20, 20, 30, 255)
        text_x = 90 + 14 + text_gap
        if symbol != "none":
            _draw_symbol(ld, symbol, 90, 60, ink)
        else:
            text_x = 90
        ld.text((text_x, 60), text, font=font, fill=ink, anchor="lm")
        angle = rng.uniform(-rotate, rotate) if rotate else 0.0
        if angle:
            layer = layer.rotate(angle, resample=Image.BICUBIC, center=(90, 60))
        page.paste(layer, (0, cy - 60), layer)
        expected.append(Expected(symbol=symbol, text=text, y_center=cy))

    if noise > 0:
        px = page.load()
        for y in range(height):
            for x in range(width):
                n = int(rng.gauss(0, noise))
                r, g, b = px[x, y]
                px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))

    buffer = io.BytesIO()
    page.save(buffer, format="PNG")
    return Fixture(png=buffer.getvalue(), width=width, height=height, expected=expected)


def with_corner_number(png: bytes, number: int) -> bytes:
    """The page with a lone "- N -" drawn in the bottom right corner, as a notebook page number. Synthetic."""
    page = Image.open(io.BytesIO(png)).convert("RGB")
    ImageDraw.Draw(page).text((page.width - 60, page.height - 24), f"- {number} -", font=_font(26), fill=(20, 20, 30), anchor="rm")
    out = io.BytesIO()
    page.save(out, format="PNG")
    return out.getvalue()


def to_jpeg(png: bytes, quality: int = 85) -> bytes:
    out = io.BytesIO()
    Image.open(io.BytesIO(png)).convert("RGB").save(out, format="JPEG", quality=quality)
    return out.getvalue()


def to_webp(png: bytes) -> bytes:
    out = io.BytesIO()
    Image.open(io.BytesIO(png)).convert("RGB").save(out, format="WEBP", quality=90)
    return out.getvalue()


def noisy_blank(width: int = 400, height: int = 300, seed: int = 3) -> bytes:
    """A page with only a dot grid and no writing at all."""
    page = Image.new("RGB", (width, height), (255, 255, 255))
    d = ImageDraw.Draw(page)
    for gy in range(14, height, 28):
        for gx in range(14, width, 28):
            d.ellipse([gx - 1, gy - 1, gx + 1, gy + 1], fill=GRID_GREY)
    out = io.BytesIO()
    page.save(out, format="PNG")
    return out.getvalue()


if __name__ == "__main__":  # python tests/fixtures.py out.png: look at a page by hand
    import sys

    target = sys.argv[1] if len(sys.argv) > 1 else "fixture.png"
    with open(target, "wb") as handle:
        handle.write(make_page(grid=True, cream=True, noise=4, rotate=1.5).png)
    print(target)
