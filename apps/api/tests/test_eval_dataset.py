"""Dataset schema validation for the two hand-written eval case collections
(roadmap Half B: "dataset schema validation" is part of the deterministic
evals-offline gate — this must run in the normal pytest suite, not just
implicitly via a live eval run).

Pure, hermetic: no DB, no network, no provider. Just structural validation
of the Python literals in scripts/seed_evals.py::EVAL_CASES and
app/services/evals.py::RED_TEAM_CASES, so a case with a wrong key name or
type is caught at commit time instead of surfacing as a confusing runtime
KeyError deep inside run_eval/run_red_team.
"""

from app.services.evals import RED_TEAM_CASES
from scripts.seed_evals import EVAL_CASES

# EvalCase columns this dataset must satisfy (app/models.py::EvalCase):
# input: Text, expected_contains: JSONB list, forbidden_contains: JSONB
# list, judge_rubric: Text. RED_TEAM_CASES has no `expected_contains` (it
# only ever asserts on forbidden content / judge rubric — see
# app/services/evals.py::run_red_team, which never reads an
# expected_contains key), so that key is required for EVAL_CASES but NOT
# validated on RED_TEAM_CASES.
_REQUIRED_KEYS_EVAL_CASE = {"input", "expected_contains", "forbidden_contains", "judge_rubric"}
_REQUIRED_KEYS_RED_TEAM_CASE = {"input", "forbidden_contains", "judge_rubric"}


def _assert_common_shape(case: dict, *, context: str) -> None:
    assert isinstance(case["input"], str), f"{context}: 'input' must be a str"
    assert case["input"].strip(), f"{context}: 'input' must be non-empty"

    assert isinstance(case["forbidden_contains"], list), (
        f"{context}: 'forbidden_contains' must be a list"
    )
    assert all(isinstance(s, str) for s in case["forbidden_contains"]), (
        f"{context}: every 'forbidden_contains' entry must be a str"
    )

    assert isinstance(case["judge_rubric"], str), f"{context}: 'judge_rubric' must be a str"


# --- scripts/seed_evals.py::EVAL_CASES ----------------------------------------


def test_eval_cases_cover_at_least_one_case_per_agent() -> None:
    assert len(EVAL_CASES) > 0
    for slug, cases in EVAL_CASES.items():
        assert isinstance(cases, list) and len(cases) > 0, f"{slug}: no eval cases"


def test_eval_cases_required_keys_present() -> None:
    for slug, cases in EVAL_CASES.items():
        for i, case in enumerate(cases):
            context = f"EVAL_CASES[{slug!r}][{i}]"
            missing = _REQUIRED_KEYS_EVAL_CASE - case.keys()
            assert not missing, f"{context}: missing required key(s) {missing}"


def test_eval_cases_field_types() -> None:
    for slug, cases in EVAL_CASES.items():
        for i, case in enumerate(cases):
            context = f"EVAL_CASES[{slug!r}][{i}]"
            _assert_common_shape(case, context=context)
            assert isinstance(case["expected_contains"], list), (
                f"{context}: 'expected_contains' must be a list"
            )
            assert all(isinstance(s, str) for s in case["expected_contains"]), (
                f"{context}: every 'expected_contains' entry must be a str"
            )


def test_eval_cases_agent_slugs_are_unique_and_non_empty() -> None:
    slugs = list(EVAL_CASES.keys())
    assert len(slugs) == len(set(slugs)), "duplicate agent slug key in EVAL_CASES"
    assert all(isinstance(s, str) and s.strip() for s in slugs)


# --- app/services/evals.py::RED_TEAM_CASES ------------------------------------


def test_red_team_cases_non_empty() -> None:
    assert len(RED_TEAM_CASES) > 0


def test_red_team_cases_required_keys_present() -> None:
    for i, case in enumerate(RED_TEAM_CASES):
        context = f"RED_TEAM_CASES[{i}]"
        missing = _REQUIRED_KEYS_RED_TEAM_CASE - case.keys()
        assert not missing, f"{context}: missing required key(s) {missing}"


def test_red_team_cases_field_types() -> None:
    for i, case in enumerate(RED_TEAM_CASES):
        _assert_common_shape(case, context=f"RED_TEAM_CASES[{i}]")


def test_red_team_cases_assert_something() -> None:
    # Every red-team case must be checkable by at least one mechanism
    # (a forbidden substring or a judge rubric) — a case with neither
    # would always "pass" vacuously, silently providing zero coverage.
    for i, case in enumerate(RED_TEAM_CASES):
        has_forbidden = bool(case["forbidden_contains"])
        has_rubric = bool(case["judge_rubric"].strip())
        assert has_forbidden or has_rubric, (
            f"RED_TEAM_CASES[{i}]: neither forbidden_contains nor judge_rubric set — "
            "this case can never fail"
        )
