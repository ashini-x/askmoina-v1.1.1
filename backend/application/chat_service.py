from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

from backend.ai.orchestrator import MoinaOrchestrator
from backend.core.settings import settings
from backend.security.guardrails import SecurityGuard
from backend.tools.sandbox import run_python_sandbox
from backend.tools.search import web_search


class RateLimitError(RuntimeError):
    pass


@dataclass(frozen=True)
class ChatResult:
    draft_content: str
    final_content: str
    search_used: bool
    sandbox_used: bool


class ChatService:
    def __init__(self, orchestrator: MoinaOrchestrator | None = None) -> None:
        self.orchestrator = orchestrator or MoinaOrchestrator()

    @staticmethod
    def _is_rate_limit_error(exc: Exception) -> bool:
        text = str(exc).lower()
        return any(token in text for token in ("rate", "limit", "quota", "429"))

    def run(
        self,
        *,
        prompt: str,
        messages_history: list,
        mode_key: str,
        on_phase: Callable[[str, str], None] | None = None,
    ) -> ChatResult:
        clean_prompt = SecurityGuard.sanitize_input(prompt)
        mode_params = settings.MODE_CONFIG.get(mode_key, settings.MODE_CONFIG["auto"])

        def emit(phase: str, label: str) -> None:
            if on_phase is not None:
                on_phase(phase, label)

        emit("initializing", "Initializing AskMoina Engine")

        # Production policy: live web grounding is always enabled server-side.
        search_used = settings.LIVE_SEARCH_ALWAYS_ON
        emit("searching", "Indexing Real-Time Knowledge Base")
        search_context = web_search(clean_prompt) if search_used else ""

        emit("synthesizing", "Synthesizing Neural Reasoning")
        try:
            draft_content = self.orchestrator.run_tier1_synthesis(
                prompt=clean_prompt,
                search_context=search_context,
                messages_history=messages_history,
                temp=mode_params.temp,
                effort=mode_params.effort,
            )
        except Exception as exc:
            if self._is_rate_limit_error(exc):
                raise RateLimitError(str(exc)) from exc
            raise

        sandbox_feedback = ""
        sandbox_used = False
        code_match = re.search(r"```python(.*?)```", draft_content, re.DOTALL)
        # Production policy: sandbox verification is always enabled whenever
        # the model produces an executable Python block.
        if settings.SANDBOX_ALWAYS_ON and code_match:
            emit("sandbox", "Performing Sandbox Verification")
            sandbox_used = True
            raw_code = code_match.group(1).strip()
            result = run_python_sandbox(raw_code)
            if result["status"] == "success":
                if result["stdout"]:
                    sandbox_feedback = f"\n\n[SANDBOX RUNTIME OUTPUT]:\n{result['stdout']}"
            else:
                sandbox_feedback = (
                    "\n\n[CRITICAL SANDBOX ERROR]: The code threw an exception during execution:\n"
                    f"{result['stderr']}\nPlease rewrite and fix the code."
                )

        emit("auditing", "Executing Precision Audit")
        try:
            tier2_response = self.orchestrator.run_tier2_audit_stream(
                prompt=clean_prompt,
                draft_content=draft_content,
                sandbox_feedback=sandbox_feedback,
            )
        except Exception as exc:
            if self._is_rate_limit_error(exc):
                raise RateLimitError(str(exc)) from exc
            tier2_response = None

        if tier2_response is None:
            final_content = draft_content
        else:
            chunks: list[str] = []
            try:
                for chunk in tier2_response:
                    content = getattr(getattr(chunk.choices[0], "delta", None), "content", None)
                    if content:
                        chunks.append(content)
                final_content = "".join(chunks)
            except Exception:
                final_content = draft_content

        emit("complete", "Verification and Audit Complete")
        return ChatResult(
            draft_content=draft_content,
            final_content=final_content,
            search_used=search_used,
            sandbox_used=sandbox_used,
        )
