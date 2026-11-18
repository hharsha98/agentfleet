"""A blank DEFAULT_MODEL must never reach an agent row.

An empty env var is a real value to pydantic-settings, and compose used to
hand the api/worker DEFAULT_MODEL="" (see tests/test_compose_env.py). Every
built-in agent was then seeded with model "" and every provider call
failed. Two guards: Settings treats a blank DEFAULT_MODEL as unset, and the
seed scripts repair a blank model on rows that already exist.
"""

from sqlalchemy import select, update

from app.config import DEFAULT_MODEL_FALLBACK, Settings, get_settings
from app.db import SessionLocal, engine
from app.models import Agent


def test_blank_default_model_falls_back_to_declared_default(monkeypatch):
    monkeypatch.setenv("DEFAULT_MODEL", "")
    assert Settings().default_model == DEFAULT_MODEL_FALLBACK
    monkeypatch.setenv("DEFAULT_MODEL", "   ")
    assert Settings().default_model == DEFAULT_MODEL_FALLBACK


def test_real_default_model_is_kept(monkeypatch):
    monkeypatch.setenv("DEFAULT_MODEL", "acme/some-model")
    assert Settings().default_model == "acme/some-model"


def test_llm_configured_needs_a_real_endpoint_url():
    assert not Settings(free_llm_base_url="", free_llm_key="k").llm_configured
    assert not Settings(free_llm_base_url="   ", free_llm_key="k").llm_configured
    assert not Settings(free_llm_base_url="llm.example/v1", free_llm_key="k").llm_configured
    assert Settings(free_llm_base_url="https://llm.example/v1", free_llm_key="k").llm_configured
    # No key is allowed: local OpenAI-compatible servers (Ollama) need none.
    assert Settings(free_llm_base_url="http://localhost:11434/v1", free_llm_key="").llm_configured


async def test_seed_agents_repairs_blank_model_but_keeps_a_chosen_one():
    from scripts import seed_agents

    await engine.dispose()
    async with SessionLocal() as session:
        await session.execute(update(Agent).where(Agent.slug == "creative-writer").values(model=""))
        await session.execute(
            update(Agent).where(Agent.slug == "system-architect").values(model="acme/picked")
        )
        await session.commit()

    await seed_agents.main()

    async with SessionLocal() as session:
        models = dict(
            (await session.execute(select(Agent.slug, Agent.model))).tuples().all()
        )
    assert models["creative-writer"] == get_settings().default_model
    assert models["system-architect"] == "acme/picked"
    await engine.dispose()
