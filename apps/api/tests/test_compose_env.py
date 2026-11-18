"""Guard docker/compose.full.yaml against the blank-secret trap.

Compose interpolates `${FOO}` / `${FOO:-}` from docker/.env or the host
shell -- never from the `env_file:` a service lists -- and a service's
`environment:` block wins over its `env_file:`. So a line such as
`FREE_LLM_KEY: ${FREE_LLM_KEY:-}` on a service that also reads ../.env
silently replaces the real key from ../.env with an empty string whenever
the shell doesn't happen to export it. The api and worker shipped with
exactly those lines for the LLM provider, key and model: the web container
looked healthy and every agent run failed.

Pure file parsing: no Docker, no database.
"""

from pathlib import Path

import yaml

COMPOSE_FILE = Path(__file__).resolve().parents[3] / "docker" / "compose.full.yaml"


def _services() -> dict:
    return yaml.safe_load(COMPOSE_FILE.read_text())["services"]


def test_compose_file_is_where_this_test_expects():
    assert COMPOSE_FILE.is_file(), COMPOSE_FILE


def test_env_file_services_never_interpolate_their_environment():
    offenders = []
    for name, service in _services().items():
        if not service.get("env_file"):
            continue
        environment = service.get("environment") or {}
        if isinstance(environment, list):  # "KEY=value" list form
            environment = dict(item.split("=", 1) for item in environment)
        for key, value in environment.items():
            if isinstance(value, str) and "${" in value:
                offenders.append(f"{name}.environment.{key} = {value!r}")
    assert not offenders, (
        "These lines override the value from ../.env with whatever the host "
        "shell has (usually nothing). Delete them and let env_file supply the "
        "value:\n  " + "\n  ".join(offenders)
    )


def test_llm_settings_reach_api_and_worker_only_through_env_file():
    for name in ("api", "worker"):
        service = _services()[name]
        assert "../.env" in service["env_file"], name
        environment = service.get("environment") or {}
        for key in ("FREE_LLM_BASE_URL", "FREE_LLM_KEY", "DEFAULT_MODEL"):
            assert key not in environment, f"{name} must not redeclare {key}"
