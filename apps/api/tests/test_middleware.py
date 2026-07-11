"""Tests for the request-ID middleware in app.main: every response carries
an X-Request-ID header, and a client-supplied header is echoed back
unchanged so trace IDs can propagate end-to-end. Sync TestClient is fine
here — no DB access, matches test_health.py's pattern.
"""

from fastapi.testclient import TestClient

from app.main import app


def test_health_response_has_request_id_header() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.headers.get("X-Request-ID")


def test_explicit_request_id_header_is_echoed() -> None:
    response = TestClient(app).get("/health", headers={"X-Request-ID": "abc123"})
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "abc123"
