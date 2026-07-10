from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://agentfleet:agentfleet@localhost:5432/agentfleet"
    redis_url: str = "redis://localhost:6379/0"

    free_llm_base_url: str = "http://localhost:3001/v1"
    free_llm_key: str = ""
    default_model: str = "openai/gpt-oss-120b"
    # Tiered routing: strong model plans (the "brain"), cheap models execute.
    # Empty -> planning falls back to default_model.
    planner_model: str = ""

    anthropic_api_key: str = ""

    searxng_url: str = "http://localhost:8081"

    # Optional Langfuse tracing — leave empty to run without it.
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://cloud.langfuse.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
