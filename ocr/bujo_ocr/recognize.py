"""Line text recognition. TrOCR-small-handwritten first, Tesseract (eng+deu, psm 7) as the fallback.
(llm.py can read the whole page instead, when a gateway is configured; this is the path it falls back to.)

torch and transformers are imported lazily, once, the first time a line is read. Without them (or when the model
cannot load) every line goes to Tesseract. A line also falls back to Tesseract when TrOCR fails or returns nothing.

recognize_lines(crops) -> list[Reading]. Each Reading has text, confidence (0..1) and the engine name.
The images stay in memory: Tesseract gets the crop on stdin and answers on stdout.
"""
from __future__ import annotations

import io
import logging
import os
import subprocess
import threading
from dataclasses import dataclass
from typing import Callable, Protocol

import numpy as np
from PIL import Image

log = logging.getLogger("bujo_ocr")

MODEL_NAME = os.environ.get("OCR_TROCR_MODEL", "microsoft/trocr-small-handwritten")
TESS_LANG = "eng+deu"
TESS_ARGS = ["--psm", "7"]
MAX_NEW_TOKENS = 32


@dataclass
class Reading:
    text: str
    confidence: float
    engine: str


class Recognizer(Protocol):
    def __call__(self, crops: list[np.ndarray]) -> list[Reading]: ...


def _to_pil(crop: np.ndarray) -> Image.Image:
    if crop.ndim == 2:
        return Image.fromarray(crop).convert("RGB")
    return Image.fromarray(crop[:, :, ::-1]).convert("RGB")  # BGR to RGB


class _TrOcr:
    """The model, loaded once on first use. A failed load is remembered, so it is not retried on every line."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loaded = False
        self._failed = False
        self._torch = None
        self._processor = None
        self._model = None

    def available(self) -> bool:
        if self._loaded:
            return True
        if self._failed:
            return False
        with self._lock:
            if self._loaded:
                return True
            if self._failed:
                return False
            try:
                import torch  # noqa: PLC0415 (lazy on purpose)
                from transformers import TrOCRProcessor, VisionEncoderDecoderModel  # noqa: PLC0415

                threads = int(os.environ.get("OCR_THREADS", "0") or 0)
                if threads > 0:
                    torch.set_num_threads(threads)
                self._processor = TrOCRProcessor.from_pretrained(MODEL_NAME)
                self._model = VisionEncoderDecoderModel.from_pretrained(MODEL_NAME).eval()
                self._torch = torch
                self._loaded = True
                log.info("TrOCR loaded: %s", MODEL_NAME)
            except Exception as error:  # ImportError, missing model files, offline hub
                self._failed = True
                log.warning("TrOCR unavailable, using Tesseract: %s", type(error).__name__)
        return self._loaded

    def read(self, crop: np.ndarray) -> Reading:
        torch = self._torch
        pixel_values = self._processor(images=_to_pil(crop), return_tensors="pt").pixel_values
        with torch.no_grad():
            out = self._model.generate(
                pixel_values,
                max_new_tokens=MAX_NEW_TOKENS,
                output_scores=True,
                return_dict_in_generate=True,
            )
        text = self._processor.batch_decode(out.sequences, skip_special_tokens=True)[0].strip()
        return Reading(text=text, confidence=_mean_token_probability(torch, out), engine="trocr")


def _mean_token_probability(torch, out) -> float:
    """Mean probability of the tokens that were picked (the first, forced token is skipped)."""
    try:
        probs = []
        for step, scores in enumerate(out.scores):
            token = out.sequences[0, step + 1]
            probs.append(float(torch.softmax(scores[0], dim=-1)[token]))
        if not probs:
            return 0.0
        return round(sum(probs) / len(probs), 3)
    except Exception:
        return 0.0


_TROCR = _TrOcr()


def trocr_available() -> bool:
    return _TROCR.available()


def tesseract_read(crop: np.ndarray) -> Reading:
    """Tesseract on one line crop. The PNG goes in on stdin and the TSV comes back on stdout, so nothing touches
    the disk (pytesseract always writes a temp file, so it is not used for the call).
    Confidence is the mean word confidence (0..1). Empty text has confidence 0."""
    buffer = io.BytesIO()
    _to_pil(crop).save(buffer, format="PNG")
    result = subprocess.run(
        ["tesseract", "stdin", "stdout", "-l", TESS_LANG, *TESS_ARGS, "tsv"],
        input=buffer.getvalue(),
        capture_output=True,
        timeout=30,
        check=True,
    )
    words, confs = [], []
    for row in result.stdout.decode("utf-8", errors="replace").splitlines()[1:]:
        cells = row.split("\t")
        if len(cells) < 12 or cells[0] != "5":
            continue
        word = cells[11].strip()
        if not word:
            continue
        words.append(word)
        try:
            value = float(cells[10])
        except ValueError:
            continue
        if value >= 0:
            confs.append(value / 100.0)
    confidence = round(sum(confs) / len(confs), 3) if confs else 0.0
    return Reading(text=" ".join(words), confidence=confidence, engine="tesseract")


def recognize_line(
    crop: np.ndarray,
    trocr: Callable[[np.ndarray], Reading] | None = None,
    tesseract: Callable[[np.ndarray], Reading] | None = None,
) -> Reading:
    """TrOCR when it is installed and works. Tesseract when it is not, when it fails, or when it reads nothing.
    If Tesseract is missing too the line comes back empty with confidence 0."""
    tesseract = tesseract or tesseract_read
    if trocr is None and _TROCR.available():
        trocr = _TROCR.read
    if trocr is not None:
        try:
            reading = trocr(crop)
            if reading.text.strip():
                return reading
        except Exception as error:
            log.warning("TrOCR failed on a line, trying Tesseract: %s", type(error).__name__)
    try:
        return tesseract(crop)
    except Exception as error:  # tesseract binary missing or crashed
        log.warning("Tesseract failed: %s", type(error).__name__)
        return Reading(text="", confidence=0.0, engine="none")


def recognize_lines(crops: list[np.ndarray]) -> list[Reading]:
    return [recognize_line(crop) for crop in crops]
