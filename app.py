from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

import streamlit as st

from adapters.streamlit.component import askmoina_ui
from adapters.streamlit.serializer import build_ui_state
from backend.application.chat_service import ChatService
from backend.application.jobs import job_manager
from backend.security.guardrails import SecurityGuard


# AskMoina runs as one Streamlit deployment today. The custom frontend is the
# presentation layer; all model/tool credentials remain server-side secrets.
def _load_streamlit_secrets() -> None:
    for key in ("GROQ_API_KEY", "E2B_API_KEY"):
        if os.getenv(key):
            continue
        try:
            value = st.secrets.get(key, "")
        except Exception:
            value = ""
        if value:
            os.environ[key] = str(value)


_load_streamlit_secrets()

st.set_page_config(
    page_title="AskMoina",
    page_icon="•",
    layout="wide",
    initial_sidebar_state="collapsed",
    menu_items={},
)

st.markdown(
    """
    <style>
      #MainMenu,
      footer,
      header[data-testid="stHeader"],
      [data-testid="stToolbar"],
      [data-testid="stStatusWidget"],
      [data-testid="stDecoration"],
      [data-testid="stAppDeployButton"] { display: none !important; }
      html, body, [data-testid="stAppViewContainer"], [data-testid="stApp"] {
        background: #070707;
        overflow: hidden !important;
      }
      [data-testid="stAppViewContainer"],
      [data-testid="stApp"] { background: #070707; }
      section.main > div.block-container {
        max-width: none;
        padding: 0 !important;
      }
      div[data-testid="stDecoration"] { display: none; }
    </style>
    """,
    unsafe_allow_html=True,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_state() -> None:
    defaults = {
        "messages": [],
        "mode": "auto",
        "conversation_id": str(uuid.uuid4()),
        "conversations": [],
        "error": None,
        "active_job_id": None,
        "finalized_job_ids": set(),
        "service": None,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def _get_service() -> ChatService:
    if st.session_state.service is None:
        st.session_state.service = ChatService()
    return st.session_state.service


def _save_current_conversation() -> None:
    if not st.session_state.messages:
        return

    conversation_id = st.session_state.conversation_id
    first_user = next(
        (m["content"] for m in st.session_state.messages if m["role"] == "user"),
        "New conversation",
    )
    existing = next(
        (c for c in st.session_state.conversations if c["id"] == conversation_id),
        None,
    )
    title = first_user.strip().replace("\n", " ")[:72] or "New conversation"
    payload = {
        "id": conversation_id,
        "title": title,
        "updated_at": _now_iso(),
        "messages": list(st.session_state.messages),
    }
    if existing:
        existing.update(payload)
    else:
        st.session_state.conversations.insert(0, payload)
        st.session_state.conversations = st.session_state.conversations[:50]


def _start_new_conversation() -> None:
    if st.session_state.active_job_id:
        return
    _save_current_conversation()
    st.session_state.messages = []
    st.session_state.conversation_id = str(uuid.uuid4())
    st.session_state.error = None


def _load_conversation(conversation_id: str) -> None:
    if st.session_state.active_job_id:
        return
    _save_current_conversation()
    target = next(
        (c for c in st.session_state.conversations if c["id"] == conversation_id),
        None,
    )
    if not target:
        return
    st.session_state.conversation_id = target["id"]
    st.session_state.messages = list(target["messages"])
    st.session_state.error = None


def _rename_conversation(conversation_id: str, title: str) -> None:
    for conversation in st.session_state.conversations:
        if conversation["id"] == conversation_id:
            conversation["title"] = title.strip()[:72] or "Untitled conversation"
            conversation["updated_at"] = _now_iso()
            break


def _delete_conversation(conversation_id: str) -> None:
    if st.session_state.active_job_id:
        return
    st.session_state.conversations = [
        c for c in st.session_state.conversations if c["id"] != conversation_id
    ]
    if st.session_state.conversation_id == conversation_id:
        st.session_state.messages = []
        st.session_state.conversation_id = str(uuid.uuid4())


def _start_chat_job(prompt: str, mode_key: str, operation: str) -> None:
    if st.session_state.active_job_id:
        return

    clean_prompt = SecurityGuard.sanitize_input(prompt)
    st.session_state.error = None

    if operation == "submit":
        st.session_state.messages.append({"role": "user", "content": clean_prompt})
        history = list(st.session_state.messages)
    else:
        history = list(st.session_state.messages)
        if history and history[-1]["role"] == "assistant":
            history = history[:-1]

    try:
        job_id = job_manager.start(
            service=_get_service(),
            prompt=clean_prompt,
            messages_history=history,
            mode_key=mode_key,
            operation=operation,
        )
    except Exception as exc:
        st.session_state.error = str(exc)
        return

    st.session_state.mode = mode_key
    st.session_state.active_job_id = job_id


def _finalize_completed_job(job: dict) -> None:
    job_id = job["job_id"]
    if job_id in st.session_state.finalized_job_ids:
        return

    result = job_manager.get_result(job_id)
    if result is None:
        return

    if job["operation"] == "regenerate":
        if st.session_state.messages and st.session_state.messages[-1]["role"] == "assistant":
            st.session_state.messages[-1] = {
                "role": "assistant",
                "content": result.final_content,
            }
        else:
            st.session_state.messages.append(
                {"role": "assistant", "content": result.final_content}
            )
    else:
        st.session_state.messages.append(
            {"role": "assistant", "content": result.final_content}
        )

    st.session_state.finalized_job_ids.add(job_id)
    _save_current_conversation()


def _workflow_snapshot() -> dict:
    job = job_manager.get(st.session_state.active_job_id)
    if not job:
        return {
            "active": False,
            "status": "idle",
            "job_id": None,
            "phase": "idle",
            "label": "",
            "error": None,
            "sandbox_used": None,
            "search_used": None,
        }

    if job["status"] == "complete":
        _finalize_completed_job(job)
        return {
            **job,
            "active": True,
            "response_ready": True,
        }

    if job["status"] == "error":
        st.session_state.error = job.get("error") or job.get("label")
        return {
            **job,
            "active": False,
            "response_ready": False,
        }

    return {
        **job,
        "active": True,
        "response_ready": False,
    }


def _handle_event(event: dict) -> None:
    event_type = event.get("type")

    if event_type == "mode.select":
        st.session_state.mode = event.get("mode", "auto")
        return

    if event_type == "conversation.new":
        _start_new_conversation()
        return

    if event_type == "conversation.select":
        _load_conversation(str(event.get("conversation_id", "")))
        return

    if event_type == "conversation.rename":
        _rename_conversation(
            str(event.get("conversation_id", "")),
            str(event.get("title", "")),
        )
        _save_current_conversation()
        return

    if event_type == "conversation.delete":
        _delete_conversation(str(event.get("conversation_id", "")))
        return

    if event_type == "chat.submit":
        prompt = str(event.get("prompt", "")).strip()
        if prompt:
            _start_chat_job(prompt, event.get("mode", st.session_state.mode), "submit")
        return

    if event_type == "chat.regenerate":
        if st.session_state.messages and st.session_state.messages[-1]["role"] == "assistant":
            prompt = next(
                (
                    m["content"]
                    for m in reversed(st.session_state.messages[:-1])
                    if m["role"] == "user"
                ),
                "",
            )
            if prompt:
                _start_chat_job(prompt, st.session_state.mode, "regenerate")
        return

    if event_type == "ui.response_revealed":
        job_id = str(event.get("job_id", ""))
        if job_id and job_id == st.session_state.active_job_id:
            job_manager.finish(job_id)
            st.session_state.active_job_id = None
        return


_ensure_state()


@st.fragment(run_every=0.4)
def askmoina_runtime() -> None:
    """Render the custom UI and poll the backend job state without full-app churn."""
    workflow = _workflow_snapshot()

    data = build_ui_state(
        messages=st.session_state.messages,
        mode=st.session_state.mode,
        history=st.session_state.conversations,
        active_conversation_id=st.session_state.conversation_id,
        error=st.session_state.error,
        workflow=workflow,
    )

    ui_result = askmoina_ui(data)
    event = getattr(ui_result, "event", None) if ui_result is not None else None
    if not event:
        return

    if isinstance(event, dict):
        payload = event
    else:
        try:
            payload = json.loads(event)
        except (TypeError, json.JSONDecodeError):
            return

    _handle_event(payload)


askmoina_runtime()
