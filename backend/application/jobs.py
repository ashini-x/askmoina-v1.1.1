from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Callable
from uuid import uuid4

from backend.application.chat_service import ChatResult, ChatService, RateLimitError


@dataclass
class JobState:
    job_id: str
    operation: str
    status: str = "running"
    phase: str = "initializing"
    label: str = "Initializing AskMoina Engine"
    result: ChatResult | None = None
    error: str | None = None
    error_label: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    phase_seq: int = 0
    phase_events: list[dict] = field(default_factory=list)

    def snapshot(self) -> dict:
        return {
            "job_id": self.job_id,
            "operation": self.operation,
            "status": self.status,
            "phase": self.phase,
            "label": self.label,
            "error": self.error,
            "error_label": self.error_label,
            "search_used": self.result.search_used if self.result else None,
            "sandbox_used": self.result.sandbox_used if self.result else None,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "phase_events": list(self.phase_events),
        }


class ChatJobManager:
    """Small process-local job manager used by the Streamlit hosting adapter."""

    def __init__(self, max_workers: int = 4) -> None:
        self._jobs: dict[str, JobState] = {}
        self._lock = Lock()
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="askmoina-chat",
        )

    def start(
        self,
        *,
        service: ChatService,
        prompt: str,
        messages_history: list[dict],
        mode_key: str,
        operation: str = "submit",
    ) -> str:
        job_id = str(uuid4())
        with self._lock:
            self._jobs[job_id] = JobState(job_id=job_id, operation=operation)

        self._executor.submit(
            self._run,
            job_id,
            service,
            prompt,
            messages_history,
            mode_key,
        )
        return job_id

    def get(self, job_id: str | None) -> dict | None:
        if not job_id:
            return None
        with self._lock:
            job = self._jobs.get(job_id)
            return job.snapshot() if job else None

    def get_result(self, job_id: str | None) -> ChatResult | None:
        if not job_id:
            return None
        with self._lock:
            job = self._jobs.get(job_id)
            return job.result if job else None

    def finish(self, job_id: str | None) -> None:
        if not job_id:
            return
        with self._lock:
            self._jobs.pop(job_id, None)

    def _update_phase(self, job_id: str, phase: str, label: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.status = "running"
            job.phase = phase
            job.label = label
            job.phase_seq += 1
            job.phase_events.append({
                "seq": job.phase_seq,
                "phase": phase,
                "label": label,
                "at": datetime.now(timezone.utc).isoformat(),
            })
            job.updated_at = datetime.now(timezone.utc).isoformat()

    def _run(
        self,
        job_id: str,
        service: ChatService,
        prompt: str,
        messages_history: list[dict],
        mode_key: str,
    ) -> None:
        def on_phase(phase: str, label: str) -> None:
            self._update_phase(job_id, phase, label)

        try:
            result = service.run(
                prompt=prompt,
                messages_history=messages_history,
                mode_key=mode_key,
                on_phase=on_phase,
            )
            with self._lock:
                job = self._jobs.get(job_id)
                if job:
                    job.result = result
                    job.status = "complete"
                    job.phase = "complete"
                    job.label = "Verification and Audit Complete"
                    if not job.phase_events or job.phase_events[-1].get("phase") != "complete":
                        job.phase_seq += 1
                        job.phase_events.append({
                            "seq": job.phase_seq,
                            "phase": "complete",
                            "label": "Verification and Audit Complete",
                            "at": datetime.now(timezone.utc).isoformat(),
                        })
                    job.updated_at = datetime.now(timezone.utc).isoformat()
        except RateLimitError as exc:
            with self._lock:
                job = self._jobs.get(job_id)
                if job:
                    job.status = "error"
                    job.phase = "rate_limit"
                    job.label = "Rate Limit Reached"
                    job.error_label = "Rate Limit Reached"
                    job.error = str(exc)
                    job.updated_at = datetime.now(timezone.utc).isoformat()
        except Exception as exc:
            with self._lock:
                job = self._jobs.get(job_id)
                if job:
                    job.status = "error"
                    job.phase = "error"
                    job.label = "Synthesis Execution Failed"
                    job.error_label = "Synthesis Execution Failed"
                    job.error = str(exc)
                    job.updated_at = datetime.now(timezone.utc).isoformat()


job_manager = ChatJobManager()
