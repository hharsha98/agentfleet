"""Unit tests for services/queue.py's mode-routing (dispatch_plan /
dispatch_execute). Fully hermetic — no real Redis, no real worker process,
and no database:

- get_settings is monkeypatched per-test to a fake with a fixed
  orchestrator_mode (bypasses the lru_cache singleton entirely, so mode
  switching works without cache_clear()).
- The real plan_and_execute/execute_run coroutines (imported into this
  module's namespace) are replaced with no-op async stand-ins.
- asyncio.create_task is replaced, within this module only, with a stub
  that records the coroutine and closes it instead of scheduling it — so
  nothing actually runs on the event loop.
"""

import asyncio
import uuid
from types import SimpleNamespace

import pytest

from app.services import queue as queue_module


class FakeSettings:
    def __init__(self, mode: str) -> None:
        self.orchestrator_mode = mode
        self.redis_url = "redis://localhost:6379/0"


@pytest.fixture
def run_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture(autouse=True)
def _stub_orchestrator_coroutines(monkeypatch):
    """Never let the real orchestrator functions run (they'd hit the DB)."""

    async def fake_plan_and_execute(run_id):
        return None

    async def fake_execute_run(run_id):
        return None

    monkeypatch.setattr(queue_module, "plan_and_execute", fake_plan_and_execute)
    monkeypatch.setattr(queue_module, "execute_run", fake_execute_run)


class _FakeTask:
    """Stands in for the real asyncio.Task that create_task would return —
    just enough surface (add_done_callback, hashable) for queue.py's
    _track() (Bug 4) to accept it without actually scheduling anything."""

    def __init__(self) -> None:
        self.done_callbacks: list = []

    def add_done_callback(self, cb) -> None:
        self.done_callbacks.append(cb)


@pytest.fixture
def record_create_task(monkeypatch):
    """Replace the `asyncio` name inside queue.py only (not the real global
    asyncio module) so create_task calls are recorded, not scheduled."""
    calls = []

    def fake_create_task(coro):
        calls.append(coro)
        coro.close()  # avoid "coroutine was never awaited" warnings
        return _FakeTask()

    fake_asyncio = SimpleNamespace(create_task=fake_create_task)
    monkeypatch.setattr(queue_module, "asyncio", fake_asyncio)
    return calls


@pytest.fixture
def record_enqueue(monkeypatch):
    calls = []

    async def fake_enqueue(func_name, *args):
        calls.append((func_name, args))

    monkeypatch.setattr(queue_module, "enqueue", fake_enqueue)
    return calls


async def test_dispatch_plan_inprocess_mode_schedules_task_not_enqueue(
    monkeypatch, run_id, record_create_task, record_enqueue
) -> None:
    monkeypatch.setattr(queue_module, "get_settings", lambda: FakeSettings("inprocess"))
    await queue_module.dispatch_plan(run_id)
    assert len(record_create_task) == 1
    assert record_enqueue == []


async def test_dispatch_execute_inprocess_mode_schedules_task_not_enqueue(
    monkeypatch, run_id, record_create_task, record_enqueue
) -> None:
    monkeypatch.setattr(queue_module, "get_settings", lambda: FakeSettings("inprocess"))
    await queue_module.dispatch_execute(run_id)
    assert len(record_create_task) == 1
    assert record_enqueue == []


async def test_dispatch_plan_arq_mode_enqueues_job(
    monkeypatch, run_id, record_create_task, record_enqueue
) -> None:
    monkeypatch.setattr(queue_module, "get_settings", lambda: FakeSettings("arq"))
    await queue_module.dispatch_plan(run_id)
    assert record_enqueue == [("run_plan_and_execute", (str(run_id),))]
    assert record_create_task == []


async def test_dispatch_execute_arq_mode_enqueues_job(
    monkeypatch, run_id, record_create_task, record_enqueue
) -> None:
    monkeypatch.setattr(queue_module, "get_settings", lambda: FakeSettings("arq"))
    await queue_module.dispatch_execute(run_id)
    assert record_enqueue == [("run_execute_run", (str(run_id),))]
    assert record_create_task == []


async def test_dispatch_plan_arq_mode_falls_back_on_enqueue_failure(
    monkeypatch, run_id, record_create_task
) -> None:
    monkeypatch.setattr(queue_module, "get_settings", lambda: FakeSettings("arq"))

    async def failing_enqueue(func_name, *args):
        raise ConnectionError("redis unreachable")

    monkeypatch.setattr(queue_module, "enqueue", failing_enqueue)
    await queue_module.dispatch_plan(run_id)
    assert len(record_create_task) == 1


async def test_dispatch_execute_arq_mode_falls_back_on_enqueue_failure(
    monkeypatch, run_id, record_create_task
) -> None:
    monkeypatch.setattr(queue_module, "get_settings", lambda: FakeSettings("arq"))

    async def failing_enqueue(func_name, *args):
        raise ConnectionError("redis unreachable")

    monkeypatch.setattr(queue_module, "enqueue", failing_enqueue)
    await queue_module.dispatch_execute(run_id)
    assert len(record_create_task) == 1


async def test_dispatch_plan_tracks_task_then_discards_it_on_completion(
    monkeypatch, run_id
) -> None:
    """Bug 4: with the REAL asyncio.create_task (record_create_task is
    deliberately not used here), the scheduled task must be retained in
    queue_module._background_tasks — keyed by run_id, since Bug 3's
    shutdown drain needs that mapping — while it's in flight, and removed
    once it finishes. Without this, the task's only reference is the event
    loop's weak set and CPython may garbage-collect it mid-execution."""
    monkeypatch.setattr(queue_module, "get_settings", lambda: FakeSettings("inprocess"))

    started = asyncio.Event()

    async def fake_plan_and_execute(_run_id):
        started.set()

    monkeypatch.setattr(queue_module, "plan_and_execute", fake_plan_and_execute)

    assert run_id not in queue_module._background_tasks.values()
    await queue_module.dispatch_plan(run_id)

    # Tracked immediately, before the task has necessarily finished.
    assert run_id in queue_module._background_tasks.values()

    await started.wait()
    # The done-callback that pops the dict entry runs on a later loop tick
    # than the coroutine's own final statement — give it a couple of ticks.
    for _ in range(50):
        if run_id not in queue_module._background_tasks.values():
            break
        await asyncio.sleep(0.01)

    assert run_id not in queue_module._background_tasks.values()
