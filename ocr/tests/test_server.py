"""HTTP service tests. The page reader is a fake, so no gateway is needed."""
import http.client
import json
import threading

import pytest

from bujo_ocr import llm, server
from fixtures import make_page, to_jpeg, to_webp

PAGE = llm.LlmPage(
    date="20.11.2025",
    lines=[llm.LlmLine("•", "Müller anrufen", ["arbeit"], "09:30", 0.9), llm.LlmLine("–", "Notiz ä ö ü ß", [], None, 0.8, 1)],
    model="fake-model",
)


def fake_reader(image):
    return PAGE


def start(read_page=fake_reader, host="127.0.0.1"):
    httpd = server.make_server(host, 0, read_page)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, thread


def stop(httpd, thread):
    httpd.shutdown()
    httpd.server_close()
    thread.join(timeout=5)


@pytest.fixture()
def service():
    httpd, thread = start()
    yield httpd.server_address[1]
    stop(httpd, thread)


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
    httpd, thread = start(host="::")
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
        stop(httpd, thread)


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
    assert set(body) == {"lines", "date", "kind", "period", "pageNumber", "width", "height", "ms"}
    assert body["date"] == "20.11.2025"
    assert body["kind"] is None and body["period"] is None and body["pageNumber"] is None
    assert body["width"] == fixture.width and body["height"] == fixture.height
    assert isinstance(body["ms"], int)
    assert [(line["symbol"], line["text"]) for line in body["lines"]] == [
        ("none", "20.11.2025"), ("•", "Müller anrufen"), ("–", "Notiz ä ö ü ß"),
    ]
    for line in body["lines"]:
        assert set(line) == {"symbol", "text", "confidence", "bbox", "engine", "tags", "time", "indent"}
        assert line["engine"] == "llm:fake-model"
        assert line["bbox"] == [0, 0, 0, 0]
        assert 0 <= line["confidence"] <= 1
    assert body["lines"][1]["tags"] == ["arbeit"] and body["lines"][1]["time"] == "09:30"
    assert body["lines"][2]["indent"] == 1


def test_content_type_parameters_are_accepted(service):
    status, _ = call(service, "POST", "/ocr", make_page().png, "image/png; charset=binary")
    assert status == 200


@pytest.mark.parametrize("content_type", ["text/plain", "application/json", "image/gif", "image/heic", None])
def test_wrong_content_type_is_415(service, content_type):
    status, body = call(service, "POST", "/ocr", make_page().png, content_type)
    assert status == 415
    assert "content-type" in body["error"]


def test_post_without_content_length_is_411(service):
    conn = http.client.HTTPConnection("127.0.0.1", service, timeout=20)
    try:
        conn.putrequest("POST", "/ocr")
        conn.putheader("content-type", "image/png")
        conn.endheaders()
        assert conn.getresponse().status == 411
    finally:
        conn.close()


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


def test_an_unreadable_image_is_400_even_when_nothing_is_configured():
    httpd, thread = start(read_page=None)
    try:
        assert call(httpd.server_address[1], "POST", "/ocr", b"hello", "image/png")[0] == 400
    finally:
        stop(httpd, thread)


def test_nothing_configured_is_a_503_with_a_category():
    httpd, thread = start(read_page=None)
    try:
        status, body = call(httpd.server_address[1], "POST", "/ocr", make_page().png, "image/png")
    finally:
        stop(httpd, thread)
    assert status == 503
    assert body["category"] == "not configured" and body["error"]


def test_a_reader_error_is_a_502_with_its_category():
    def refuses(image):
        raise llm.LlmError("timeout")

    httpd, thread = start(read_page=refuses)
    try:
        status, body = call(httpd.server_address[1], "POST", "/ocr", make_page().png, "image/png")
    finally:
        stop(httpd, thread)
    assert status == 502
    assert body == {"error": "ocr reader failed", "category": "timeout"}


def test_an_unexpected_reader_exception_is_a_502_failed():
    def broken(image):
        raise RuntimeError("boom")

    httpd, thread = start(read_page=broken)
    try:
        status, body = call(httpd.server_address[1], "POST", "/ocr", make_page().png, "image/png")
    finally:
        stop(httpd, thread)
    assert (status, body["category"]) == (502, "failed")


def test_the_service_writes_nothing_to_disk(service, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    call(service, "POST", "/ocr", make_page().png, "image/png")
    assert list(tmp_path.iterdir()) == []
