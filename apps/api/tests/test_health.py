from fastapi.testclient import TestClient

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
