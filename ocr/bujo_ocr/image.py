"""Decodes an uploaded photo in memory. Nothing is written to disk."""
from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageOps


class ImageError(ValueError):
    """The bytes are not an image the service can read."""


def decode_image(data: bytes) -> np.ndarray:
    """Bytes (jpeg, png, webp) to an RGB array with the EXIF orientation applied. Raises ImageError."""
    try:
        with Image.open(io.BytesIO(data)) as raw:
            raw.load()
            return np.asarray(ImageOps.exif_transpose(raw).convert("RGB"))
    except Exception as error:  # Pillow raises many types for a bad file
        raise ImageError("not a readable image") from error
