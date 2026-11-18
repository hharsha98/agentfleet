"""On the public demo every visitor is the same identity, so the shared
sandbox agent must survive any one visitor pressing Delete."""

from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.db import SessionLocal, engine
from app.main import app
from app.routes.agents import DEMO_SANDBOX_SLUG
from scripts.seed_demo_user import SANDBOX_AGENT_SLUG, _seed
from tests.conftest import mint_token
from scripts.seed_demo_user import DEMO_EMAIL


def test_slug_constant_matches_the_seed_script():
    assert DEMO_SANDBOX_SLUG == SANDBOX_AGENT_SLUG


async def _seed_demo() -> None:
    await engine.dispose()
    async with SessionLocal() as session:
        await _seed(session)


async def _sandbox_id(client) -> str:
    agents = (await client.get("/api/v1/agents")).json()
    return next(a["id"] for a in agents if a["slug"] == DEMO_SANDBOX_SLUG)


async def test_demo_visitor_cannot_delete_the_shared_sandbox(monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_login_enabled", True)
    await _seed_demo()
    headers = {"Authorization": f"Bearer {mint_token(DEMO_EMAIL)}"}
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers=headers
    ) as client:
        sandbox_id = await _sandbox_id(client)
        resp = await client.delete(f"/api/v1/agents/{sandbox_id}")
        assert resp.status_code == 403
        assert "shared demo sandbox" in resp.json()["detail"]
        assert any(a["id"] == sandbox_id for a in (await client.get("/api/v1/agents")).json())
    await engine.dispose()


async def test_private_instance_owner_can_still_delete_it(monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_login_enabled", False)
    await _seed_demo()
    headers = {"Authorization": f"Bearer {mint_token(DEMO_EMAIL)}"}
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers=headers
    ) as client:
        sandbox_id = await _sandbox_id(client)
        resp = await client.delete(f"/api/v1/agents/{sandbox_id}")
        assert resp.status_code == 200
    await engine.dispose()
