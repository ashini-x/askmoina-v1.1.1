# Architecture

```text
Browser
  │
  ▼
frontend/
  │  trigger events
  ▼
adapters/streamlit/
  │
  ▼
streamlit_app.py
  │
  ▼
backend/application/chat_service.py
  ├── backend/security/guardrails.py
  ├── backend/tools/search.py
  ├── backend/ai/orchestrator.py
  └── backend/tools/sandbox.py
```

The only Streamlit-specific code is the hosting adapter and secret lookup. This keeps the frontend/backend boundaries clean so the same application logic can later be exposed through FastAPI or another runtime without redesigning the UI.
