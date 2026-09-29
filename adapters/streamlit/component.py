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


def askmoina_ui(data: dict):
    return _component(
        data=data,
        key="askmoina-main-ui",
        on_event_change=lambda: None,
    )
