"""Detector tests on synthetic pages. No model, no real photo."""

import cv2
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
