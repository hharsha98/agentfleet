import pytest

from app.services.orchestrator import parse_plan

SLUGS = {"orchestrator", "deep-research", "creative-writer"}


def test_parse_plan_happy_path() -> None:
    text = (
        '{"tasks": [{"title": "Research", "description": "Find facts", '
        '"agent": "deep-research", "depends_on": [], "needs_approval": false}, '
        '{"title": "Write", "description": "Draft post", "agent": "creative-writer", '
        '"depends_on": [0], "needs_approval": true}]}'
    )
    plan = parse_plan(text, SLUGS)
    assert len(plan) == 2
    assert plan[0]["agent_slug"] == "deep-research"
    assert plan[1]["depends_on"] == [0]
    assert plan[1]["needs_approval"] is True


def test_parse_plan_tolerates_fences_and_bad_agents() -> None:
    text = '```json\n{"tasks": [{"title": "X", "agent": "nonexistent", "depends_on": [5]}]}\n```'
    plan = parse_plan(text, SLUGS)
    assert plan[0]["agent_slug"] == "orchestrator"  # unknown agent falls back
    assert plan[0]["depends_on"] == []  # forward/invalid deps dropped


def test_parse_plan_rejects_garbage() -> None:
    with pytest.raises(ValueError):
        parse_plan("sorry, I cannot help with that", SLUGS)
    with pytest.raises(ValueError):
        parse_plan('{"tasks": []}', SLUGS)
