"""Detector tests on synthetic pages. No model, no torch, no real photo."""
import sys

import cv2
import numpy as np
import pytest

from bujo_ocr import detector
from fixtures import DEFAULT_LINES, make_page, noisy_blank, to_jpeg, to_webp

SYMBOLS = ["•", "x", ">", "<", "○", "–"]

VARIANTS = {
    "white": dict(),
    "cream_grid": dict(cream=True, grid=True),
    "cream_grid_noise_rotated": dict(cream=True, grid=True, noise=4, rotate=1.5),
    "white_grid_rotated_noisier": dict(grid=True, rotate=2, noise=6),
}


def analyse(png: bytes) -> detector.Page:
    return detector.analyse(detector.decode_image(png))


@pytest.mark.parametrize("name", VARIANTS)
def test_every_symbol_class_is_detected_in_order(name):
    fixture = make_page(**VARIANTS[name])
    page = analyse(fixture.png)
    assert [line.symbol for line in page.lines] == [e.symbol for e in fixture.expected]


@pytest.mark.parametrize("symbol", SYMBOLS)
def test_each_symbol_alone_on_a_page(symbol):
    fixture = make_page([(symbol, "Eine Aufgabe")] * 3, grid=True)
    page = analyse(fixture.png)
    assert [line.symbol for line in page.lines] == [symbol] * 3


def test_the_date_line_has_no_symbol():
    page = analyse(make_page().png)
    assert page.lines[0].symbol == "none"
    assert all(line.symbol != "none" for line in page.lines[1:])


def test_line_count_and_vertical_order():
    fixture = make_page(cream=True, grid=True, rotate=1.5)
    page = analyse(fixture.png)
    assert len(page.lines) == len(DEFAULT_LINES)
    tops = [line.y0 for line in page.lines]
    assert tops == sorted(tops)
    # Every detected line sits on the row it was drawn on.
    box_top = page.box[1]
    for line, expected in zip(page.lines, fixture.expected):
        assert line.y0 + box_top - 20 <= expected.y_center <= line.y1 + box_top + 20


def test_bboxes_are_inside_the_image_and_tight():
    fixture = make_page(cream=True, grid=True, rotate=1.5, noise=4)
    page = analyse(fixture.png)
    for line in page.lines:
        x, y, w, h = detector.line_bbox(page, line)
        assert x >= 0 and y >= 0 and w > 0 and h > 0
        assert x + w <= fixture.width
        assert y + h <= fixture.height
        assert h < 80  # one line, not the page


def test_a_dot_grid_does_not_create_lines():
    page = analyse(noisy_blank())
    assert page.lines == []
    with_grid = analyse(make_page(grid=True).png)
    without = analyse(make_page(grid=False).png)
    assert len(with_grid.lines) == len(without.lines)


def test_an_empty_page_has_no_lines():
    page = analyse(make_page([]).png)
    assert page.lines == []


def test_text_crop_excludes_the_symbol_and_is_a_clean_image():
    page = analyse(make_page(grid=True).png)
    for line in page.lines:
        crop = detector.crop_text_region(page, line)
        assert crop.ndim == 2 and crop.dtype == np.uint8
        assert crop.shape[0] > 10 and crop.shape[1] > 10
        assert set(np.unique(crop)) <= {0, 255}
        assert (crop == 0).any()
    with_symbol = page.lines[1]
    assert with_symbol.text_x > with_symbol.sym_box[1] - 1


def test_jpeg_and_webp_are_read_like_png():
    fixture = make_page(cream=True, grid=True)
    for data in (to_jpeg(fixture.png), to_webp(fixture.png)):
        page = analyse(data)
        assert [line.symbol for line in page.lines] == [e.symbol for e in fixture.expected]


def test_a_big_photo_is_shrunk_and_bboxes_map_back_to_the_original():
    fixture = make_page(width=900)
    big = detector.decode_image(fixture.png)
    big = cv2.resize(big, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    page = detector.analyse(big)
    assert page.scale < 1
    assert [line.symbol for line in page.lines] == [e.symbol for e in fixture.expected]
    height, width = big.shape[:2]
    for line in page.lines:
        x, y, w, h = detector.line_bbox(page, line)
        assert x + w <= width and y + h <= height


def test_garbage_is_an_image_error():
    with pytest.raises(detector.ImageError):
        detector.decode_image(b"this is not an image")


def test_detector_imports_without_torch():
    assert "torch" not in sys.modules
    assert "transformers" not in sys.modules


@pytest.mark.parametrize("want", SYMBOLS)
def test_spike_drawn_shapes_are_classified(want):
    """The spike's sanity test: each shape drawn alone on a 60 px canvas."""
    c = np.zeros((60, 60), np.uint8)
    if want == ">":
        cv2.line(c, (15, 12), (42, 30), 255, 4)
        cv2.line(c, (42, 30), (15, 48), 255, 4)
    elif want == "<":
        cv2.line(c, (45, 12), (18, 30), 255, 4)
        cv2.line(c, (18, 30), (45, 48), 255, 4)
    elif want == "x":
        cv2.line(c, (14, 12), (46, 48), 255, 4)
        cv2.line(c, (46, 12), (14, 48), 255, 4)
    elif want == "○":
        cv2.circle(c, (30, 30), 12, 255, 3)
    elif want == "•":
        cv2.circle(c, (30, 40), 4, 255, -1)
    else:
        cv2.line(c, (18, 40), (42, 40), 255, 4)
    got, _ = detector.classify_symbol(c, 0, 60, 0, 60, 45.0)
    assert got == want


@pytest.mark.parametrize("symbol", ["x", "•", "○", "–", ">", "<"])
def test_a_symbol_written_close_to_its_text_is_still_a_symbol(symbol):
    # Handwriting puts the bullet close to the text: on a real page an x sat a third of a line height away.
    fx = make_page([("none", "20.11.2025"), (symbol, "Task zwei")], text_gap=12, grid=True)
    page = detector.analyse(detector.decode_image(fx.png))
    assert [line.symbol for line in page.lines] == ["none", symbol]


def test_a_speck_far_right_of_a_line_is_not_part_of_it():
    from PIL import Image, ImageDraw
    import io
    fx = make_page([("•", "Task eins")], width=1400)
    img = Image.open(io.BytesIO(fx.png)).convert("RGB")
    ImageDraw.Draw(img).ellipse([1300, fx.expected[0].y_center - 6, 1312, fx.expected[0].y_center + 6], fill=(20, 20, 30))
    buf = io.BytesIO(); img.save(buf, format="PNG")
    page = detector.analyse(detector.decode_image(buf.getvalue()))
    assert len(page.lines) == 1
    x, y, w, h = detector.line_bbox(page, page.lines[0])
    assert x + w < 1000
