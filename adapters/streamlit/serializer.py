from __future__ import annotations

from backend.markdown import render_markdown


def build_ui_state(
    *,
    messages: list[dict],
    mode: str,
    history: list[dict],
    active_conversation_id: str,
    error: str | None,
    workflow: dict | None = None,
) -> dict:
    serialized = []
    for message in messages:
        item = {"role": message["role"], "content": message["content"]}
        if message["role"] == "assistant":
            item["html"] = render_markdown(message["content"])
        serialized.append(item)

    return {
        "mode": mode,
        "capabilities": {"web_grounding": True, "code_sandbox": True},
        "messages": serialized,
        "history": [
            {
                "id": item["id"],
                "title": item["title"],
                "updated_at": item.get("updated_at", ""),
                "active": item["id"] == active_conversation_id,
            }
            for item in history
        ],
        "active_conversation_id": active_conversation_id,
        "error": error,
        "workflow": workflow
        or {
            "active": False,
            "status": "idle",
            "job_id": None,
            "phase": "idle",
            "label": "",
            "error": None,
            "response_ready": False,
        },
    }
