from fastapi.testclient import TestClient

import app.main as app_main
from app import db as app_db
from app.main import app


def test_health() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_ready_ok() -> None:
    """Readiness returns 200 when the DB answers (it does in tests)."""
    response = TestClient(app).get("/health/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


class _BrokenEngine:
    """Stands in for app.db.engine — any connect attempt blows up."""

    def connect(self):
        raise RuntimeError("db is down")


def test_health_is_db_free_but_ready_is_not(monkeypatch) -> None:
    """/health (liveness) must stay up with a dead DB; /health/ready must
    flip to 503 — proving the readiness check actually touches the engine
    while liveness doesn't."""
    monkeypatch.setattr(app_db, "engine", _BrokenEngine())

    client = TestClient(app)
    live = client.get("/health")
    assert live.status_code == 200

    ready = client.get("/health/ready")
    assert ready.status_code == 503
    body = ready.json()
    assert body["status"] == "not ready"
    assert "db is down" in body["reason"]


def test_health_ready_returns_503_immediately_when_draining(monkeypatch) -> None:
    """Bug 3 (Wave 1): once shutdown has started (app.main._shutting_down),
    /health/ready must flip to 503 WITHOUT touching the DB at all — proven
    here by leaving app.db.engine perfectly healthy (unlike the test above)
    and asserting readiness still fails, purely off the flag."""
    monkeypatch.setattr(app_main, "_shutting_down", True)

    response = TestClient(app).get("/health/ready")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not ready"
    assert "shutting down" in body["reason"]


def test_health_stays_up_while_draining(monkeypatch) -> None:
    """Liveness must never flip just because shutdown has started — only
    readiness should, so kube/load-balancer stops routing NEW traffic
    without the process getting killed by a liveness probe mid-drain."""
    monkeypatch.setattr(app_main, "_shutting_down", True)

    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
