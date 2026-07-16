"""Phase 12 F2 — embeddings pre-warm guard.

Unit-tests app.main._start_embeddings_prewarm directly (the lifespan just
calls it). The real loader (ingest._get_embedder) is monkeypatched with a
spy in both tests, so nothing is ever downloaded. Settings are monkeypatched
at app.main's module reference rather than via env, because get_settings()
is @lru_cache'd and already locked in by conftest.py (EMBEDDINGS_PREWARM=0).
"""

import threading
from types import SimpleNamespace

import app.main as app_main
from app.services import ingest


def test_prewarm_skipped_when_disabled(monkeypatch) -> None:
    loaded = threading.Event()
    monkeypatch.setattr(ingest, "_get_embedder", lambda: loaded.set())
    monkeypatch.setattr(
        app_main, "get_settings", lambda: SimpleNamespace(embeddings_prewarm="0")
    )

    app_main._start_embeddings_prewarm()

    assert not loaded.wait(timeout=0.5), "loader must not be called with EMBEDDINGS_PREWARM=0"


def test_prewarm_kicks_background_load(monkeypatch) -> None:
    loaded = threading.Event()
    monkeypatch.setattr(ingest, "_get_embedder", lambda: loaded.set())
    monkeypatch.setattr(
        app_main, "get_settings", lambda: SimpleNamespace(embeddings_prewarm="1")
    )

    app_main._start_embeddings_prewarm()

    assert loaded.wait(timeout=2), "loader should be invoked from the background thread"
