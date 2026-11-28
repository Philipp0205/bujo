"""Whole-page reading with a vision LLM behind an OpenAI-compatible gateway (for example a LiteLLM proxy).

This is the only reader. It needs OCR_LLM_BASE and OCR_LLM_KEY; without them every read fails as "not configured".
Env is read at call time:
  OCR_LLM_BASE     gateway root, for example https://gateway.example/v1 (a trailing slash is fine)
  OCR_LLM_KEY      bearer key for the gateway
  OCR_LLM_MODEL    model name (default claude-haiku-5-5)
  OCR_LLM_TIMEOUT  seconds to wait per gateway request (default 25: the app gives the whole scan 60 s)

Each line carries symbol, text, tags, time, confidence and indent (0, or 1 for a child of the line above).
The page also carries page_number: the notebook page number (integer 1..9999) or null. It is never a line.
read_page(image_rgb) -> LlmPage. Every problem is an LlmError with a short category; the server turns it into an error answer.
The page photo is shrunk and encoded in memory, sent to the gateway only, and never written or logged.
Standard library plus Pillow and numpy.
"""
from __future__ import annotations

import base64
import http.client
import io
import json
import logging
import math
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass

import numpy as np
from PIL import Image

log = logging.getLogger("bujo_ocr")

DEFAULT_MODEL = "claude-haiku-5-5"
DEFAULT_TIMEOUT = 25.0
MAX_SIDE = 2000
JPEG_QUALITY = 90
MAX_TOKENS = 4096

SYMBOLS = ("•", "x", ">", "<", "○", "–", "~", "none")
_SYMBOL_ALIASES = {
    "∼": "~", "˜": "~",
    "*": "•", "·": "•", "●": "•",
    "-": "–", "—": "–",
    "o": "○", "O": "○", "◯": "○", "°": "○",
    "X": "x", "×": "x",
}

KINDS = ("daily", "future", "calendar", "month-task")

SYSTEM_PROMPT = (
    "You read a photo of one handwritten bullet-journal log page, written in German and English. "
    "For each written line, in reading order, return: symbol, the bullet at the start of the line, one of "
    "• (task), x (done task), > (migrated), < (scheduled), ○ (event), – (note), ~ (dropped: a task struck through with a line, or a ~ bullet; an x is done, never dropped), "
    "or none when the line has no bullet; "
    "text, exactly as written without the bullet, keeping umlauts, ß, #tags and times; "
    "tags, the #tags in the line without the #; "
    "time, a time written in the line as HH:MM, or null; "
    "confidence, how sure you are of the line, 0 to 1; "
    "indent, 1 when the line is visibly indented to the right of the line above it, as a child of that line "
    "(typically notes under a meeting or task), else 0. Never 1 on the first line, a date, a heading or a day row of "
    "a calendar page. Indent one level only: deeper writing is still 1. "
    "Do not correct spelling. Do not invent lines. "
    "Also name the kind of page: daily (one day, headed by a date), future (a future log: several months, each with a "
    "short list under it, maybe headed by a year or Future log), calendar (one month as a column of day numbers with "
    "weekday letters and short text after some days) or month-task (one month, a plain task list). "
    "Return period as the year (YYYY) of a future page or the month (YYYY-MM) of a calendar or month-task page when the "
    "page says it, else null. "
    "If the first line is a date, return it as a line with symbol none and also put it in date as written. "
    "On a future, calendar or month-task page, return each month heading as a line with symbol none, for example "
    "Januar, and the year or Future log heading too. "
    "On a calendar page, return each written day as one line with symbol none and text starting with the day number, "
    "for example 15 Fr Zahnarzt, keep the weekday letters, and leave out days with nothing written. "
    "On a future page keep a day number at the start of an item as part of its text. "
    "Return page_number as the notebook page number printed or handwritten as the page's own number (a lone number in a "
    'corner, often with a dash or dot around it, for example "- 12 -"), as an integer, else null. It is not a line of '
    "the page: never return it as a line. A number that is part of a line (a time, a date, a price, 3 books) is not a "
    "page number. "
    'Answer with JSON only, matching the schema: {"date": string or null, "kind": string, "period": string or null, '
    '"page_number": integer or null, "lines": [{"symbol", "text", "tags", "time", "confidence", "indent"}]}.'
)
USER_INSTRUCTION = "Read this log page and answer with the JSON."

PAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "date": {"type": ["string", "null"]},
        "kind": {"type": ["string", "null"], "enum": [*KINDS, None]},
        "period": {"type": ["string", "null"]},
        "page_number": {"type": ["integer", "null"]},
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "enum": list(SYMBOLS)},
                    "text": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "time": {"type": ["string", "null"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "indent": {"type": "integer", "enum": [0, 1]},
                },
                "required": ["symbol", "text", "tags", "time", "confidence", "indent"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["date", "kind", "period", "page_number", "lines"],
    "additionalProperties": False,
}
RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {"name": "rapid_log_page", "strict": True, "schema": PAGE_SCHEMA},
}


class LlmError(Exception):
    """The LLM path did not give a usable page. `category` is a short reason that is safe to log."""

    def __init__(self, category: str) -> None:
        super().__init__(category)
        self.category = category


class _FormatRejected(LlmError):
    """The gateway answered 400 and blames response_format or json_schema."""


@dataclass
class LlmLine:
    symbol: str
    text: str
    tags: list[str]
    time: str | None
    confidence: float
    indent: int = 0


@dataclass
class LlmPage:
    date: str | None
    lines: list[LlmLine]
    model: str
    kind: str | None = None
    period: str | None = None
    page_number: int | None = None


@dataclass
class Settings:
    base: str
    key: str
    model: str
    timeout: float


def _env_settings() -> Settings:
    """Reads the OCR_LLM_* env now, so tests and operators can change it without a restart."""
    try:
        timeout = float(os.environ.get("OCR_LLM_TIMEOUT") or DEFAULT_TIMEOUT)
    except ValueError:
        timeout = DEFAULT_TIMEOUT
    if not math.isfinite(timeout) or timeout <= 0:
        timeout = DEFAULT_TIMEOUT
    return Settings(
        base=(os.environ.get("OCR_LLM_BASE") or "").strip().rstrip("/"),
        key=(os.environ.get("OCR_LLM_KEY") or "").strip(),
        model=(os.environ.get("OCR_LLM_MODEL") or "").strip() or DEFAULT_MODEL,
        timeout=timeout,
    )


def configured() -> bool:
    """True when the gateway base and key are both set, which is what turns the LLM path on."""
    settings = _env_settings()
    return bool(settings.base and settings.key)


def encode_image(image_rgb: np.ndarray) -> str:
    """The page as a data URL: long side at most 2000 px, JPEG quality 90, built in memory only."""
    picture = Image.fromarray(np.ascontiguousarray(image_rgb)).convert("RGB")
    picture.thumbnail((MAX_SIDE, MAX_SIDE))
    buffer = io.BytesIO()
    picture.save(buffer, format="JPEG", quality=JPEG_QUALITY)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def build_body(model: str, data_url: str, *, with_format: bool = True) -> dict:
    """The chat completions request body: system prompt, then the page image with a short instruction."""
    body: dict = {
        "model": model,
        "temperature": 0,
        "max_tokens": MAX_TOKENS,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": USER_INSTRUCTION},
                ],
            },
        ],
    }
    if with_format:
        body["response_format"] = RESPONSE_FORMAT
    return body


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    """A redirect is an error: the bearer key and the page photo must only go to the configured gateway."""

    def redirect_request(self, *args, **kwargs):
        return None


def _mentions_format(error: urllib.error.HTTPError) -> bool:
    try:
        text = error.read(65536).decode("utf-8", "replace").lower()
    except Exception:
        return False
    return "response_format" in text or "json_schema" in text


def _post(settings: Settings, body: dict, opener) -> dict:
    """One POST to {base}/chat/completions. Returns the decoded JSON answer or raises LlmError."""
    request = urllib.request.Request(
        settings.base + "/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {settings.key}", "content-type": "application/json"},
    )
    try:
        with opener.open(request, timeout=settings.timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        if error.code == 400 and _mentions_format(error):
            raise _FormatRejected("http 400 response_format") from None
        raise LlmError(f"http {error.code}") from None
    except TimeoutError:
        raise LlmError("timeout") from None
    except urllib.error.URLError as error:
        raise LlmError("timeout" if isinstance(error.reason, TimeoutError) else "network") from None
    except (OSError, http.client.HTTPException):
        raise LlmError("network") from None
    except ValueError:  # the gateway answered something that is not JSON
        raise LlmError("invalid json") from None


_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL | re.IGNORECASE)
_TIME = re.compile(r"^(\d{1,2}):(\d{2})$")


def _answer_text(answer: dict) -> str:
    """choices[0].message.content of a chat completions answer, which must be a string."""
    try:
        content = answer["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise LlmError("invalid shape") from None
    if not isinstance(content, str):
        raise LlmError("invalid shape")
    return content


def _load_json(content: str) -> dict:
    """Parses the model text as JSON, tolerating a surrounding ``` or ```json fence."""
    fenced = _FENCE.match(content)
    try:
        data = json.loads(fenced.group(1) if fenced else content)
    except ValueError:
        raise LlmError("invalid json") from None
    if not isinstance(data, dict) or not isinstance(data.get("lines"), list):
        raise LlmError("invalid shape")
    return data


def _symbol(value) -> str:
    if not isinstance(value, str):
        return "none"
    value = value.strip()
    if value in SYMBOLS:
        return value
    return _SYMBOL_ALIASES.get(value, "none")


def _tags(value) -> list[str]:
    if not isinstance(value, list):
        return []
    tags = [item.strip().lstrip("#").strip() for item in value if isinstance(item, str)]
    return [tag for tag in tags if tag]


def _time(value) -> str | None:
    match = _TIME.match(value.strip()) if isinstance(value, str) else None
    if not match or int(match.group(1)) > 23 or int(match.group(2)) > 59:
        return None
    return f"{int(match.group(1)):02d}:{match.group(2)}"


def _confidence(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return 0.5
    return min(1.0, max(0.0, float(value)))


def _indent(value) -> int:
    """0 or 1: a missing, odd, negative or boolean value is 0, anything above 1 is 1 (one level only)."""
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return 1 if value >= 1 else 0


def _line(item) -> LlmLine | None:
    """One answer line, cleaned up. None when it is unusable (not an object, text not a string, or empty)."""
    if not isinstance(item, dict) or not isinstance(item.get("text"), str):
        return None
    symbol, text = _symbol(item.get("symbol")), item["text"].strip()
    if not text and symbol == "none":
        return None
    return LlmLine(
        symbol, text, _tags(item.get("tags")), _time(item.get("time")), _confidence(item.get("confidence")),
        _indent(item.get("indent")),
    )


_PERIOD = re.compile(r"^\d{4}(-(0[1-9]|1[0-2]))?$")


def _kind(value) -> str | None:
    """The page kind when it is one of the four, else None (an unknown word is not an error: the app decides)."""
    return value.strip().lower() if isinstance(value, str) and value.strip().lower() in KINDS else None


def _period(value) -> str | None:
    """A year (YYYY) or a month (YYYY-MM), else None."""
    return value.strip() if isinstance(value, str) and _PERIOD.match(value.strip()) else None


_DIGITS = re.compile(r"^\d{1,4}$")


def _page_number(value) -> int | None:
    """The notebook page number 1..9999. Missing, null, a bool, a float, 0, a negative, too big or text is None;
    a digit string like "12" is 12."""
    if isinstance(value, str) and _DIGITS.match(value.strip()):
        value = int(value.strip())
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if 1 <= value <= 9999 else None


def parse_page(content: str, model: str) -> LlmPage:
    """The model text to an LlmPage. Raises LlmError for bad JSON, a bad shape or no usable line.
    A page kind, period or page_number that is not valid becomes None."""
    data = _load_json(content)
    lines = [line for line in map(_line, data["lines"]) if line]
    if not lines:
        raise LlmError("no lines")
    date = data.get("date")
    date = date.strip() if isinstance(date, str) and date.strip() else None
    return LlmPage(
        date=date, lines=lines, model=model, kind=_kind(data.get("kind")), period=_period(data.get("period")),
        page_number=_page_number(data.get("page_number")),
    )


def _ask(settings: Settings, image_rgb: np.ndarray, opener) -> LlmPage:
    """Sends the page and parses the answer. Retries the request once, and only once, when the answer is invalid
    JSON (same body) or the gateway rejects response_format (body without it). Other failures are not retried."""
    data_url = encode_image(image_rgb)
    try:
        return _request(settings, build_body(settings.model, data_url), opener)
    except LlmError as error:
        if isinstance(error, _FormatRejected):
            retry = build_body(settings.model, data_url, with_format=False)
        elif error.category == "invalid json":
            retry = build_body(settings.model, data_url)
        else:
            raise
        log.info("llm retry: %s (model %s)", error.category, settings.model)
        return _request(settings, retry, opener)


def _request(settings: Settings, body: dict, opener) -> LlmPage:
    """One POST and the parse of its answer."""
    return parse_page(_answer_text(_post(settings, body, opener)), settings.model)


def read_page(image_rgb: np.ndarray, *, opener=None) -> LlmPage:
    """Reads a whole page photo with the vision LLM. Raises LlmError, after one warning with the reason and model."""
    settings = _env_settings()
    try:
        if not (settings.base and settings.key):
            raise LlmError("not configured")
        return _ask(settings, image_rgb, opener or urllib.request.build_opener(_NoRedirects))
    except LlmError as error:
        log.warning("llm read failed: %s (model %s)", error.category, settings.model)
        raise
