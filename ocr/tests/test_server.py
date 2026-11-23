"""HTTP service tests. The page reader is a fake, so no gateway is needed."""
import http.client
import json
import threading

import pytest

from bujo_ocr import llm, server
from fixtures import make_page, to_jpeg, to_webp


def fake_reader(image):
    lines = [llm.LlmLine("•", f"zeile {i + 1} ä ö ü ß", [], None, 0.9) for i in range(7)]
    return llm.LlmPage(date=None, lines=lines, model="fake")


@pytest.fixture()
def service():
    httpd = server.make_server("127.0.0.1", 0, fake_reader)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()
    thread.join(timeout=5)


def call(port, method, path, body=None, content_type=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
    try:
        h = dict(headers or {})
        if content_type:
            h["content-type"] = content_type
        conn.request(method, path, body=body, headers=h)
        response = conn.getresponse()
        raw = response.read()
        return response.status, json.loads(raw) if raw else None
    finally:
        conn.close()


def test_healthz(service):
    assert call(service, "GET", "/healthz") == (200, {"ok": True})


def test_dual_stack_host_answers_on_ipv4_and_ipv6():
    httpd = server.make_server("::", 0, fake_reader)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        port = httpd.server_address[1]
        assert call(port, "GET", "/healthz") == (200, {"ok": True})
        conn = http.client.HTTPConnection("::1", port, timeout=20)
        try:
            conn.request("GET", "/healthz")
            assert conn.getresponse().status == 200
        finally:
            conn.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def test_unknown_path_is_404(service):
    assert call(service, "GET", "/nope")[0] == 404
    assert call(service, "POST", "/nope", b"x", "image/png")[0] == 404


@pytest.mark.parametrize(
    "encode,content_type",
    [(lambda png: png, "image/png"), (to_jpeg, "image/jpeg"), (to_webp, "image/webp")],
)
def test_post_ocr_returns_the_json_shape(service, encode, content_type):
    fixture = make_page(cream=True, grid=True)
    status, body = call(service, "POST", "/ocr", encode(fixture.png), content_type)
    assert status == 200
    assert set(body) == {"lines", "date", "kind", "period", "width", "height", "ms"}
    assert body["date"] is None
    assert body["kind"] is None and body["period"] is None
    assert body["width"] == fixture.width and body["height"] == fixture.height
    assert isinstance(body["ms"], int)
    assert len(body["lines"]) == 7
    for index, line in enumerate(body["lines"]):
        assert set(line) == {"symbol", "text", "confidence", "bbox", "engine", "tags", "time"}
        assert line["tags"] == [] and line["time"] is None and line["symbol"] == "•"
        assert line["text"] == f"zeile {index + 1} ä ö ü ß"
        assert line["engine"] == "llm:fake"
        assert 0 <= line["confidence"] <= 1
        x, y, w, h = line["bbox"]
        assert x >= 0 and y >= 0 and x + w <= body["width"] and y + h <= body["height"]


def test_content_type_parameters_are_accepted(service):
    fixture = make_page()
    status, _ = call(service, "POST", "/ocr", fixture.png, "image/png; charset=binary")
    assert status == 200


@pytest.mark.parametrize("content_type", ["text/plain", "application/json", "image/gif", "image/heic", None])
def test_wrong_content_type_is_415(service, content_type):
    status, body = call(service, "POST", "/ocr", make_page().png, content_type)
    assert status == 415
    assert "content-type" in body["error"]


def test_oversize_is_413_without_reading_the_body(service):
    conn = http.client.HTTPConnection("127.0.0.1", service, timeout=20)
    try:
        conn.putrequest("POST", "/ocr")
        conn.putheader("content-type", "image/png")
        conn.putheader("content-length", str(server.MAX_BYTES + 1))
        conn.endheaders()  # no body is sent: the answer must not wait for it
        response = conn.getresponse()
        assert response.status == 413
        assert "15 MB" in json.loads(response.read())["error"]
    finally:
        conn.close()


def test_exactly_the_limit_is_not_oversize(service):
    # Bytes that are not an image at the limit: past the size check, then a 400 from decoding.
    status, body = call(service, "POST", "/ocr", b"\0" * server.MAX_BYTES, "image/png")
    assert status == 400
    assert body["error"] == "not a readable image"


def test_not_an_image_is_400(service):
    assert call(service, "POST", "/ocr", b"hello", "image/png")[0] == 400


def test_empty_body_is_400(service):
    assert call(service, "POST", "/ocr", b"", "image/png")[0] == 400


def test_a_missing_gateway_setting_is_a_503_with_a_clear_message():
    httpd = server.make_server("127.0.0.1", 0)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        status, body = call(httpd.server_address[1], "POST", "/ocr", make_page().png, "image/png")
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)
    assert status == 503 and "OCR_LLM_BASE" in body["error"] and "OCR_LLM_KEY" in body["error"]


def test_a_reader_failure_is_a_502():
    def broken(image):
        raise llm.LlmError("http 500")

    httpd = server.make_server("127.0.0.1", 0, broken)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        status, _ = call(httpd.server_address[1], "POST", "/ocr", make_page().png, "image/png")
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)
    assert status == 502


def test_startup_without_gateway_settings_exits_with_a_clear_message():
    with pytest.raises(SystemExit) as exit_info:
        server.main()
    assert "OCR_LLM_BASE" in str(exit_info.value)


def test_the_service_writes_nothing_to_disk(service, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    call(service, "POST", "/ocr", make_page().png, "image/png")
    assert list(tmp_path.iterdir()) == []
