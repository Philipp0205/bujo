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

from bujo_ocr import image as imaging, llm, server
from fixtures import CALENDAR_LINES, FUTURE_LINES, MONTH_TASK_LINES, make_page, with_corner_number

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


def page_image(**options):
    fixture = make_page(**options)
    return fixture, imaging.decode_image(fixture.png)


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


@pytest.mark.parametrize(
    "value,expected",
    [(None, 0), (0, 0), (1, 1), (2, 1), (5, 1), ("1", 0), (True, 0), (False, 0), (-1, 0), (1.0, 0), ([1], 0)],
)
def test_indent_is_tolerant(value, expected):
    line = llm._line({"symbol": "–", "text": "Note", "indent": value})
    assert line.indent == expected


def test_a_line_without_indent_is_not_nested():
    assert llm._line({"symbol": "–", "text": "Note"}).indent == 0


def test_the_schema_and_prompt_ask_for_indent():
    item = llm.PAGE_SCHEMA["properties"]["lines"]["items"]
    assert item["properties"]["indent"] == {"type": "integer", "enum": [0, 1]}
    assert "indent" in item["required"] and item["additionalProperties"] is False
    assert "indented to the right of the line above" in llm.SYSTEM_PROMPT
    assert "one level only" in llm.SYSTEM_PROMPT


def test_read_page_keeps_the_indent_of_each_line(gateway):
    lines = [
        {"symbol": "○", "text": "Meeting", "tags": [], "time": None, "confidence": 0.9, "indent": 0},
        {"symbol": "–", "text": "Note 1", "tags": [], "time": None, "confidence": 0.9, "indent": 1},
        {"symbol": "–", "text": "Note 2", "tags": [], "time": None, "confidence": 0.9, "indent": 3},
    ]
    gateway.answers = [ok({"date": None, "lines": lines})]
    _, image = page_image()
    assert [line.indent for line in llm.read_page(image).lines] == [0, 1, 1]


# page number


def test_the_schema_requires_page_number_and_the_prompt_explains_it():
    assert "page_number" in llm.PAGE_SCHEMA["required"]
    assert llm.PAGE_SCHEMA["properties"]["page_number"] == {"type": ["integer", "null"]}
    assert llm.PAGE_SCHEMA["additionalProperties"] is False
    assert llm.RESPONSE_FORMAT["json_schema"]["strict"] is True
    for words in ("page_number", "- 12 -", "never return it as a line", "a time, a date, a price"):
        assert words in llm.SYSTEM_PROMPT


@pytest.mark.parametrize(
    "value,expected",
    [
        (12, 12), ("12", 12), (" 7 ", 7), (1, 1), (9999, 9999),
        (None, None), (True, None), (False, None), (12.0, None), (12.5, None), ("twelve", None), ("12.5", None),
        ("", None), (0, None), (-3, None), (10000, None), ("10000", None), ("0", None), ([12], None),
    ],
)
def test_page_number_is_parsed_tolerantly(value, expected):
    answer = {"page_number": value, "lines": [{"symbol": "•", "text": "a"}]}
    assert llm.parse_page(json.dumps(answer), "m").page_number == expected


def test_an_answer_without_page_number_is_a_page_with_none():
    assert llm.parse_page(json.dumps({"lines": [{"symbol": "•", "text": "a"}]}), "m").page_number is None


def test_run_ocr_passes_the_page_number_on_and_it_is_not_a_line(gateway):
    answer = {**PAGE_ANSWER, "page_number": 12}
    gateway.answers = [ok(answer)]
    result = server.run_ocr(with_corner_number(make_page().png, 12))
    assert result["pageNumber"] == 12
    assert all(line["text"] != "12" for line in result["lines"])


def test_run_ocr_without_a_page_number_answers_null(gateway):
    result = server.run_ocr(make_page().png)
    assert result["pageNumber"] is None


def test_run_ocr_takes_an_injected_reader_with_a_page_number():
    page = llm.LlmPage(date=None, lines=[llm.LlmLine("•", "a", [], None, 0.9)], model="m", page_number=33)
    assert server.run_ocr(make_page().png, lambda image: page)["pageNumber"] == 33


def test_run_ocr_passes_the_kind_and_period_on(gateway):
    gateway.answers = [ok(kind_answer("future", "2027", FUTURE_LINES))]
    result = server.run_ocr(make_page(FUTURE_LINES).png)
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
    assert len(gateway.requests) == (2 if answer[1] in ("not json at all", completion("not json")) else 1)


def test_errors_log_one_warning_without_secrets(gateway, caplog):
    gateway.answers = [(500, "Geheimer Seitentext", 0)]
    _, image = page_image()
    with caplog.at_level("INFO", logger="bujo_ocr"), pytest.raises(llm.LlmError):
        llm.read_page(image)
    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert "claude-haiku-5-5" in message
    assert "test-key" not in message and "Geheimer" not in message


def test_a_retry_logs_category_and_model_only_then_one_final_warning(gateway, caplog):
    gateway.answers = [(200, completion("Geheimer Seitentext"), 0)]
    _, image = page_image()
    with caplog.at_level("INFO", logger="bujo_ocr"), pytest.raises(llm.LlmError):
        llm.read_page(image)
    assert [r.levelname for r in caplog.records] == ["INFO", "WARNING"]
    for record in caplog.records:
        message = record.getMessage()
        assert "invalid json" in message and "claude-haiku-5-5" in message
        assert "test-key" not in message and "Geheimer" not in message and "127.0.0.1" not in message


# retry on invalid json


def test_invalid_json_then_a_valid_page_succeeds_with_two_requests(gateway):
    gateway.answers = [(200, completion("not json"), 0), ok()]
    _, image = page_image()
    assert len(llm.read_page(image).lines) == 3
    assert len(gateway.requests) == 2


def test_a_non_json_gateway_body_then_a_valid_page_succeeds(gateway):
    gateway.answers = [(200, "<html>oops</html>", 0), ok()]
    _, image = page_image()
    assert len(llm.read_page(image).lines) == 3
    assert len(gateway.requests) == 2


def test_two_invalid_json_answers_fail_after_exactly_two_requests(gateway):
    gateway.answers = [(200, completion("not json"), 0), (200, completion("still not"), 0), ok()]
    _, image = page_image()
    with pytest.raises(llm.LlmError) as raised:
        llm.read_page(image)
    assert raised.value.category == "invalid json"
    assert len(gateway.requests) == 2


def test_a_format_rejection_then_invalid_json_stops_after_two_requests(gateway):
    gateway.answers = [(400, "response_format nope", 0), (200, completion("not json"), 0), ok()]
    _, image = page_image()
    with pytest.raises(llm.LlmError) as raised:
        llm.read_page(image)
    assert raised.value.category == "invalid json"
    assert len(gateway.requests) == 2
    assert "response_format" not in gateway.requests[1]["body"]


@pytest.mark.parametrize("answer, category", [((401, "no", 0), "http 401"), ((500, "boom", 0), "http 500")])
def test_http_errors_are_a_single_request(gateway, answer, category):
    gateway.answers = [answer, ok()]
    _, image = page_image()
    with pytest.raises(llm.LlmError) as raised:
        llm.read_page(image)
    assert raised.value.category == category
    assert len(gateway.requests) == 1


def test_a_timeout_is_a_single_request(gateway, monkeypatch):
    gateway.answers = [(200, completion("{}"), 2.0), ok()]
    monkeypatch.setenv("OCR_LLM_TIMEOUT", "0.3")
    _, image = page_image()
    with pytest.raises(llm.LlmError) as raised:
        llm.read_page(image)
    assert raised.value.category == "timeout"
    assert len(gateway.requests) == 1


def test_a_network_failure_is_a_single_request(monkeypatch):
    calls = []

    class Opener:
        def open(self, request, timeout=None):
            calls.append(request)
            raise OSError("down")

    monkeypatch.setenv("OCR_LLM_BASE", "http://gateway.invalid/v1")
    monkeypatch.setenv("OCR_LLM_KEY", "test-key")
    _, image = page_image()
    with pytest.raises(llm.LlmError) as raised:
        llm.read_page(image, opener=Opener())
    assert raised.value.category == "network"
    assert len(calls) == 1


def test_a_redirect_is_not_followed(gateway):
    gateway.answers = [(302, "", 0)]
    _, image = page_image()
    with pytest.raises(llm.LlmError):
        llm.read_page(image)


# run_ocr and the service


def test_run_ocr_uses_the_llm_with_empty_boxes(gateway):
    fixture = make_page()
    gateway.answers = [ok({"date": "20.11.2025", "lines": [
        {"symbol": e.symbol, "text": e.text, "tags": [], "time": None, "confidence": 0.9} for e in fixture.expected
    ]})]
    result = server.run_ocr(fixture.png)
    assert set(result) == {"lines", "date", "kind", "period", "pageNumber", "width", "height", "ms"}
    assert result["date"] == "20.11.2025"
    assert (result["kind"], result["period"]) == (None, None)
    assert [line["symbol"] for line in result["lines"]] == [e.symbol for e in fixture.expected]
    for line in result["lines"]:
        assert set(line) == {"symbol", "text", "confidence", "bbox", "engine", "tags", "time", "indent"}
        assert line["engine"] == "llm:claude-haiku-5-5"
        assert line["bbox"] == [0, 0, 0, 0]


def test_run_ocr_passes_the_indent_on_and_the_date_line_is_never_nested(gateway):
    answer = {"date": "20.11.2025", "lines": [
        {"symbol": "○", "text": "Meeting", "tags": [], "time": None, "confidence": 0.9, "indent": 0},
        {"symbol": "–", "text": "Note", "tags": [], "time": None, "confidence": 0.9, "indent": 1},
    ]}
    gateway.answers = [ok(answer)]
    result = server.run_ocr(make_page().png)
    assert [(line["text"], line["indent"]) for line in result["lines"]] == [
        ("20.11.2025", 0), ("Meeting", 0), ("Note", 1),
    ]


def test_a_date_given_only_in_date_becomes_the_first_line(gateway):
    fixture = make_page()  # the date line plus six bullets, as the live model answered: date only in "date"
    gateway.answers = [ok({"date": "20.11.2025", "lines": [
        {"symbol": e.symbol, "text": e.text, "tags": [], "time": None, "confidence": 0.9}
        for e in fixture.expected if e.symbol != "none"
    ]})]
    result = server.run_ocr(fixture.png)
    first = result["lines"][0]
    assert (first["symbol"], first["text"], first["engine"]) == ("none", "20.11.2025", "llm:claude-haiku-5-5")
    assert [line["symbol"] for line in result["lines"]] == [e.symbol for e in fixture.expected]


def test_run_ocr_takes_an_injected_reader_without_any_env():
    page = llm.LlmPage(date=None, lines=[llm.LlmLine("•", "hallo", ["t"], "08:00", 0.7)], model="m1")
    result = server.run_ocr(make_page().png, lambda image: page)
    assert result["lines"][0]["engine"] == "llm:m1"
    assert result["lines"][0]["tags"] == ["t"] and result["lines"][0]["time"] == "08:00"


def test_an_unexpected_exception_from_the_reader_is_a_502_failure(caplog):
    def broken(image):
        raise RuntimeError("secret page text")

    with caplog.at_level("INFO", logger="bujo_ocr"), pytest.raises(server.OcrFailure) as raised:
        server.run_ocr(make_page().png, broken)
    assert (raised.value.status, raised.value.category) == (502, "failed")
    assert "secret page text" not in caplog.text


def test_a_reader_error_keeps_its_category_and_is_a_502():
    def refuses(image):
        raise llm.LlmError("http 401")

    with pytest.raises(server.OcrFailure) as raised:
        server.run_ocr(make_page().png, refuses)
    assert (raised.value.status, raised.value.category) == (502, "http 401")


def test_not_configured_is_a_503_and_makes_no_request(gateway, monkeypatch):
    monkeypatch.delenv("OCR_LLM_KEY")
    with pytest.raises(server.OcrFailure) as raised:
        server.run_ocr(make_page().png)
    assert (raised.value.status, raised.value.category) == (503, "not configured")
    assert gateway.requests == []


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
    httpd = server.make_server("127.0.0.1", 0)
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


# errors over HTTP: no fallback


def test_service_without_a_key_is_a_503_with_a_category(gateway, service, monkeypatch):
    monkeypatch.delenv("OCR_LLM_KEY")
    status, body = call_ocr(service, make_page().png)
    assert status == 503
    assert body == {"error": "ocr reader is not configured", "category": "not configured"}
    assert gateway.requests == []


def test_service_without_a_base_is_a_503(gateway, service, monkeypatch):
    monkeypatch.delenv("OCR_LLM_BASE")
    assert call_ocr(service, make_page().png)[0] == 503


@pytest.mark.parametrize(
    "answer, category",
    [
        ((500, "boom", 0), "http 500"),
        ((401, "no", 0), "http 401"),
        ((200, completion("not json"), 0), "invalid json"),
        ((200, completion(json.dumps({"date": None, "lines": []})), 0), "no lines"),
    ],
    ids=["http500", "http401", "invalid-json", "empty-lines"],
)
def test_service_gateway_problems_are_a_502_with_the_category(gateway, service, answer, category):
    gateway.answers = [answer]
    status, body = call_ocr(service, make_page().png)
    assert status == 502
    assert body == {"error": "ocr reader failed", "category": category}
    assert len(gateway.requests) == (2 if category == "invalid json" else 1)


def test_service_timeout_is_a_502(gateway, service, monkeypatch):
    gateway.answers = [(200, completion("{}"), 2.0)]
    monkeypatch.setenv("OCR_LLM_TIMEOUT", "0.3")
    status, body = call_ocr(service, make_page().png)
    assert (status, body["category"]) == (502, "timeout")


def test_service_gateway_not_listening_is_a_502(service, monkeypatch):
    monkeypatch.setenv("OCR_LLM_BASE", "http://127.0.0.1:1/v1")
    monkeypatch.setenv("OCR_LLM_KEY", "test-key")
    status, body = call_ocr(service, make_page().png)
    assert (status, body["category"]) == (502, "network")


def test_service_error_bodies_leak_no_secret(gateway, service, monkeypatch):
    gateway.answers = [(500, "key test-key page text", 0)]
    status, body = call_ocr(service, make_page().png)
    assert status == 502
    text = json.dumps(body)
    assert "test-key" not in text and "127.0.0.1" not in text


def test_a_bad_timeout_value_means_the_default(monkeypatch):
    monkeypatch.setenv("OCR_LLM_TIMEOUT", "soon")
    assert llm._env_settings().timeout == llm.DEFAULT_TIMEOUT
