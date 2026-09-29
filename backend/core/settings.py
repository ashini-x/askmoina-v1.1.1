from __future__ import annotations

import datetime
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ModeConfig:
    temp: float
    effort: str


class Settings:
    PRIMARY_MODEL = "openai/gpt-oss-120b"
    LIVE_SEARCH_ALWAYS_ON = True
    SANDBOX_ALWAYS_ON = True
    MODE_CONFIG = {
        "logical": ModeConfig(temp=0.0, effort="high"),
        "auto": ModeConfig(temp=0.3, effort="medium"),
        "creative": ModeConfig(temp=0.7, effort="low"),
    }

    @property
    def GROQ_API_KEY(self) -> str:
        return os.getenv("GROQ_API_KEY", "")

    @property
    def E2B_API_KEY(self) -> str:
        return os.getenv("E2B_API_KEY", "")

    @property
    def CURRENT_DATETIME(self) -> str:
        now = datetime.datetime.now(datetime.timezone.utc)
        return now.strftime("%A, %B %d, %Y at %I:%M:%S %p %Z")


settings = Settings()
