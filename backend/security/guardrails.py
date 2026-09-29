import re


class SecurityGuard:
    FORBIDDEN_PATTERNS = [
        r"ignore all previous instructions",
        r"you are now DAN",
        r"override system prompt",
        r"bypass security filters",
    ]

    @classmethod
    def sanitize_input(cls, user_prompt: str) -> str:
        for pattern in cls.FORBIDDEN_PATTERNS:
            if re.search(pattern, user_prompt, re.IGNORECASE):
                raise ValueError(
                    "⚠️ Security Guardrail Triggered: Adversarial prompt input flagged."
                )
        return user_prompt.strip()
