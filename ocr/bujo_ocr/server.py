"""Small HTTP service on the standard library.

  GET  /healthz  -> {"ok": true}
  POST /ocr      raw image body (image/jpeg, image/png, image/webp), up to 15 MB
                  -> {"lines": [{symbol, text, confidence, bbox:[x,y,w,h], engine, tags, time}], "date", "width", "height", "ms"}

The image is decoded from memory and dropped after the answer. Nothing is written to disk.
With OCR_LLM_BASE and OCR_LLM_KEY set, a vision LLM reads the whole page first (see llm.py, engine "llm:<model>").
Any problem there falls back to the detector and recognizer, where tags are [] and time and date are null.
Env: OCR_HOST (default 0.0.0.0; "::" listens on IPv6 and IPv4), OCR_PORT (default 8090).
"""
from __future__ import annotations

import json
import logging
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

import numpy as np

from . import detector, llm
from .recognize import Reading, recognize_lines

log = logging.getLogger("bujo_ocr")

MAX_BYTES = 15 * 1024 * 1024
ALLOWED_TYPES = ("image/jpeg", "image/png", "image/webp")

Recognize = Callable[[list[np.ndarray]], list[Reading]]
ReadPage = Callable[[np.ndarray], llm.LlmPage]

_WORK = threading.Lock()
NO_BBOX = [0, 0, 0, 0]


def _local_answer(image: np.ndarray, recognize: Recognize) -> dict:
    """The detector plus recognizer path: one line per detected line, with empty tags and no time."""
    page = detector.analyse(image)
    crops = [detector.crop_text_region(page, line) for line in page.lines]
    readings = recognize(crops) if crops else []
    lines = []
    for line, reading in zip(page.lines, readings):
        lines.append(
            {
                "symbol": line.symbol,
                "text": reading.text,
                "confidence": round(float(reading.confidence), 3),
                "bbox": detector.line_bbox(page, line),
                "engine": reading.engine,
                "tags": [],
                "time": None,
            }
        )
    return {"lines": lines, "date": None}


def _llm_boxes(image: np.ndarray, count: int) -> list[list[int]]:
    """Line boxes from the detector (no model) when it finds as many lines as the LLM did, else empty boxes."""
    try:
        page = detector.analyse(image)
    except Exception:
        return [NO_BBOX] * count
    if len(page.lines) != count:
        return [NO_BBOX] * count
    return [detector.line_bbox(page, line) for line in page.lines]


def _with_date_line(result: llm.LlmPage) -> list[llm.LlmLine]:
    """The LLM lines with the page date as a leading bullet-less line when the model put it only in `date`.
    The app finds the page date in such a line, and the detector counts it as a line too."""
    if not result.date or any(line.symbol == "none" and line.text == result.date for line in result.lines):
        return result.lines
    return [llm.LlmLine("none", result.date, [], None, 1.0), *result.lines]


def _llm_answer(image: np.ndarray, read_page: ReadPage) -> dict:
    """The whole-page LLM path, shaped like the local answer."""
    result = read_page(image)
    page_lines = _with_date_line(result)
    boxes = _llm_boxes(image, len(page_lines))
    engine = f"llm:{result.model}"
    lines = [
        {
            "symbol": line.symbol,
            "text": line.text,
            "confidence": round(float(line.confidence), 3),
            "bbox": box,
            "engine": engine,
            "tags": line.tags,
            "time": line.time,
        }
        for line, box in zip(page_lines, boxes)
    ]
    return {"lines": lines, "date": result.date}


def _try_llm(image: np.ndarray, read_page: ReadPage | None) -> dict | None:
    """The LLM answer, or None when it is not configured or anything goes wrong (the caller then falls back)."""
    if read_page is None:
        if not llm.configured():
            return None
        read_page = llm.read_page
    try:
        return _llm_answer(image, read_page)
    except llm.LlmError:  # already logged by the reader
        return None
    except Exception as error:
        log.warning("llm path failed: %s", type(error).__name__)
        return None


def run_ocr(data: bytes, recognize: Recognize = recognize_lines, read_page: ReadPage | None = None) -> dict:
    """Image bytes in, the JSON-ready result out. Raises detector.ImageError for bytes that are not an image.

    With the LLM configured (or `read_page` given) the whole page goes to it first. Any problem there falls back
    to the detector and recognizer."""
    started = time.perf_counter()
    image = detector.decode_image(data)
    height, width = image.shape[:2]
    answer = _try_llm(image, read_page) or _local_answer(image, recognize)
    return {**answer, "width": width, "height": height, "ms": round((time.perf_counter() - started) * 1000)}


def make_handler(
    recognize: Recognize = recognize_lines, read_page: ReadPage | None = None
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "bujo-ocr"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args) -> None:  # one quiet line per request, never the body
            log.info("%s %s", self.command, self.path.split("?")[0])

        def _send(self, status: int, body: dict, close: bool = False) -> None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(payload)))
            self.send_header("cache-control", "no-store")
            if close:
                self.send_header("connection", "close")
                self.close_connection = True
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self) -> None:
            if self.path.split("?")[0] == "/healthz":
                self._send(200, {"ok": True})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:
            if self.path.split("?")[0] != "/ocr":
                self._send(404, {"error": "not found"}, close=True)
                return
            content_type = (self.headers.get("content-type") or "").split(";")[0].strip().lower()
            if content_type not in ALLOWED_TYPES:
                self._send(415, {"error": "content-type must be image/jpeg, image/png or image/webp"}, close=True)
                return
            raw_length = self.headers.get("content-length")
            if raw_length is None or not raw_length.isdigit():
                self._send(411, {"error": "content-length is required"}, close=True)
                return
            length = int(raw_length)
            if length > MAX_BYTES:
                # The body is not read. The connection is closed after the answer.
                self._send(413, {"error": "image too large (at most 15 MB)"}, close=True)
                return
            if length == 0:
                self._send(400, {"error": "empty body"}, close=True)
                return
            data = self.rfile.read(length)
            if len(data) != length:
                self._send(400, {"error": "incomplete body"}, close=True)
                return
            try:
                with _WORK:  # one page at a time: a CPU-only box gains nothing from two
                    result = run_ocr(data, recognize, read_page)
            except detector.ImageError:
                self._send(400, {"error": "not a readable image"})
                return
            except Exception:
                log.exception("ocr failed")
                self._send(500, {"error": "ocr failed"})
                return
            finally:
                del data
            self._send(200, result)

    return Handler


class _DualStackServer(ThreadingHTTPServer):
    """IPv6 listener that also takes IPv4 (for "::", which Railway private networking needs)."""

    address_family = socket.AF_INET6

    def server_bind(self) -> None:
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def make_server(
    host: str, port: int, recognize: Recognize = recognize_lines, read_page: ReadPage | None = None
) -> ThreadingHTTPServer:
    server_class = _DualStackServer if ":" in host else ThreadingHTTPServer
    server = server_class((host, port), make_handler(recognize, read_page))
    server.daemon_threads = True
    return server


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    host = os.environ.get("OCR_HOST", "0.0.0.0")
    port = int(os.environ.get("OCR_PORT", "8090"))
    server = make_server(host, port)
    log.info("bujo-ocr listening on %s:%s", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
