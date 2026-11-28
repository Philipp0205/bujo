"""Image decoding tests on synthetic pages."""
import io
import sys

import pytest
from PIL import Image

from bujo_ocr import image as imaging
from fixtures import make_page, to_jpeg, to_webp


def test_decode_gives_an_rgb_array():
    fixture = make_page()
    array = imaging.decode_image(fixture.png)
    assert array.shape == (fixture.height, fixture.width, 3)
    assert tuple(array[0, 0]) == (255, 255, 255)


def test_channels_are_rgb_not_bgr():
    red = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 10, 10)).save(red, format="PNG")
    assert tuple(imaging.decode_image(red.getvalue())[0, 0]) == (200, 10, 10)


@pytest.mark.parametrize("encode", [to_jpeg, to_webp])
def test_jpeg_and_webp_are_read(encode):
    fixture = make_page()
    assert imaging.decode_image(encode(fixture.png)).shape[:2] == (fixture.height, fixture.width)


def test_the_exif_orientation_is_applied():
    source = Image.new("RGB", (40, 20), (255, 255, 255))
    exif = Image.Exif()
    exif[0x0112] = 6  # rotated 90 degrees: the stored 40x20 shows as 20x40
    out = io.BytesIO()
    source.save(out, format="JPEG", exif=exif)
    assert imaging.decode_image(out.getvalue()).shape[:2] == (40, 20)


def test_garbage_is_an_image_error():
    with pytest.raises(imaging.ImageError):
        imaging.decode_image(b"this is not an image")


def test_the_service_needs_no_vision_or_model_libraries():
    import bujo_ocr.server  # noqa: F401

    for name in ("cv2", "torch", "transformers", "skimage", "pytesseract"):
        assert name not in sys.modules
