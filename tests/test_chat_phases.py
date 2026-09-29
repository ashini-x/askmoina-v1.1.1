from __future__ import annotations

import sys
import types

# Lightweight dependency shims for this pure orchestration test.
if "groq" not in sys.modules:
    sys.modules["groq"] = types.SimpleNamespace(Groq=object)
if "duckduckgo_search" not in sys.modules:
    sys.modules["duckduckgo_search"] = types.SimpleNamespace(DDGS=object)
if "e2b_code_interpreter" not in sys.modules:
    sys.modules["e2b_code_interpreter"] = types.SimpleNamespace(Sandbox=object)

from backend.application.chat_service import ChatService
import backend.application.chat_service as chat_module


class FakeChunk:
    class _Choices:
        def __init__(self, content):
            self.delta = types.SimpleNamespace(content=content)

    def __init__(self, content):
        self.choices = [self._Choices(content)]


class FakeOrchestrator:
    def run_tier1_synthesis(self, **_kwargs):
        return "Draft answer"

    def run_tier2_audit_stream(self, **_kwargs):
        return iter([FakeChunk("Final "), FakeChunk("answer")])


def test_chat_service_emits_original_status_sequence_without_sandbox(monkeypatch):
    monkeypatch.setattr(chat_module, "web_search", lambda _prompt: "search context")
    service = ChatService(orchestrator=FakeOrchestrator())
    phases = []

    result = service.run(
        prompt="Explain this",
        messages_history=[{"role": "user", "content": "Explain this"}],
        mode_key="auto",
        on_phase=lambda phase, label: phases.append((phase, label)),
    )

    assert [label for _, label in phases] == [
        "Initializing AskMoina Engine",
        "Indexing Real-Time Knowledge Base",
        "Synthesizing Neural Reasoning",
        "Executing Precision Audit",
        "Verification and Audit Complete",
    ]
    assert result.final_content == "Final answer"


def test_chat_service_emits_sandbox_phase_when_python_is_detected(monkeypatch):
    monkeypatch.setattr(chat_module, "web_search", lambda _prompt: "search context")

    class CodeOrchestrator(FakeOrchestrator):
        def run_tier1_synthesis(self, **_kwargs):
            return "```python\nprint(2 + 2)\n```"

    monkeypatch.setattr(
        chat_module,
        "run_python_sandbox",
        lambda _code: {"status": "success", "stdout": "4", "stderr": ""},
    )
    service = ChatService(orchestrator=CodeOrchestrator())
    phases = []

    service.run(
        prompt="Calculate",
        messages_history=[{"role": "user", "content": "Calculate"}],
        mode_key="auto",
        on_phase=lambda phase, label: phases.append((phase, label)),
    )

    assert "Performing Sandbox Verification" in [label for _, label in phases]
