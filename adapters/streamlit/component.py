from __future__ import annotations

from pathlib import Path

import streamlit as st

_COMPONENT_DIR = Path(__file__).resolve().parents[2] / "frontend"

HTML = (_COMPONENT_DIR / "index.html").read_text(encoding="utf-8")
CSS = (_COMPONENT_DIR / "styles.css").read_text(encoding="utf-8")
JS = (_COMPONENT_DIR / "app.js").read_text(encoding="utf-8")

_component = st.components.v2.component(
    "askmoina_ui",
    html=HTML,
    css=CSS,
    js=JS,
    isolate_styles=True,
)


_COMPONENT_KEY = "askmoina-main-ui"
_PENDING_EVENT_KEY = "_askmoina_pending_component_event"


def _capture_event() -> None:
    """Capture the transient trigger during the component rerun.

    Components v2 trigger callbacks run as part of Streamlit's rerun flow.
    Keeping the event in Session State avoids reading the trigger from the
    return object while the component is also being refreshed by a fragment.
    """
    component_state = st.session_state.get(_COMPONENT_KEY)
    event = None
    if component_state is not None:
        if isinstance(component_state, dict):
            event = component_state.get("event")
        else:
            event = getattr(component_state, "event", None)
    if event:
        st.session_state[_PENDING_EVENT_KEY] = event


def askmoina_ui(data: dict):
    return _component(
        data=data,
        key=_COMPONENT_KEY,
        width="stretch",
        height="stretch",
        on_event_change=_capture_event,
    )


def pop_pending_event():
    """Return and clear the next frontend event, if one exists."""
    return st.session_state.pop(_PENDING_EVENT_KEY, None)
