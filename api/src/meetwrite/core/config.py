"""Environment-backed process configuration."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="MEETWRITE_",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = "sqlite:///meetwrite.db"
    audio_dir: str = "audio"
    log_level: str = "INFO"
    chat_model: str = "gpt-4.1"
    transcribe_model: str = "gpt-live-transcribe"
    # Small single-purpose jobs (title suggestion) use the cheap model.
    utility_model: str = "gpt-5-nano"
    ai_timeout_seconds: float = Field(default=120, gt=0)
    transcription_event_timeout_seconds: float = Field(default=10, gt=0)
    chat_context_characters: int = Field(default=60_000, gt=0)
    enhance_context_characters: int = Field(default=60_000, gt=0)
