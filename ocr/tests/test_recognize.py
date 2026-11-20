"""Recognizer routing tests. TrOCR and Tesseract are stubbed: no torch, no model, no tesseract binary needed."""
import shutil
import sys

import numpy as np
import pytest

from bujo_ocr import recognize
from bujo_ocr.recognize import Reading, recognize_line
from fixtures import make_page

CROP = np.full((40, 120), 255, np.uint8)


def trocr_ok(crop):
    return Reading("Task 1", 0.8, "trocr")


def tess(crop):
    return Reading("Tush", 0.5, "tesseract")


def test_trocr_wins_when_it_reads_something():
    assert recognize_line(CROP, trocr=trocr_ok, tesseract=tess).engine == "trocr"


def test_empty_trocr_falls_back_to_tesseract():
    result = recognize_line(CROP, trocr=lambda c: Reading("  ", 0.1, "trocr"), tesseract=tess)
    assert (result.engine, result.text) == ("tesseract", "Tush")


def test_failing_trocr_falls_back_to_tesseract():
    def boom(crop):
        raise RuntimeError("model broke")

    assert recognize_line(CROP, trocr=boom, tesseract=tess).engine == "tesseract"


def test_missing_trocr_install_uses_tesseract(monkeypatch):
    monkeypatch.setattr(recognize._TROCR, "available", lambda: False)
    assert recognize_line(CROP, tesseract=tess).engine == "tesseract"


def test_a_failing_tesseract_gives_an_empty_line_not_an_error():
    def boom(crop):
        raise FileNotFoundError("tesseract")

    # With TrOCR unavailable and Tesseract broken the line is empty with confidence 0.
    recognize._TROCR._failed = True
    try:
        result = recognize_line(CROP, tesseract=boom)
    finally:
        recognize._TROCR._failed = False
    assert (result.text, result.confidence, result.engine) == ("", 0.0, "none")


def test_importing_the_recognizer_does_not_import_torch():
    assert "torch" not in sys.modules
    assert "transformers" not in sys.modules


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract is not installed")
def test_real_tesseract_reads_a_printed_line_with_umlauts():
    from bujo_ocr import detector

    page = detector.analyse(detector.decode_image(make_page([("•", "Müller anrufen")], font_size=40).png))
    crop = detector.crop_text_region(page, page.lines[0])
    reading = recognize.tesseract_read(crop)
    assert reading.engine == "tesseract"
    assert "anrufen" in reading.text.lower()
    assert 0 < reading.confidence <= 1
