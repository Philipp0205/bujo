"""Bullet journal page detector: page crop, illumination normalise, dot-grid removal,
line segmentation and a heuristic class for the leftmost glyph of each line.

Ported from the OCR spike (scored 4/4 symbols on the real page, 6/6 on drawn shapes). It needs only
OpenCV, numpy, scikit-image and Pillow.

Pipeline: image bytes -> BGR array -> preprocess() -> segment_lines() -> classify_symbol() per line
-> line_bbox() for the page boxes. analyse() runs all of it.

Symbols: "•" task, "x" done, ">" migrated, "<" scheduled, "○" event, "–" note, "none" (a line without a
bullet, such as the date line). Nothing here writes to disk. The image lives in memory only.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image, ImageOps
from skimage.morphology import skeletonize

SYMBOLS = ("•", "x", ">", "<", "○", "–")
NONE = "none"

# Photos larger than this (long side, pixels) are shrunk before analysis. Boxes are mapped back.
MAX_SIDE = 1800
# A pixel of the illumination-normalised page darker than this is ink.
INK_LEVEL = 150
# A bullet stands apart from its text: the blank after the first glyph must be clearly wider than the usual
# gap between the glyphs that follow (SYMBOL_GAP_RATIO times their median) and not tiny (SYMBOL_GAP_MIN of
# the line height). Handwriting sits close: on a real page an x was 15 px from its text, with 9 px between
# letters, while the digits of a date are about as far apart as the rest of the date.
SYMBOL_GAP_RATIO = 1.4
SYMBOL_GAP_MIN = 0.1
# A blank wider than this many line heights ends the line (what follows is a speck, not writing).
FAR_GAP = 4.0


class ImageError(ValueError):
    """The bytes are not an image the service can read."""


@dataclass
class Line:
    y0: int
    y1: int
    x0: int
    x1: int
    symbol: str = NONE
    sym_box: tuple[int, int] | None = None
    features: dict = field(default_factory=dict)


@dataclass
class Page:
    """Everything the detector knows about one image. Arrays are in the (possibly shrunk) analysis size."""

    image: np.ndarray
    scale: float  # analysis pixels per original pixel (1.0 unless the photo was shrunk)
    original_size: tuple[int, int]  # width, height of the image as it came in
    box: tuple[int, int, int, int]  # page crop (left, top, right, bottom) inside `image`
    ink: np.ndarray  # crop-sized, 255 where ink
    lines: list[Line] = field(default_factory=list)


def decode_image(data: bytes) -> np.ndarray:
    """Bytes (jpeg, png, webp) to a BGR array. The EXIF orientation is applied. Raises ImageError."""
    try:
        with Image.open(io.BytesIO(data)) as raw:
            raw.load()
            rotated = ImageOps.exif_transpose(raw)
            rgb = rotated.convert("RGB")
            array = np.asarray(rgb)
    except Exception as error:  # Pillow raises many types for a bad file
        raise ImageError("not a readable image") from error
    return cv2.cvtColor(array, cv2.COLOR_RGB2BGR)


def _shrink(img: np.ndarray) -> tuple[np.ndarray, float]:
    h, w = img.shape[:2]
    longest = max(h, w)
    if longest <= MAX_SIDE:
        return img, 1.0
    scale = MAX_SIDE / longest
    return cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA), scale


def _page_box(gray: np.ndarray) -> tuple[int, int, int, int]:
    """Crop to the page. A book photo has a dark gutter on the left and the cover on the right: the steepest
    darkening of the blurred column mean marks each. Without a clear drop (a flat scan, a screenshot) nothing
    is cut at the sides."""
    h, w = gray.shape
    col = cv2.GaussianBlur(gray.astype(np.float32), (0, 0), 9).mean(axis=0)
    d = np.gradient(col)
    win = max(2, int(0.04 * w))
    min_drop = 25.0
    left, right = 0, w

    lo, hi = int(0.04 * w), int(0.30 * w)
    i = lo + int(np.argmin(d[lo:hi]))
    if col[max(0, i - win // 2)] - col[min(w - 1, i + win)] >= min_drop:
        left = i + int(0.01 * w)

    lo2 = int(0.85 * w)
    j = lo2 + int(np.argmin(d[lo2:]))
    if col[max(0, j - win // 2)] - col[min(w - 1, j + win)] >= min_drop:
        right = j - int(0.02 * w)

    top, bottom = int(0.01 * h), h - int(0.01 * h)
    if right - left < 0.3 * w:
        left, right = 0, w
    return left, top, right, bottom


def _grid_dot_limit(areas: np.ndarray, page_area: int) -> int:
    """Largest component area that still counts as a dot-grid dot or a speck.
    A dot grid is a crowd of tiny components of about one size: at least 30 of them, with a median area far
    below that of a letter (under 0.005 percent of the page). Then twice the 90th percentile separates a grid
    dot from ink, as in the spike. A page without a grid has no such crowd, and only specks are dropped."""
    floor = 12
    if len(areas) < 30:
        return floor
    if float(np.median(areas)) >= 5e-5 * page_area:
        return floor
    return max(floor, int(np.percentile(areas, 90)) * 2)


def preprocess(img: np.ndarray) -> dict:
    """Page crop, illumination normalise, threshold, drop the dot grid. Returns a dict with
    `crop`, `norm`, `ink` (255 where ink) and `box`."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    left, top, right, bottom = _page_box(gray)
    crop = img[top:bottom, left:right]
    gc = gray[top:bottom, left:right]
    background = cv2.medianBlur(gc, 51)
    norm = cv2.divide(gc, background, scale=255)
    bw = (norm < INK_LEVEL).astype(np.uint8) * 255

    count, labels, stats, _ = cv2.connectedComponentsWithStats(bw, connectivity=8)
    h, w = bw.shape
    ink = np.zeros_like(bw)
    if count > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        dotmax = _grid_dot_limit(areas, h * w)
        keep = np.zeros(count, bool)
        keep[1:] = areas > dotmax
        for k in range(1, count):
            x, y, cw, ch = (int(v) for v in stats[k, :4])
            # Components on the crop border are the page edge or a shadow.
            if x <= 2 or y <= 2 or x + cw >= w - 2 or y + ch >= h - 2:
                keep[k] = False
            # A long flat run is a ruled line or a page edge, not handwriting.
            if cw > 8 * ch and cw > 0.3 * w:
                keep[k] = False
        ink = keep[labels].astype(np.uint8) * 255
    return dict(crop=crop, norm=norm, ink=ink, box=(left, top, right, bottom))


def segment_lines(ink: np.ndarray, min_gap: int = 12) -> list[tuple[int, int, int, int]]:
    """Text lines as (y0, y1, x0, x1) in ink coordinates, top to bottom."""
    profile = (ink > 0).sum(axis=1)
    on = profile > 2
    bands: list[list[int]] = []
    y, n = 0, len(on)
    while y < n:
        if on[y]:
            start = y
            while y < n and on[y]:
                y += 1
            bands.append([start, y])
        y += 1
    bands = [b for b in bands if profile[b[0] : b[1]].sum() > 150]  # specks and page-edge crumbs
    merged: list[list[int]] = []
    for band in bands:
        if merged and band[0] - merged[-1][1] < min_gap:
            merged[-1][1] = band[1]
        else:
            merged.append(band)
    out = []
    for start, end in merged:
        if end - start < 15:
            continue
        cols = np.where((ink[start:end] > 0).any(axis=0))[0]
        out.append((start, end, int(cols.min()), int(cols.max())))
    return out


def glyph_groups(ink: np.ndarray, y0: int, y1: int, x0: int, x1: int, gap_ratio: float = 0.35) -> list[tuple[int, int]]:
    """Splits a line into horizontal ink groups. Blank column runs shorter than gap_ratio * line height do not split."""
    band = ink[y0:y1, x0 : x1 + 1] > 0
    columns = band.any(axis=0)
    height = y1 - y0
    groups: list[list[int]] = []
    x = 0
    while x < len(columns):
        if columns[x]:
            start = x
            while x < len(columns) and columns[x]:
                x += 1
            groups.append([start, x])
        else:
            x += 1
    merged: list[list[int]] = []
    for group in groups:
        if merged and group[0] - merged[-1][1] < gap_ratio * height:
            merged[-1][1] = group[1]
        else:
            merged.append(group)
    return [(x0 + a, x0 + b) for a, b in merged]


def classify_symbol(ink: np.ndarray, y0: int, y1: int, a: int, b: int, median_h: float) -> tuple[str, dict]:
    """Class of the glyph in columns a..b of the line y0..y1: one of SYMBOLS, or "none" (text).
    Uses the glyph's size against the median line height, aspect, fill, holes and skeleton endpoints."""
    patch = ink[y0:y1, a:b] > 0
    ys, xs = np.where(patch)
    if len(xs) == 0:
        return NONE, {}
    top, bottom, xa, xb = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    p = patch[top:bottom, xa:xb].astype(np.uint8)
    h, w = p.shape
    fill = float(p.mean())
    aspect = w / max(h, 1)
    rel = max(h, w) / median_h
    contours, hierarchy = cv2.findContours(p * 255, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    # A hole counts only when it is a real opening (a circle's inside), not a pinhole where a stray grid dot
    # touches two arms of an x.
    holes = 0
    if hierarchy is not None:
        min_hole = 0.05 * h * w
        for index, node in enumerate(hierarchy[0]):
            if node[3] >= 0 and cv2.contourArea(contours[index]) >= min_hole:
                holes += 1
    f = dict(h=int(h), w=int(w), fill=round(fill, 2), aspect=round(aspect, 2), rel=round(rel, 2), holes=holes)

    if rel > 0.9 and w > 1.6 * median_h:  # a wide group is a word, not a bullet
        return NONE, f
    if rel < 0.3 and 0.5 < aspect < 2:
        return "•", f
    if rel < 0.45 and fill > 0.65 and 0.7 < aspect < 1.4:  # a larger solid pen dot
        return "•", f
    if aspect > 2.2 and h < 0.3 * median_h:
        return "–", f
    if holes >= 1 and fill < 0.6 and 0.6 < aspect < 1.6:
        return "○", f
    if 0.5 < aspect < 1.8 and fill < 0.5 and holes == 0:
        # Stroke shapes. x has four skeleton ends. > and < have two, told apart by where the tip is.
        sk = skeletonize(cv2.dilate(p, np.ones((3, 3), np.uint8)) > 0).astype(np.uint8)
        neighbours = cv2.filter2D(sk, -1, np.ones((3, 3), np.float32), borderType=cv2.BORDER_CONSTANT) * sk
        ey, ex = np.where(neighbours == 2)  # a skeleton pixel with exactly one neighbour
        f["ends"] = int(len(ex))
        if len(ex) >= 4:
            return "x", f
        if len(ex) in (2, 3):
            sy, sx = np.where(sk > 0)
            ends_x = ex.mean()
            tip_x = sx[np.argmax(np.abs(sx - ends_x))]
            f["ends_x"] = round(float(ends_x) / w, 2)
            f["tip_x"] = round(float(tip_x) / w, 2)
            spread = abs(int(ey.max()) - int(ey.min()))
            if tip_x > ends_x and spread > 0.5 * h:
                return ">", f
            if tip_x < ends_x and spread > 0.5 * h:
                return "<", f
    return NONE, f


def analyse_lines(ink: np.ndarray) -> list[Line]:
    segments = segment_lines(ink)
    if not segments:
        return []
    median_h = float(np.median([e - s for s, e, *_ in segments]))
    lines: list[Line] = []
    for y0, y1, x0, x1 in segments:
        height = y1 - y0
        fine = glyph_groups(ink, y0, y1, x0, x1, gap_ratio=0.0)  # any blank column splits
        # A speck far to the right (page edge, a smudge) is not part of the line: cut the line at the first
        # blank wider than FAR_GAP line heights, so the line box holds only the writing.
        for i in range(len(fine) - 1):
            if fine[i + 1][0] - fine[i][1] > FAR_GAP * height:
                fine = fine[: i + 1]
                x1 = fine[-1][1] - 1
                break
        symbol, features = (NONE, {})
        if fine:
            symbol, features = classify_symbol(ink, y0, y1, fine[0][0], fine[0][1], median_h)
            # A bullet stands apart from the text. A first glyph that sits close to the next one is the first
            # letter or digit of the text (the date line "20.11.2025" starts with a "2" that looks like a chevron).
            gaps = [fine[i + 1][0] - fine[i][1] for i in range(len(fine) - 1)]
            rest = float(np.median(gaps[1:])) if len(gaps) > 1 else 0.0
            if symbol != NONE and gaps and (gaps[0] < SYMBOL_GAP_MIN * height or gaps[0] < SYMBOL_GAP_RATIO * rest):
                features = {**features, "rejected": symbol}
                symbol = NONE
        line = Line(y0=y0, y1=y1, x0=x0, x1=x1, symbol=symbol, features=features)
        if symbol != NONE:
            line.sym_box = fine[0]
        lines.append(line)
    return lines


def analyse(img: np.ndarray) -> Page:
    """Shrinks a very large photo, runs preprocess and line analysis."""
    original = (img.shape[1], img.shape[0])
    small, scale = _shrink(img)
    pre = preprocess(small)
    page = Page(
        image=small,
        scale=scale,
        original_size=original,
        box=pre["box"],
        ink=pre["ink"],
    )
    page.lines = analyse_lines(page.ink)
    return page


def line_bbox(page: Page, line: Line) -> list[int]:
    """[x, y, w, h] of the whole line (symbol and text) in the pixels of the original image, inside it."""
    left, top, _, _ = page.box
    width, height = page.original_size
    x0 = (line.x0 + left) / page.scale
    y0 = (line.y0 + top) / page.scale
    x1 = (line.x1 + 1 + left) / page.scale
    y1 = (line.y1 + top) / page.scale
    x = max(0, min(width - 1, int(x0)))
    y = max(0, min(height - 1, int(y0)))
    w = max(1, min(width - x, int(round(x1)) - x))
    h = max(1, min(height - y, int(round(y1)) - y))
    return [x, y, w, h]
