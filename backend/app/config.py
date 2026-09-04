"""Application configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings.

    A regular SQLAlchemy URL keeps local SQLite and hosted Postgres configuration
    interchangeable without changing application code.
    """

    database_url: str = "sqlite:///./myjourn.db"

    @field_validator("database_url", mode="before")
    @classmethod
    def assemble_db_connection(cls, v: str) -> str:
        if isinstance(v, str) and v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v
    openai_api_key: Optional[str] = None
    openai_model: str = "gpt-5.5"
    openai_fast_model: str = "gpt-4o-mini"

    supabase_url: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_URL", "VITE_SUPABASE_URL", "MYJOURN_SUPABASE_URL"),
    )
    supabase_jwt_secret: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_JWT_SECRET", "MYJOURN_SUPABASE_JWT_SECRET"),
    )

    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None
    google_redirect_uri: str = "https://genfm.app/api/auth/google/callback"
    # Where to send the browser back to after the Google OAuth consent screen.
    google_post_auth_redirect: str = "https://genfm.app/"
    google_calendar_id: str = "primary"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="MYJOURN_", extra="ignore")

    @property
    def google_oauth_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def supabase_hs256_secret(self) -> Optional[str]:
        """Legacy HS256 signing secret, or None when the value is an API key.

        Supabase's newer ``sb_secret_…``/``sb_publishable_…`` values are API
        keys rather than JWT signing secrets. Accepting one here would leave
        HS256 verification permanently failing for a very non-obvious reason.
        """

        secret = (self.supabase_jwt_secret or "").strip()
        if not secret or secret.startswith(("sb_secret_", "sb_publishable_", "sbp_")):
            return None
        return secret


@lru_cache
def get_settings() -> Settings:
    return Settings()
