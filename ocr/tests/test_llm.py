"""LLM reader tests. A fake OpenAI-compatible gateway runs on 127.0.0.1; no real network, key or photo is used."""
import base64
import http.client
import io
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from PIL import Image

from bujo_ocr import detector, llm, server
from bujo_ocr.recognize import Reading
from fixtures import CALENDAR_LINES, FUTURE_LINES, MONTH_TASK_LINES, make_page

PAGE_ANSWER = {
    "date": "20.11.2025",
    "lines": [
        {"symbol": "none", "text": "20.11.2025", "tags": [], "time": None, "confidence": 0.95},
        {"symbol": "•", "text": "Müller anrufen #arbeit 9:30", "tags": ["arbeit"], "time": "09:30", "confidence": 0.9},
        {"symbol": "x", "text": "Straße fegen", "tags": [], "time": None, "confidence": 0.8},
    ],
}


def completion(content) -> str:
    return json.dumps({"choices": [{"message": {"role": "assistant", "content": content}}]})


def ok(answer=PAGE_ANSWER, fence: str = "") -> tuple:
    text = json.dumps(answer, ensure_ascii=False)
    return 200, completion(f"{fence}{text}{'```' if fence else ''}"), 0


class Gateway:
    """Records every request and answers from a list of (status, body, delay seconds); the last entry repeats."""

    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.answers: list[tuple] = [ok()]
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args) -> None:
                pass

            def do_POST(self) -> None:
                raw = self.rfile.read(int(self.headers["content-length"]))
                outer.requests.append(
                    {"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": json.loads(raw)}
                )
                status, body, delay = outer.answers[min(len(outer.requests), len(outer.answers)) - 1]
                time.sleep(delay)
                payload = body.encode("utf-8")
                try:
                    self.send_response(status)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                except OSError:  # the client gave up (timeout test)
                    pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_address[1]}/v1"

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)


@pytest.fixture()
def gateway(monkeypatch):
    fake = Gateway()
    monkeypatch.setenv("OCR_LLM_BASE", fake.base + "/")  # a trailing slash is tolerated
    monkeypatch.setenv("OCR_LLM_KEY", "test-key")
    yield fake
    fake.close()


def fake_recognizer(crops):
    return [Reading(text=f"zeile {i + 1}", confidence=0.9, engine="fake") for i, _ in enumerate(crops)]


def page_image(**options):
    fixture = make_page(**options)
    return fixture, detector.decode_image(fixture.png)


# request shape


def test_request_shape(gateway):
    _, image = page_image()
    page = llm.read_page(image)
    assert page.model == "claude-haiku-5-5"
    request = gateway.requests[0]
    assert request["path"] == "/v1/chat/completions"
    assert request["headers"]["authorization"] == "Bearer test-key"
    assert request["headers"]["content-type"] == "application/json"
    body = request["body"]
    assert body["model"] == "claude-haiku-5-5"
    assert body["temperature"] == 0
    assert body["max_tokens"] == 4096
    assert body["messages"][0] == {"role": "system", "content": llm.SYSTEM_PROMPT}
    user = body["messages"][1]["content"]
    assert [part["type"] for part in user] == ["image_url", "text"]
    fmt = body["response_format"]
    assert fmt["type"] == "json_schema"
    assert fmt["json_schema"]["name"] == "rapid_log_page" and fmt["json_schema"]["strict"] is True
    assert fmt["json_schema"]["schema"]["additionalProperties"] is False


def test_model_override(gateway, monkeypatch):
    monkeypatch.setenv("OCR_LLM_MODEL", "other-model")
    _, image = page_image()
    assert llm.read_page(image).model == "other-model"
    assert gateway.requests[0]["body"]["model"] == "other-model"


def test_image_is_a_jpeg_data_url_with_long_side_at_most_2000(gateway):
    _, image = page_image(width=3000)  # wider than 2000 px, so it must be shrunk
    assert max(image.shape[:2]) > 2000
    llm.read_page(image)
    url = gateway.requests[0]["body"]["messages"][1]["content"][0]["image_url"]["url"]
    prefix = "data:image/jpeg;base64,"
    assert url.startswith(prefix)
    sent = Image.open(io.BytesIO(base64.b64decode(url[len(prefix):])))
    assert sent.format == "JPEG"
    assert max(sent.size) <= 2000


def test_small_image_is_not_enlarged(gateway):
    fixture, image = page_image()
    llm.read_page(image)
    url = gateway.requests[0]["body"]["messages"][1]["content"][0]["image_url"]["url"]
    sent = Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))
    assert sent.size == (fixture.width, fixture.height)


# parsing


def test_parse_page_cleans_the_lines(gateway):
    _, image = page_image()
    page = llm.read_page(image)
    assert page.date == "20.11.2025"
    assert [line.symbol for line in page.lines] == ["none", "•", "x"]
    assert page.lines[1].text == "Müller anrufen #arbeit 9:30"
    assert page.lines[1].tags == ["arbeit"] and page.lines[1].time == "09:30"


@pytest.mark.parametrize("fence", ["```json\n", "```\n"])
def test_fenced_json_is_parsed(gateway, fence):
    gateway.answers = [ok(fence=fence)]
    _, image = page_image()
    assert len(llm.read_page(image).lines) == 3


def test_symbols_are_normalised():
    cases = {
        "*": "•", "·": "•", "●": "•", "-": "–", "—": "–", "o": "○", "O": "○", "◯": "○", "°": "○",
        "X": "x", "×": "x", "•": "•", "x": "x", ">": ">", "<": "<", "○": "○", "–": "–", "none": "none",
        "~": "~", "∼": "~",
        "?": "none", "": "none", "ab": "none",
    }
    lines = [{"symbol": symbol, "text": "t"} for symbol in cases]
    page = llm.parse_page(json.dumps({"date": None, "lines": lines}), "m")
    assert [line.symbol for line in page.lines] == list(cases.values())


def test_fields_are_cleaned():
    lines = [
        {"symbol": "•", "text": "  a  ", "tags": ["#x", "y", 3, " "], "time": "9:05", "confidence": 7},
        {"symbol": "•", "text": "b", "tags": "no", "time": "25:00", "confidence": "high"},
        {"symbol": "•", "text": "c", "time": "12:3", "confidence": -2},
        {"symbol": "•", "text": "d", "time": 930},
        {"symbol": "none", "text": "   "},
        {"symbol": "", "text": ""},
        {"symbol": "•", "text": 5},
        "junk",
    ]
    page = llm.parse_page(json.dumps({"date": " ", "lines": lines}), "m")
    assert page.date is None
    a, b, c, d = page.lines
    assert (a.text, a.tags, a.time, a.confidence) == ("a", ["x", "y"], "09:05", 1.0)
    assert (b.tags, b.time, b.confidence) == ([], None, 0.5)
    assert (c.tags, c.time, c.confidence) == ([], None, 0.0)
    assert (d.time, d.confidence) == (None, 0.5)
    assert len(page.lines) == 4


def test_a_bullet_with_empty_text_is_kept():
    page = llm.parse_page(json.dumps({"lines": [{"symbol": "•", "text": ""}]}), "m")
    assert len(page.lines) == 1


# page kind and period


def kind_answer(kind, period, lines):
    return {
        "date": None,
        "kind": kind,
        "period": period,
        "lines": [{"symbol": s, "text": t, "tags": [], "time": None, "confidence": 0.9} for s, t in lines],
    }


@pytest.mark.parametrize(
    "kind, period, lines",
    [
        ("future", "2027", FUTURE_LINES),
        ("calendar", "2026-12", CALENDAR_LINES),
        ("month-task", "2026-12", MONTH_TASK_LINES),
    ],
)
def test_the_page_kind_and_period_are_read_and_the_heading_lines_stay(kind, period, lines):
    page = llm.parse_page(json.dumps(kind_answer(kind, period, lines), ensure_ascii=False), "m")
    assert (page.kind, page.period) == (kind, period)
    assert [(line.symbol, line.text) for line in page.lines] == lines


@pytest.mark.parametrize(
    "kind, period, want_kind, want_period",
    [
        ("weekly", "2026-13", None, None),
        (3, 2027, None, None),
        ("", "26", None, None),
        (None, None, None, None),
        ("Daily", "2026-1", "daily", None),
        ("future ", " 2027-02 ", "future", "2027-02"),
    ],
)
def test_an_invalid_kind_or_period_becomes_none(kind, period, want_kind, want_period):
    page = llm.parse_page(json.dumps({"kind": kind, "period": period, "lines": [{"symbol": "•", "text": "a"}]}), "m")
    assert (page.kind, page.period) == (want_kind, want_period)


def test_an_answer_without_kind_or_period_is_a_page_with_none():
    page = llm.parse_page(json.dumps({"date": None, "lines": [{"symbol": "•", "text": "a"}]}), "m")
    assert (page.kind, page.period) == (None, None)


def test_the_prompt_and_schema_ask_for_every_page_kind(gateway):
    assert set(llm.KINDS) == {"daily", "future", "calendar", "month-task"}
    assert {"kind", "period"} <= set(llm.PAGE_SCHEMA["required"])
    assert llm.PAGE_SCHEMA["properties"]["kind"]["enum"] == [*llm.KINDS, None]
    for word in ("future", "calendar", "month-task", "weekday letters", "day number"):
        assert word in llm.SYSTEM_PROMPT


def test_run_ocr_passes_the_kind_and_period_on(gateway):
    gateway.answers = [ok(kind_answer("future", "2027", FUTURE_LINES))]
    result = server.run_ocr(make_page(FUTURE_LINES).png, fake_recognizer)
    assert (result["kind"], result["period"]) == ("future", "2027")
    assert [line["text"] for line in result["lines"]] == [text for _, text in FUTURE_LINES]
    assert result["lines"][0]["symbol"] == "none"


# format rejection


def test_400_about_response_format_retries_once_without_it(gateway):
    gateway.answers = [(400, '{"error": {"message": "response_format is not supported"}}', 0), ok()]
    _, image = page_image()
    assert len(llm.read_page(image).lines) == 3
    assert len(gateway.requests) == 2
    assert "response_format" in gateway.requests[0]["body"]
    assert "response_format" not in gateway.requests[1]["body"]


def test_400_about_json_schema_also_retries(gateway):
    gateway.answers = [(400, "bad json_schema", 0), ok()]
    _, image = page_image()
    llm.read_page(image)
    assert len(gateway.requests) == 2


def test_other_400_is_not_retried(gateway):
    gateway.answers = [(400, '{"error": "image too large"}', 0), ok()]
    _, image = page_image()
    with pytest.raises(llm.LlmError):
        llm.read_page(image)
    assert len(gateway.requests) == 1


def test_a_second_400_is_not_retried_again(gateway):
    gateway.answers = [(400, "response_format", 0)]
    _, image = page_image()
    with pytest.raises(llm.LlmError):
        llm.read_page(image)
    assert len(gateway.requests) == 2


# errors


def test_not_configured_makes_no_request(gateway, monkeypatch):
    monkeypatch.delenv("OCR_LLM_KEY")
    _, image = page_image()
    with pytest.raises(llm.LlmError):
        llm.read_page(image)
    assert gateway.requests == []
    assert not llm.configured()


@pytest.mark.parametrize(
    "answer",
    [
        (500, "boom", 0),
        (200, "not json at all", 0),
        (200, completion("not json"), 0),
        (200, completion(json.dumps({"date": None})), 0),
        (200, completion(json.dumps({"date": None, "lines": []})), 0),
        (200, completion(json.dumps({"lines": [{"symbol": "none", "text": " "}]})), 0),
        (200, completion(json.dumps([1, 2])), 0),
        (200, completion(None), 0),
        (200, json.dumps({"choices": []}), 0),
    ],
)
def test_bad_answers_raise_llm_error(gateway, answer):
    gateway.answers = [answer]
    _, image = page_image()
    with pytest.raises(llm.LlmError):
        llm.read_page(image)
    assert len(gateway.requests) == 1


def test_errors_log_one_line_without_secrets(gateway, caplog):
    gateway.answers = [(200, completion("Geheimer Seitentext"), 0)]
    _, image = page_image()
    with caplog.at_level("INFO", logger="bujo_ocr"), pytest.raises(llm.LlmError):
        llm.read_page(image)
    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert "claude-haiku-5-5" in message
    assert "test-key" not in message and "Geheimer" not in message


def test_a_redirect_is_not_followed(gateway):
    gateway.answers = [(302, "", 0)]
    _, image = page_image()
    with pytest.raises(llm.LlmError):
        llm.read_page(image)


# run_ocr and the service


def test_run_ocr_uses_the_llm_and_the_detector_boxes(gateway):
    fixture = make_page()
    gateway.answers = [ok({"date": "20.11.2025", "lines": [
        {"symbol": e.symbol, "text": e.text, "tags": [], "time": None, "confidence": 0.9} for e in fixture.expected
    ]})]
    result = server.run_ocr(fixture.png, fake_recognizer)
    assert set(result) == {"lines", "date", "kind", "period", "width", "height", "ms"}
    assert result["date"] == "20.11.2025"
    assert (result["kind"], result["period"]) == (None, None)
    assert [line["symbol"] for line in result["lines"]] == [e.symbol for e in fixture.expected]
    for line in result["lines"]:
        assert set(line) == {"symbol", "text", "confidence", "bbox", "engine", "tags", "time"}
        assert line["engine"] == "llm:claude-haiku-5-5"
        assert line["bbox"][2] > 0 and line["bbox"][3] > 0


def test_a_date_given_only_in_date_becomes_the_first_line(gateway):
    fixture = make_page()  # the date line plus six bullets, as the live model answered: date only in "date"
    gateway.answers = [ok({"date": "20.11.2025", "lines": [
        {"symbol": e.symbol, "text": e.text, "tags": [], "time": None, "confidence": 0.9}
        for e in fixture.expected if e.symbol != "none"
    ]})]
    result = server.run_ocr(fixture.png, fake_recognizer)
    first = result["lines"][0]
    assert (first["symbol"], first["text"], first["engine"]) == ("none", "20.11.2025", "llm:claude-haiku-5-5")
    assert [line["symbol"] for line in result["lines"]] == [e.symbol for e in fixture.expected]
    assert all(line["bbox"][2] > 0 for line in result["lines"])


def test_run_ocr_uses_empty_boxes_when_line_counts_differ(gateway):
    result = server.run_ocr(make_page().png, fake_recognizer)  # the LLM answers 3 lines, the page has 7
    assert len(result["lines"]) == 3
    assert all(line["bbox"] == [0, 0, 0, 0] for line in result["lines"])


def test_run_ocr_takes_an_injected_reader_without_any_env():
    page = llm.LlmPage(date=None, lines=[llm.LlmLine("•", "hallo", ["t"], "08:00", 0.7)], model="m1")
    result = server.run_ocr(make_page().png, fake_recognizer, lambda image: page)
    assert result["lines"][0]["engine"] == "llm:m1"
    assert result["lines"][0]["tags"] == ["t"] and result["lines"][0]["time"] == "08:00"


def test_an_unexpected_exception_from_the_reader_falls_back():
    def broken(image):
        raise RuntimeError("boom")

    result = server.run_ocr(make_page().png, fake_recognizer, broken)
    assert {line["engine"] for line in result["lines"]} == {"fake"}


def call_ocr(port, body):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    try:
        conn.request("POST", "/ocr", body=body, headers={"content-type": "image/png"})
        response = conn.getresponse()
        return response.status, json.loads(response.read())
    finally:
        conn.close()


@pytest.fixture()
def service():
    httpd = server.make_server("127.0.0.1", 0, fake_recognizer)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()
    thread.join(timeout=5)


def test_service_happy_path(gateway, service):
    status, body = call_ocr(service, make_page().png)
    assert status == 200
    assert body["date"] == "20.11.2025"
    lines = body["lines"]
    assert [line["symbol"] for line in lines] == ["none", "•", "x"]
    assert {line["engine"] for line in lines} == {"llm:claude-haiku-5-5"}
    assert lines[1]["text"] == "Müller anrufen #arbeit 9:30"
    assert lines[2]["text"] == "Straße fegen"
    assert lines[1]["tags"] == ["arbeit"] and lines[1]["time"] == "09:30"
    assert lines[0]["time"] is None and lines[0]["tags"] == []
    assert len(gateway.requests) == 1


def test_service_with_an_injected_reader():
    page = llm.LlmPage(date="d", lines=[llm.LlmLine("○", "Fest", [], None, 0.5)], model="m2")
    httpd = server.make_server("127.0.0.1", 0, fake_recognizer, lambda image: page)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        status, body = call_ocr(httpd.server_address[1], make_page().png)
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)
    assert status == 200 and body["date"] == "d" and body["lines"][0]["engine"] == "llm:m2"


# fallbacks


def assert_fallback(port_or_none, fixture, via_http):
    if via_http:
        status, body = call_ocr(port_or_none, fixture.png)
        assert status == 200
    else:
        body = server.run_ocr(fixture.png, fake_recognizer)
    assert body["date"] is None
    assert [line["symbol"] for line in body["lines"]] == [e.symbol for e in fixture.expected]
    for line in body["lines"]:
        assert line["engine"] == "fake"
        assert line["tags"] == [] and line["time"] is None
        assert set(line) == {"symbol", "text", "confidence", "bbox", "engine", "tags", "time"}


def test_fallback_without_a_key_makes_no_request(gateway, monkeypatch):
    monkeypatch.delenv("OCR_LLM_KEY")
    assert_fallback(None, make_page(), via_http=False)
    assert gateway.requests == []


def test_fallback_without_a_base(gateway, monkeypatch):
    monkeypatch.delenv("OCR_LLM_BASE")
    assert_fallback(None, make_page(), via_http=False)
    assert gateway.requests == []


@pytest.mark.parametrize(
    "answer",
    [
        (500, "boom", 0),
        (200, completion("not json"), 0),
        (200, completion(json.dumps({"date": None, "lines": []})), 0),
    ],
    ids=["http500", "invalid-json", "empty-lines"],
)
def test_fallback_on_gateway_problems(gateway, service, answer):
    gateway.answers = [answer]
    assert_fallback(service, make_page(), via_http=True)
    assert len(gateway.requests) == 1


def test_fallback_on_timeout(gateway, monkeypatch):
    gateway.answers = [(200, completion("{}"), 2.0)]
    monkeypatch.setenv("OCR_LLM_TIMEOUT", "0.3")
    assert_fallback(None, make_page(), via_http=False)
    assert len(gateway.requests) == 1


def test_fallback_when_the_gateway_is_not_listening(monkeypatch):
    monkeypatch.setenv("OCR_LLM_BASE", "http://127.0.0.1:1/v1")
    monkeypatch.setenv("OCR_LLM_KEY", "test-key")
    assert_fallback(None, make_page(), via_http=False)


def test_a_bad_timeout_value_means_the_default(monkeypatch):
    monkeypatch.setenv("OCR_LLM_TIMEOUT", "soon")
    assert llm._env_settings().timeout == llm.DEFAULT_TIMEOUT
