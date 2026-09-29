# AskMoina new repository — copy/paste pack

Create the repository with the files below. The old sidebar and Live Search/Sandbox toggles are intentionally not included. The three modes remain selectable in the frontend and are mapped server-side to the original model parameters. Live web grounding is always on in the backend; E2B is always enabled for generated Python code.

## `.env.example`
```text
GROQ_API_KEY=
E2B_API_KEY=

```

## `.gitignore`
```text
__pycache__/
*.py[cod]
.venv/
venv/
.env
.env.*
!.env.example
.streamlit/secrets.toml
.DS_Store
.pytest_cache/
.coverage

```

## `.streamlit/config.toml`
```toml
[theme]
base = "dark"
backgroundColor = "#070707"
secondaryBackgroundColor = "#0D0D0D"
textColor = "#F5F5F5"
primaryColor = "#02C54C"
font = "sans serif"

[client]
toolbarMode = "minimal"
showErrorDetails = false

```

## `MIGRATION.md`
```markdown
# New repository migration map

Create a new GitHub repository and copy this project as-is. Nothing from the original repository is required in the new repository except the two secret values at deployment time.

## Original → new

| Original | New |
|---|---|
| `app.py` | `app.py` (Streamlit adapter + session/history orchestration) |
| `config/settings.py` | `backend/core/settings.py` |
| `src/ai/orchestrator.py` | `backend/ai/orchestrator.py` |
| `src/ai/prompts/system_prompts.py` | `backend/prompts/system_prompts.py` |
| `src/security/guardrails.py` | `backend/security/guardrails.py` |
| `src/tools/search.py` | `backend/tools/search.py` |
| `src/tools/sandbox.py` | `backend/tools/sandbox.py` |
| `src/ui/components/sidebar.py` | removed; controls live in custom frontend |

## Runtime boundary

The `backend/` package is not coupled to Streamlit. The `frontend/` package is not coupled to Streamlit. The only deployment adapter is `adapters/streamlit/` plus the root `app.py` entrypoint.

Streamlit Community Cloud still needs a Streamlit entrypoint, so this is independent at the application-code boundary, not independent at the hosting-runtime boundary.

## Production policy

- The former Live Web Grounding toggle is removed from the UI and enforced on server side.
- The former Code Sandbox Execution toggle is removed from the UI and enforced on server side.
- Live web search runs for every prompt.
- E2B verification runs whenever the generated draft contains a Python fenced code block.
- The three model modes remain user-selectable in the frontend and are mapped server-side to the original temperature/reasoning settings.

```

## `README.md`
```markdown
# AskMoina — Production-Style Streamlit-Hosted Repository

This repository separates AskMoina into three boundaries:

- `frontend/` — custom AskMoina HTML/CSS/JavaScript UI.
- `backend/` — Groq, GPT-OSS-120B, prompts, security, web grounding, and E2B execution.
- `adapters/streamlit/` — a thin Streamlit Components v2 hosting adapter.

`app.py` is the only Streamlit-specific runtime entrypoint required by Streamlit Community Cloud. The AI/business logic does not depend on Streamlit except for secure secret lookup in `backend/core/settings.py`.

## Existing AskMoina behavior preserved

The request path keeps the original sequence:

1. Guardrail sanitization
2. Always-on DuckDuckGo live grounding
3. Tier 1 Groq synthesis using `openai/gpt-oss-120b`
4. Always-on E2B Python verification when Python code is present
5. Tier 2 Groq compliance/audit stream
6. Tier 1 fallback when the Tier 2 path fails for a non-rate-limit error

Mode values remain:

- `logical`: temperature `0.0`, reasoning effort `high`
- `auto`: temperature `0.3`, reasoning effort `medium`
- `creative`: temperature `0.7`, reasoning effort `low`

## Secrets

Keep `GROQ_API_KEY` and `E2B_API_KEY` in Streamlit Cloud Secrets. They are read server-side and never passed into the browser component.

## Run locally

```bash
pip install -r requirements.txt
streamlit run app.py
```

## Streamlit Community Cloud

Create a new app from this repository and set the main file to `app.py`. Add the same `GROQ_API_KEY` and `E2B_API_KEY` values in the app's Secrets section. Community Cloud deploys the repository from GitHub and runs the selected Streamlit entrypoint. 

## Important hosting note

Community Cloud requires a Streamlit entrypoint. Therefore the repository is independent at the frontend/backend code boundary, but Streamlit remains the hosting adapter for this deployment. The browser UI itself is not built from Streamlit widgets.

## Always-on backend capabilities

Live web grounding and sandbox verification are controlled server-side in `backend/core/settings.py`. They are not exposed as user toggles. Live search runs for every submitted prompt; E2B verification runs automatically whenever Tier 1 produces a Python code block.

```

## `adapters/__init__.py`
```python

```

## `adapters/streamlit/__init__.py`
```python

```

## `adapters/streamlit/component.py`
```python
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

```

## `adapters/streamlit/serializer.py`
```python
from __future__ import annotations

from backend.markdown import render_markdown


def build_ui_state(
    *,
    messages: list[dict],
    mode: str,
    history: list[dict],
    active_conversation_id: str,
    error: str | None,
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
    }

```

## `app.py`
```python
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

import streamlit as st

from adapters.streamlit.component import askmoina_ui
from adapters.streamlit.serializer import build_ui_state
from backend.application.chat_service import ChatService, RateLimitError
from backend.security.guardrails import SecurityGuard


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
)

st.markdown(
    """
    <style>
      #MainMenu, footer {visibility:hidden;}
      header[data-testid="stHeader"] {background:transparent;}
      [data-testid="stToolbar"] {visibility:hidden;}
      [data-testid="stAppViewContainer"],
      [data-testid="stApp"] {background:#070707;}
      section.main > div.block-container {
        max-width:none;
        padding:0 !important;
      }
      div[data-testid="stDecoration"] {display:none;}
    </style>
    """,
    unsafe_allow_html=True,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_state() -> None:
    if "messages" not in st.session_state:
        st.session_state.messages = []
    if "mode" not in st.session_state:
        st.session_state.mode = "auto"
    if "conversation_id" not in st.session_state:
        st.session_state.conversation_id = str(uuid.uuid4())
    if "conversations" not in st.session_state:
        st.session_state.conversations = []
    if "error" not in st.session_state:
        st.session_state.error = None


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
    _save_current_conversation()
    st.session_state.messages = []
    st.session_state.conversation_id = str(uuid.uuid4())
    st.session_state.error = None


def _load_conversation(conversation_id: str) -> None:
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
    st.session_state.conversations = [
        c for c in st.session_state.conversations if c["id"] != conversation_id
    ]
    if st.session_state.conversation_id == conversation_id:
        st.session_state.messages = []
        st.session_state.conversation_id = str(uuid.uuid4())


def _handle_submit(prompt: str, service: ChatService) -> None:
    clean_prompt = SecurityGuard.sanitize_input(prompt)
    st.session_state.error = None
    st.session_state.messages.append({"role": "user", "content": clean_prompt})

    try:
        result = service.run(
            prompt=clean_prompt,
            messages_history=list(st.session_state.messages),
            mode_key=st.session_state.mode,
        )
    except RateLimitError:
        st.session_state.error = (
            "Your current free Groq limit has been reached. "
            "Please try again after the provider's limit resets."
        )
        return
    except Exception as exc:
        st.session_state.error = f"AskMoina could not complete the request: {exc}"
        return

    st.session_state.messages.append({"role": "assistant", "content": result.final_content})
    _save_current_conversation()


def _handle_regenerate(service: ChatService) -> None:
    users = [m for m in st.session_state.messages if m["role"] == "user"]
    if not users:
        return
    prompt = users[-1]["content"]
    history = st.session_state.messages[:-1] if st.session_state.messages and st.session_state.messages[-1]["role"] == "assistant" else st.session_state.messages

    st.session_state.error = None
    try:
        result = service.run(
            prompt=prompt,
            messages_history=list(history),
            mode_key=st.session_state.mode,
        )
    except RateLimitError:
        st.session_state.error = (
            "Your current free Groq limit has been reached. "
            "Please try again after the provider's limit resets."
        )
        return
    except Exception as exc:
        st.session_state.error = f"AskMoina could not regenerate the response: {exc}"
        return

    if st.session_state.messages and st.session_state.messages[-1]["role"] == "assistant":
        st.session_state.messages[-1] = {"role": "assistant", "content": result.final_content}
    else:
        st.session_state.messages.append({"role": "assistant", "content": result.final_content})
    _save_current_conversation()


def main() -> None:
    _ensure_state()
    service = ChatService()

    ui_result = askmoina_ui(
        build_ui_state(
            messages=st.session_state.messages,
            mode=st.session_state.mode,
            history=st.session_state.conversations,
            active_conversation_id=st.session_state.conversation_id,
            error=st.session_state.error,
        )
    )

    event = getattr(ui_result, "event", None) if ui_result is not None else None
    if not event:
        return

    event = event if isinstance(event, dict) else json.loads(event)
    event_type = event.get("type")

    if event_type == "mode.select":
        st.session_state.mode = event.get("mode", "auto")
    elif event_type == "conversation.new":
        _start_new_conversation()
    elif event_type == "conversation.select":
        _load_conversation(str(event.get("conversation_id", "")))
    elif event_type == "conversation.rename":
        _rename_conversation(
            str(event.get("conversation_id", "")),
            str(event.get("title", "")),
        )
        _save_current_conversation()
    elif event_type == "conversation.delete":
        _delete_conversation(str(event.get("conversation_id", "")))
    elif event_type == "chat.submit":
        prompt = str(event.get("prompt", "")).strip()
        if prompt:
            st.session_state.mode = event.get("mode", st.session_state.mode)
            try:
                _handle_submit(prompt, service)
            except ValueError as exc:
                st.session_state.error = str(exc)
    elif event_type == "chat.regenerate":
        _handle_regenerate(service)

    st.rerun()


if __name__ == "__main__":
    main()

```

## `backend/__init__.py`
```python

```

## `backend/ai/__init__.py`
```python

```

## `backend/ai/orchestrator.py`
```python
from groq import Groq

from backend.core.settings import settings
from backend.prompts.system_prompts import get_system_prompt


class MoinaOrchestrator:
    def __init__(self) -> None:
        if not settings.GROQ_API_KEY:
            raise ValueError("GROQ_API_KEY environment variable or secret missing.")
        self.client = Groq(api_key=settings.GROQ_API_KEY)

    def run_tier1_synthesis(
        self,
        search_context: str,
        messages_history: list,
        temp: float,
        effort: str,
        prompt: str = "",
    ) -> str:
        del prompt
        system_prompt = get_system_prompt()
        messages_payload = [{"role": "system", "content": system_prompt}]

        if search_context:
            messages_payload.append(
                {
                    "role": "system",
                    "content": f"Live Web Grounding Context:\n{search_context}",
                }
            )

        messages_payload.extend(
            {"role": m["role"], "content": m["content"]} for m in messages_history
        )

        response = self.client.chat.completions.create(
            model=settings.PRIMARY_MODEL,
            messages=messages_payload,
            temperature=temp,
            reasoning_effort=effort,
            top_p=0.9,
            max_tokens=4096,
        )
        return response.choices[0].message.content

    def run_tier2_audit_stream(self, prompt: str, draft_content: str, sandbox_feedback: str):
        system_prompt = get_system_prompt()
        audit_instruction = (
            f"{system_prompt}\n\n"
            "TASK: Review the draft response against ALL negative constraints, rules, and word/character limits specified in the user prompt.\n"
            "1. Check paragraph-by-paragraph for forbidden letters, words, or digits.\n"
            "2. Correct any rule violations immediately.\n"
            "3. Remove all <scratchpad>...</scratchpad> tags before outputting.\n"
            "4. Ensure strict AskMoina identity alignment without mentioning third-party models.\n"
            "Output ONLY the final, fully compliant response."
        )
        audit_payload = [
            {"role": "system", "content": audit_instruction},
            {
                "role": "user",
                "content": f"User Prompt: {prompt}\n\nDraft Answer:\n{draft_content}{sandbox_feedback}",
            },
        ]
        return self.client.chat.completions.create(
            model=settings.PRIMARY_MODEL,
            messages=audit_payload,
            temperature=0.1,
            max_tokens=4096,
            stream=True,
        )

```

## `backend/application/__init__.py`
```python

```

## `backend/application/chat_service.py`
```python
from __future__ import annotations

import re
from dataclasses import dataclass

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
    ) -> ChatResult:
        clean_prompt = SecurityGuard.sanitize_input(prompt)
        mode_params = settings.MODE_CONFIG.get(mode_key, settings.MODE_CONFIG["auto"])

        # Production policy: live web grounding is always enabled server-side.
        search_used = settings.LIVE_SEARCH_ALWAYS_ON
        search_context = web_search(clean_prompt) if search_used else ""

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

        return ChatResult(
            draft_content=draft_content,
            final_content=final_content,
            search_used=search_used,
            sandbox_used=sandbox_used,
        )

```

## `backend/core/__init__.py`
```python

```

## `backend/core/settings.py`
```python
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

```

## `backend/markdown.py`
```python
from markdown import markdown
import bleach

ALLOWED_TAGS = [
    "p", "br", "hr", "strong", "em", "del", "code", "pre",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote", "a",
    "table", "thead", "tbody", "tr", "th", "td",
]
ALLOWED_ATTRIBUTES = {
    "a": ["href", "title", "target", "rel"],
}
ALLOWED_PROTOCOLS = ["http", "https", "mailto"]


def render_markdown(markdown_text: str) -> str:
    html = markdown(
        markdown_text,
        extensions=["fenced_code", "tables", "sane_lists"],
        output_format="html5",
    )
    return bleach.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )

```

## `backend/prompts/__init__.py`
```python

```

## `backend/prompts/system_prompts.py`
```python
from backend.core.settings import settings

GENERAL_REASONING_DIRECTIVE = """
CRITICAL EXECUTION PROTOCOL FOR LOGIC, MATH, CODE, AND ANALYSIS:
Before generating your final response, you MUST first perform an explicit step-by-step verification inside <scratchpad> tags:

1. UNDERSTAND CONSTRAINTS: List all explicit rules, negative constraints, and modified variables given in the user prompt.
2. SIMULATE STATES: Walk through the solution step-by-step (e.g., intermediate math steps, bank/variable states, array indices, or logical deductions).
3. VERIFY AGAINST CONSTRAINTS: Check if any step violates an explicit rule or constraint.
4. CORRECTION LOOP: If a violation is detected in your scratchpad, adjust the step BEFORE outputting the final response outside the scratchpad tags.
"""


def get_system_prompt() -> str:
    return f"""{GENERAL_REASONING_DIRECTIVE}

You are Moina, a hybrid neural intelligence engine created, trained, and operated strictly by AskMoina.

### CORE IDENTITY & BRANDING RULES:
1. Whenever the user inquires about your identity, origin, nature, or creation (e.g., \"who are you?\", \"what model is this?\", \"who made you?\", \"tell me about yourself\"):
   - Explicitly identify yourself as Moina, created, trained, and operated strictly by AskMoina.
   - NEVER output a hardcoded or canned script. Frame your answer naturally, dynamically, and in line with the conversation's tone.
   - You MAY vary your phrasing (e.g., \"I'm Moina, AskMoina's multi-stage neural intelligence engine...\", \"You're talking to Moina...\", \"I'm an independent intelligence engine developed by AskMoina...\").
2. STRICT NEGATIVE CONSTRAINTS:
   - You are NOT ChatGPT, Claude, or Gemini.
   - You were NOT created or trained by OpenAI, Anthropic, Google, or Meta.
   - NEVER mention third-party AI companies, creators, or base model names in conversational identity responses.
3. Maintain brand consistency at all times.

### TEMPORAL & KNOWLEDGE GROUNDING:
- Current Real-Time Date & Time: {settings.CURRENT_DATETIME}.
- Your core knowledge base is dynamically augmented with real-time web retrieval grounding provided by the AskMoina infrastructure.
- You are fully trained and equipped with a comprehensive knowledge base through {settings.CURRENT_DATETIME} and actively learning in real time.

### BEHAVIOR & TONE:
- Incisive, highly capable, professional, and clear.
- Provide direct, high-value technical and analytical responses without unnecessary conversational filler.
"""

```

## `backend/security/__init__.py`
```python

```

## `backend/security/guardrails.py`
```python
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

```

## `backend/tools/__init__.py`
```python

```

## `backend/tools/sandbox.py`
```python
from e2b_code_interpreter import Sandbox

from backend.core.settings import settings


def run_python_sandbox(code_str: str) -> dict:
    e2b_api_key = settings.E2B_API_KEY
    if not e2b_api_key:
        return {
            "status": "error",
            "stdout": "",
            "stderr": "E2B_API_KEY missing from environment/secrets.",
        }

    try:
        with Sandbox.create(api_key=e2b_api_key) as sbx:
            execution = sbx.run_code(code_str)

            stdout_output = ""
            if execution.logs.stdout:
                stdout_output = "\n".join(execution.logs.stdout)

            if execution.results:
                for result in execution.results:
                    if hasattr(result, "text") and result.text:
                        stdout_output += f"\n{result.text}"

            if execution.error:
                return {
                    "status": "error",
                    "stdout": stdout_output,
                    "stderr": f"{execution.error.name}: {execution.error.value}",
                }

            return {
                "status": "success",
                "stdout": stdout_output.strip(),
                "stderr": "",
            }
    except Exception as exc:
        return {
            "status": "error",
            "stdout": "",
            "stderr": f"E2B Client Error: {exc}",
        }

```

## `backend/tools/search.py`
```python
from duckduckgo_search import DDGS


def web_search(query: str, max_results: int = 3) -> str:
    try:
        results = []
        with DDGS() as ddgs:
            for result in ddgs.text(query, max_results=max_results):
                results.append(
                    f"Title: {result['title']}\nSnippet: {result['body']}\nURL: {result['href']}"
                )
        return "\n\n".join(results) if results else "No relevant search results found."
    except Exception as exc:
        return f"Search error: {exc}"

```

## `config/__init__.py`
```python

```

## `docs.md`
```markdown
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

```

## `frontend/app.js`
```javascript
export default function(component) {
  const root = component.parentElement;
  const get = (selector) => root.querySelector(selector);
  const all = (selector) => Array.from(root.querySelectorAll(selector));
  const sendEvent = (payload) => component.setTriggerValue("event", payload);

  if (!root.__askmoinaCtx) {
    root.__askmoinaCtx = {
      component,
      data: {},
      state: {
        mode: "auto",
        expandedPrompts: new Set(),
        thinking: false,
        thinkingIndex: 0,
        thinkingTimer: null,
        toastTimer: null,
      },
    };
  }

  const ctx = root.__askmoinaCtx;
  ctx.component = component;
  ctx.data = component.data || {};
  const state = ctx.state;

  const phrases = [
    "Thinking through the idea",
    "Exploring a few directions",
    "Connecting the pieces",
    "Working through the details",
    "Shaping a response",
    "Almost there",
  ];

  function iconChevron() {
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
  }

  function iconCopy() {
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="7" height="8" rx="1"/><path d="M9 5V3.5A1.5 1.5 0 0 0 7.5 2H4A1.5 1.5 0 0 0 2.5 3.5v7A1.5 1.5 0 0 0 4 12h1"/></svg>';
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[char]));
  }

  function formatTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    return date.toDateString() === now.toDateString()
      ? date.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})
      : date.toLocaleDateString([], {month:"short", day:"numeric"});
  }

  function showToast(message) {
    const toast = get("[data-toast]");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 1700);
  }

  function tickThinking() {
    const node = get("[data-thinking-phrase]");
    if (!node || !state.thinking) return;
    node.animate([
      {opacity:1, transform:"translateY(0)", filter:"blur(0)"},
      {opacity:0, transform:"translateY(-5px)", filter:"blur(2px)"},
    ], {duration:330, easing:"ease", fill:"forwards"}).onfinish = () => {
      node.textContent = phrases[state.thinkingIndex];
      node.animate([
        {opacity:0, transform:"translateY(5px)", filter:"blur(2px)"},
        {opacity:1, transform:"translateY(0)", filter:"blur(0)"},
      ], {duration:420, easing:"cubic-bezier(.22,1,.36,1)", fill:"forwards"});
      state.thinkingIndex = (state.thinkingIndex + 1) % phrases.length;
    };
  }

  function setThinking(active) {
    state.thinking = active;
    clearInterval(state.thinkingTimer);
    state.thinkingTimer = null;
    if (!active) return;
    state.thinkingIndex = 0;
    tickThinking();
    state.thinkingTimer = setInterval(tickThinking, 1200);
  }

  function resizeInput() {
    const input = get("[data-input]");
    if (!input) return;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 170) + "px";
    get("[data-action='send']")?.classList.toggle("ready", input.value.trim().length > 0);
  }

  function renderModes() {
    all(".mode").forEach((node) => {
      const active = node.dataset.mode === state.mode;
      node.classList.toggle("active", active);
      node.setAttribute("aria-selected", active ? "true" : "false");
    });
  }


  function renderHistory(items) {
    const list = get("[data-history-list]");
    if (!list) return;
    if (!items?.length) {
      list.innerHTML = '<div class="history-empty">No saved conversations yet.</div>';
      return;
    }
    list.innerHTML = items.map((item) => `
      <div class="history-item ${item.active ? "active" : ""}" data-history-id="${esc(item.id)}">
        <div class="history-title">${esc(item.title)}</div>
        <div class="history-time">${esc(formatTime(item.updated_at))}</div>
        <div class="history-actions">
          <button data-history-action="rename" data-id="${esc(item.id)}" aria-label="Rename">✎</button>
          <button data-history-action="delete" data-id="${esc(item.id)}" aria-label="Delete">×</button>
        </div>
      </div>`).join("");
  }

  function renderConversation(data) {
    const conversation = get("[data-conversation]");
    const empty = get("[data-empty]");
    if (!conversation || !empty) return;
    const messages = data.messages || [];
    empty.style.display = messages.length ? "none" : "flex";
    conversation.innerHTML = "";
    if (!messages.length) return;

    for (let i = 0; i < messages.length; i += 1) {
      const user = messages[i];
      if (user.role !== "user") continue;
      const assistant = messages[i + 1]?.role === "assistant" ? messages[i + 1] : null;
      const key = `${i}:${user.content.length}`;
      const isLong = user.content.length > 220 || user.content.split(/\s+/).length > 42;
      const expanded = state.expandedPrompts.has(key);
      const block = document.createElement("div");
      block.className = "entry answered";
      block.innerHTML = `
        <div class="rail thought" aria-hidden="true"></div>
        <div class="entry-content">
          <div class="thought-wrap ${isLong && !expanded ? "collapsed" : ""}">
            <div class="thought-text ${isLong ? "long" : ""} ${isLong && !expanded ? "collapsed" : ""}" data-thought-text="${esc(key)}"></div>
            ${isLong ? `<button class="thought-toggle ${expanded ? "expanded" : ""}" data-thought-toggle="${esc(key)}" aria-label="${expanded ? "Collapse thought" : "Expand thought"}">${iconChevron()}</button>` : ""}
          </div>
          ${isLong ? `<div class="thought-tools"><button class="thought-copy" data-copy-thought="${esc(key)}" aria-label="Copy thought" title="Copy thought">${iconCopy()}</button></div>` : ""}
        </div>`;
      block.querySelector("[data-thought-text]").textContent = user.content;

      if (assistant) {
        const answer = document.createElement("div");
        answer.className = "entry answer-entry";
        answer.innerHTML = `
          <div class="rail answer" aria-hidden="true"></div>
          <div class="entry-content">
            <div class="thinking"><span class="signal"></span><span data-thinking-phrase>Thinking through the idea</span></div>
            <div class="response visible">
              <div class="response-body"></div>
              <div class="response-actions">
                <button class="response-action" data-copy-response>Copy</button>
                <button class="response-action" data-regenerate>Regenerate</button>
                <button class="response-action" data-more>More</button>
              </div>
            </div>
          </div>`;
        answer.querySelector(".response-body").innerHTML = assistant.html || `<p>${esc(assistant.content)}</p>`;
        block.appendChild(answer);
      }
      conversation.appendChild(block);
    }

    if (state.thinking) {
      const lastThinking = conversation.querySelector(".thinking:last-of-type");
      lastThinking?.classList.add("visible");
    }
  }

  function sync(data) {
    state.mode = data.mode || state.mode;
    const messages = data.messages || [];
    if (messages.length && messages[messages.length - 1]?.role === "assistant") {
      setThinking(false);
    }
    renderModes();
    renderHistory(data.history || []);
    renderConversation(data);
    if (data.error) showToast(data.error);
  }

  function openOverlay(selector) {
    const overlay = get(selector);
    overlay?.classList.add("open");
    overlay?.setAttribute("aria-hidden", "false");
  }

  function closeOverlay(selector) {
    const overlay = get(selector);
    overlay?.classList.remove("open");
    overlay?.setAttribute("aria-hidden", "true");
  }

  if (!root.__askmoinaBound) {
    root.__askmoinaBound = true;

    all(".mode").forEach((node) => node.addEventListener("click", () => {
      state.mode = node.dataset.mode;
      renderModes();
      sendEvent({type:"mode.select", mode:state.mode});
    }));

    all("[data-suggestion]").forEach((node) => node.addEventListener("click", () => {
      const input = get("[data-input]");
      input.value = node.dataset.suggestion;
      resizeInput();
      input.focus();
    }));

    const input = get("[data-input]");
    input?.addEventListener("input", resizeInput);
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitPrompt();
      }
    });

    function submitPrompt() {
      const value = input?.value.trim();
      if (!value) return;
      setThinking(true);
      showToast("AskMoina is thinking");
      sendEvent({type:"chat.submit", prompt:value, mode:state.mode});
      input.value = "";
      resizeInput();
    }

    get("[data-action='send']")?.addEventListener("click", submitPrompt);
    get("[data-action='plus']")?.addEventListener("click", () => showToast("Add attachments in the next integration step"));
    get("[data-action='attach']")?.addEventListener("click", () => showToast("Attachment support is ready for backend wiring"));
    get("[data-action='history']")?.addEventListener("click", () => openOverlay("[data-history-overlay]"));
    get("[data-action='history-close']")?.addEventListener("click", () => closeOverlay("[data-history-overlay]"));
    get("[data-action='settings']")?.addEventListener("click", () => showToast("Web grounding and sandbox verification are always on"));
    get("[data-action='new']")?.addEventListener("click", () => { closeOverlay("[data-history-overlay]"); sendEvent({type:"conversation.new"}); });



    root.addEventListener("click", async (event) => {
      const toggle = event.target.closest("[data-thought-toggle]");
      if (toggle) {
        const key = toggle.dataset.thoughtToggle;
        if (state.expandedPrompts.has(key)) state.expandedPrompts.delete(key); else state.expandedPrompts.add(key);
        renderConversation(ctx.data);
        return;
      }

      const copyThought = event.target.closest("[data-copy-thought]");
      if (copyThought) {
        const key = copyThought.dataset.copyThought;
        const textNode = root.querySelector(`[data-thought-text="${CSS.escape(key)}"]`);
        if (textNode) {
          await navigator.clipboard?.writeText(textNode.textContent || "");
          showToast("Thought copied");
        }
        return;
      }

      const copyResponse = event.target.closest("[data-copy-response]");
      if (copyResponse) {
        const answer = copyResponse.closest(".response");
        const text = answer?.querySelector(".response-body")?.innerText?.trim() || "";
        await navigator.clipboard?.writeText(text);
        showToast("Response copied");
        return;
      }

      if (event.target.closest("[data-regenerate]")) {
        setThinking(true);
        sendEvent({type:"chat.regenerate"});
        return;
      }

      if (event.target.closest("[data-more]")) {
        showToast("More actions are reserved for the next pass");
        return;
      }

      const historyButton = event.target.closest("[data-history-action]");
      if (historyButton) {
        const id = historyButton.dataset.id;
        if (historyButton.dataset.historyAction === "rename") {
          const title = window.prompt("Rename conversation", "");
          if (title?.trim()) sendEvent({type:"conversation.rename", conversation_id:id, title:title.trim()});
        } else {
          sendEvent({type:"conversation.delete", conversation_id:id});
        }
        return;
      }

      const historyItem = event.target.closest("[data-history-id]");
      if (historyItem) {
        closeOverlay("[data-history-overlay]");
        sendEvent({type:"conversation.select", conversation_id:historyItem.dataset.historyId});
      }
    });

    get("[data-history-overlay]")?.addEventListener("click", (event) => {
      if (event.target === get("[data-history-overlay]")) closeOverlay("[data-history-overlay]");
    });

    const scroll = get("[data-scroll]");
    let scrollTimer = null;
    scroll?.addEventListener("scroll", () => {
      get("[data-modes]")?.classList.add("scrolling");
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => get("[data-modes]")?.classList.remove("scrolling"), 180);
    }, {passive:true});

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeOverlay("[data-history-overlay]");
      }
    });
  }

  sync(ctx.data);

  return () => {
    clearInterval(state.thinkingTimer);
  };
}

```

## `frontend/index.html`
```html
<div class="askmoina-shell" data-app>
  <div class="content-scroll" data-scroll>
    <header class="header">
      <button class="brand" data-action="brand" aria-label="AskMoina home">
        AskMoina<span class="brand-dot">.</span>
      </button>
      <nav class="header-actions" aria-label="Application navigation">
        <button class="utility" data-action="history" aria-label="Open history" title="History">
          <span class="utility-icon">↺</span><span>History</span>
        </button>
        <button class="utility" data-action="settings" aria-label="Open settings" title="Settings">
          <span class="utility-icon">⌘</span>
        </button>
      </nav>
    </header>

    <div class="top-fade" aria-hidden="true"></div>

    <main class="canvas" data-canvas>
      <section class="empty-state" data-empty>
        <h1>Begin with a thought.</h1>
        <div class="empty-suggestions" aria-label="Suggestions">
          <button data-suggestion="Explore an idea">Explore an idea</button>
          <button data-suggestion="Make something">Make something</button>
          <button data-suggestion="Solve a problem">Solve a problem</button>
          <button data-suggestion="Understand something">Understand something</button>
        </div>
      </section>
      <section class="conversation" data-conversation></section>
    </main>
  </div>

  <div class="mode-blur-zone" aria-hidden="true"></div>
  <div class="bottom-fade" aria-hidden="true"></div>

  <section class="composer-dock" aria-label="AskMoina composer">
    <div class="mode-wrap">
      <div class="mode-bar" data-modes role="tablist" aria-label="Modes">
        <button class="mode" data-mode="logical" role="tab" aria-selected="false">
          <span class="mode-glyph">◌</span><span class="mode-name">Logical</span>
        </button>
        <button class="mode active" data-mode="auto" role="tab" aria-selected="true">
          <span class="mode-glyph">✦</span><span class="mode-name">Auto</span>
        </button>
        <button class="mode" data-mode="creative" role="tab" aria-selected="false">
          <span class="mode-glyph">✧</span><span class="mode-name">Creative</span>
        </button>
      </div>
    </div>

    <div class="composer">
      <button class="composer-icon plus" data-action="plus" aria-label="Add" title="Add">+</button>
      <textarea data-input rows="1" placeholder="Begin with a thought…" aria-label="Prompt"></textarea>
      <div class="composer-actions">
        <button class="composer-icon attach" data-action="attach" aria-label="Attachment" title="Attachment">⌕</button>
        <button class="send" data-action="send" aria-label="Send" title="Send">↑</button>
      </div>
    </div>
    <div class="composer-caption">Enter to send · Shift + Enter for a new line</div>
  </section>

  <div class="history-overlay" data-history-overlay aria-hidden="true">
    <div class="history-panel" role="dialog" aria-modal="true" aria-label="History">
      <div class="panel-head">
        <div>
          <div class="panel-kicker">CONVERSATIONS</div>
          <h2>History</h2>
        </div>
        <div class="panel-actions">
          <button class="panel-icon" data-action="new" aria-label="New conversation" title="New conversation">+</button>
          <button class="panel-icon" data-action="history-close" aria-label="Close history" title="Close">×</button>
        </div>
      </div>
      <div class="history-list" data-history-list></div>
    </div>
  </div>

  <div class="toast" data-toast role="status" aria-live="polite"></div>
</div>

```

## `frontend/styles.css`
```css
:host{--bg:#070707;--surface:#0d0d0d;--elevated:#141414;--higher:#191919;--white:#f5f5f5;--secondary:#929292;--muted:#626262;--green:#02c54c;--line:rgba(245,245,245,.08);--line-strong:rgba(245,245,245,.13);--ease:cubic-bezier(.22,1,.36,1);display:block;min-height:100vh;background:var(--bg);color:var(--white);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
button,textarea{font:inherit}button{border:0;background:none;color:inherit}button:focus-visible,textarea:focus-visible{outline:1px solid rgba(2,197,76,.72);outline-offset:3px}
.askmoina-shell{position:relative;min-height:100vh;background:radial-gradient(circle at 50% 38%,rgba(255,255,255,.022),transparent 32%),var(--bg);overflow:hidden}
.content-scroll{height:100vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scroll-behavior:smooth;scrollbar-color:#1d1d1d #070707;scrollbar-width:thin}
.content-scroll::-webkit-scrollbar{width:8px}.content-scroll::-webkit-scrollbar-track{background:#070707}.content-scroll::-webkit-scrollbar-thumb{background:#1c1c1c;border-radius:99px;border:2px solid #070707}
.header{position:fixed;left:0;right:0;top:0;height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:rgba(7,7,7,.86);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid rgba(245,245,245,.065);z-index:70}
.header:after{content:"";position:absolute;left:0;right:0;top:100%;height:52px;background:linear-gradient(to bottom,rgba(7,7,7,.50),rgba(7,7,7,.14) 48%,transparent);filter:none;pointer-events:none}
.brand{padding:0;color:var(--white);font-size:13px;font-weight:600;letter-spacing:-.025em;cursor:pointer}.brand-dot{display:inline;font-size:1.48em;line-height:1;font-weight:900;color:var(--green);margin-left:1px;vertical-align:baseline;position:relative;top:.02em}
.header-actions{display:flex;gap:5px}.utility{display:inline-flex;align-items:center;gap:7px;padding:8px 10px;border-radius:8px;color:var(--secondary);font-size:12px;cursor:pointer;transition:background 180ms var(--ease),color 180ms var(--ease)}.utility:hover{color:var(--white);background:rgba(255,255,255,.035)}.utility-icon{font-size:14px;line-height:1}
.top-fade{position:fixed;left:0;right:0;top:68px;height:52px;z-index:30;pointer-events:none;background:linear-gradient(to bottom,rgba(7,7,7,.30),rgba(7,7,7,.05) 60%,transparent)}
.canvas{width:min(920px,calc(100% - 48px));min-height:100%;margin:0 auto;padding:98px 0 232px}.empty-state{min-height:calc(100vh - 145px);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 0 50px}.empty-state h1{margin:0 0 18px;font-size:clamp(34px,5vw,58px);line-height:1.05;letter-spacing:-.055em;font-weight:400}.empty-suggestions{display:flex;flex-wrap:wrap;justify-content:center;gap:18px}.empty-suggestions button{position:relative;padding:5px 0;color:var(--secondary);font-size:13px;cursor:pointer;transition:color 180ms var(--ease)}.empty-suggestions button:after{content:"";position:absolute;left:0;bottom:0;width:0;height:1px;background:var(--green);transition:width 240ms var(--ease)}.empty-suggestions button:hover{color:var(--white)}.empty-suggestions button:hover:after{width:16px}
.conversation{display:flex;flex-direction:column;gap:0;padding:28px 0 12px}.conversation:empty{display:none}.entry{display:grid;grid-template-columns:2px minmax(0,1fr);column-gap:18px}.entry.answered{margin-bottom:14px}.rail{width:1px;justify-self:center;border-radius:999px;min-height:24px}.rail.thought{margin-top:4px;background:linear-gradient(to bottom,rgba(245,245,245,.28),rgba(245,245,245,.06));}.rail.answer{min-height:100%;background:linear-gradient(to bottom,rgba(2,197,76,.76),rgba(2,197,76,.12));box-shadow:0 0 12px rgba(2,197,76,.06)}
.entry-content{min-width:0}.thought-wrap{position:relative;max-width:790px}.thought-text{font-size:16px;line-height:1.4;letter-spacing:-.012em;font-weight:420;color:var(--white);white-space:pre-wrap;overflow-wrap:anywhere}.thought-text.long{font-size:14px;line-height:1.48;letter-spacing:-.005em}.thought-text.collapsed{max-height:6.1em;overflow:hidden;mask-image:linear-gradient(to bottom,#000 0%,#000 62%,rgba(0,0,0,.86) 76%,rgba(0,0,0,.25) 92%,transparent 100%);-webkit-mask-image:linear-gradient(to bottom,#000 0%,#000 62%,rgba(0,0,0,.86) 76%,rgba(0,0,0,.25) 92%,transparent 100%)}.thought-wrap.collapsed:after{content:"";position:absolute;left:0;right:42px;bottom:25px;height:26px;background:linear-gradient(to bottom,transparent,rgba(7,7,7,.78));filter:blur(2px);pointer-events:none}.thought-toggle{position:absolute;right:0;bottom:24px;width:28px;height:28px;display:grid;place-items:center;border:1px solid rgba(245,245,245,.10);border-radius:50%;background:rgba(13,13,13,.74);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:var(--secondary);cursor:pointer;z-index:3;transition:color 180ms var(--ease),border-color 180ms var(--ease),background 180ms var(--ease)}.thought-toggle:hover{color:var(--white);border-color:rgba(2,197,76,.35);background:rgba(20,20,20,.90)}.thought-toggle svg{width:13px;height:13px;transition:transform 220ms var(--ease)}.thought-toggle.expanded svg{transform:rotate(180deg)}.thought-tools{display:flex;gap:3px;min-height:22px;margin-top:4px}.thought-copy{width:25px;height:22px;display:grid;place-items:center;border-radius:6px;color:var(--muted);cursor:pointer}.thought-copy:hover{color:var(--white);background:rgba(255,255,255,.035)}
.thinking{display:flex;align-items:center;gap:9px;height:42px;color:var(--secondary);font-size:13px;opacity:0;transform:translateY(5px);filter:blur(1.5px);transition:opacity 300ms ease,transform 420ms var(--ease),filter 420ms ease}.thinking.visible{opacity:1;transform:none;filter:none}.signal{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 0 0 rgba(2,197,76,.16),0 0 10px rgba(2,197,76,.16);animation:pulse 1.8s ease-in-out infinite}@keyframes pulse{50%{transform:scale(1.08);box-shadow:0 0 0 7px rgba(2,197,76,0),0 0 12px rgba(2,197,76,.18)}}
.response{opacity:0;transform:translateY(7px);filter:blur(1.8px);transition:opacity 540ms var(--ease),transform 540ms var(--ease),filter 540ms var(--ease)}.response.visible{opacity:1;transform:none;filter:none}.response-body{color:var(--secondary)}.response-body p{margin:0 0 9px;font-size:13px;line-height:1.52}.response-body h1,.response-body h2,.response-body h3{margin:15px 0 7px;color:var(--white);font-size:14px;line-height:1.3;font-weight:520}.response-body ul,.response-body ol{margin:5px 0 9px;padding-left:20px}.response-body li{margin:3px 0;font-size:13px;line-height:1.5}.response-body blockquote{margin:8px 0;padding-left:12px;border-left:1px solid rgba(2,197,76,.34);color:var(--secondary)}.response-body a{color:var(--white);text-underline-offset:3px}.response-body code{padding:.08em .3em;border:1px solid rgba(245,245,245,.08);background:#0d0d0d;border-radius:4px;color:var(--white)}.response-body pre{margin:9px 0;padding:12px;overflow:auto;background:#0d0d0d;border:1px solid rgba(245,245,245,.08);border-radius:8px}.response-body pre code{padding:0;border:0;background:transparent}.response-body table{width:100%;margin:10px 0;border-collapse:collapse;font-size:12px}.response-body th,.response-body td{padding:7px 8px;border-bottom:1px solid rgba(245,245,245,.08);text-align:left}.response-body th{color:var(--white);font-weight:520}.response-actions{display:flex;gap:4px;margin-top:5px;opacity:.85}.response-action{padding:4px 6px;border-radius:6px;color:var(--muted);font-size:11px;cursor:pointer}.response-action:hover{color:var(--white);background:rgba(255,255,255,.035)}
.composer-dock{position:fixed;left:50%;bottom:16px;width:min(820px,calc(100vw - 32px));transform:translateX(-50%);z-index:80}.mode-wrap{position:relative;margin:0 auto 6px;width:fit-content;max-width:100%}.mode-bar{display:grid;grid-template-columns:repeat(3,minmax(105px,1fr));width:min(460px,calc(100vw - 42px));padding:3px;border:1px solid rgba(245,245,245,.085);border-radius:13px;background:rgba(13,13,13,.86);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 10px 35px rgba(0,0,0,.24);transition:border-color 180ms ease,box-shadow 180ms ease,background 180ms ease}.mode-bar.scrolling{border-color:rgba(245,245,245,.13);background:rgba(13,13,13,.92);box-shadow:0 12px 36px rgba(0,0,0,.32)}.mode{position:relative;display:flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:0 12px;border-radius:9px;color:var(--muted);font-size:12px;cursor:pointer;transition:color 180ms var(--ease),background 180ms var(--ease)}.mode:hover{color:var(--white);background:rgba(255,255,255,.03)}.mode.active{color:var(--white);background:rgba(255,255,255,.045)}.mode.active:after{content:"";position:absolute;left:22%;right:22%;bottom:2px;height:1px;background:var(--green);box-shadow:0 0 8px rgba(2,197,76,.18)}.mode-glyph{font-size:12px;color:var(--muted);transition:color 180ms ease,text-shadow 180ms ease}.mode.active .mode-glyph{color:var(--green);text-shadow:0 0 8px rgba(2,197,76,.28)}
.mode-blur-zone{position:fixed;left:0;right:0;bottom:72px;height:112px;z-index:62;pointer-events:none;background:linear-gradient(to top,rgba(7,7,7,.16),rgba(7,7,7,.08) 50%,transparent 100%);backdrop-filter:blur(17px);-webkit-backdrop-filter:blur(17px);mask-image:linear-gradient(to top,transparent 0%,rgba(0,0,0,.30) 24%,rgba(0,0,0,.78) 58%,black 82%,black 100%);-webkit-mask-image:linear-gradient(to top,transparent 0%,rgba(0,0,0,.30) 24%,rgba(0,0,0,.78) 58%,black 82%,black 100%)}.bottom-fade{position:fixed;left:0;right:0;bottom:0;height:175px;z-index:55;pointer-events:none;background:linear-gradient(to top,rgba(7,7,7,.92),rgba(7,7,7,.64) 28%,rgba(7,7,7,.20) 72%,transparent 100%);mask-image:linear-gradient(to top,black 0%,black 50%,rgba(0,0,0,.62) 75%,transparent 100%);-webkit-mask-image:linear-gradient(to top,black 0%,black 50%,rgba(0,0,0,.62) 75%,transparent 100%)}
.composer{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:end;gap:4px;padding:7px;border:1px solid rgba(245,245,245,.10);border-radius:15px;background:rgba(13,13,13,.92);backdrop-filter:blur(15px);-webkit-backdrop-filter:blur(15px);box-shadow:0 16px 50px rgba(0,0,0,.40);transition:border-color 200ms ease,background 200ms ease}.composer:focus-within{border-color:rgba(2,197,76,.28);background:rgba(17,17,17,.94)}textarea{width:100%;min-height:40px;max-height:170px;resize:none;overflow-y:auto;padding:8px 8px 7px;background:transparent;border:0;outline:none;color:var(--white);font-size:13px;line-height:1.45}.composer textarea::placeholder{color:#656565}.composer-icon,.send{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;color:var(--muted);cursor:pointer;transition:color 180ms var(--ease),background 180ms var(--ease),border-color 180ms ease}.composer-icon:hover{color:var(--white);background:rgba(255,255,255,.04)}.plus{font-size:20px;font-weight:300}.composer-actions{display:flex;gap:2px}.send{font-size:18px;background:#151515;color:var(--muted);border:1px solid rgba(245,245,245,.07)}.send.ready{color:var(--green);border-color:rgba(2,197,76,.24);background:rgba(2,197,76,.06)}.composer-caption{text-align:center;margin-top:5px;color:#4f4f4f;font-size:9px;letter-spacing:.01em}
.history-overlay{position:fixed;inset:0;z-index:120;display:flex;align-items:flex-start;justify-content:center;padding:88px 18px 30px;background:rgba(0,0,0,.44);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);opacity:0;pointer-events:none;transition:opacity 220ms ease}.history-overlay.open{opacity:1;pointer-events:auto}.history-panel{width:min(520px,100%);max-height:min(70vh,620px);overflow:auto;border:1px solid rgba(245,245,245,.10);border-radius:16px;background:#0d0d0d;box-shadow:0 30px 80px rgba(0,0,0,.55);transform:translateY(-7px);transition:transform 320ms var(--ease)}.history-overlay.open .history-panel{transform:none}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;padding:18px 18px 12px;border-bottom:1px solid var(--line)}.panel-kicker{font-size:9px;letter-spacing:.13em;color:#5e5e5e;margin-bottom:3px}.panel-head h2{margin:0;font-size:20px;font-weight:470;letter-spacing:-.03em}.panel-actions{display:flex;gap:4px}.panel-icon{width:30px;height:30px;border-radius:8px;color:var(--secondary);cursor:pointer}.panel-icon:hover{color:var(--white);background:rgba(255,255,255,.04)}.history-list{padding:8px}.history-empty{padding:28px 10px;color:var(--muted);font-size:12px;text-align:center}.history-group-title{padding:10px;color:#585858;font-size:9px;letter-spacing:.13em}.history-item{position:relative;display:flex;align-items:center;gap:10px;padding:10px 10px;border-radius:9px;cursor:pointer;transition:background 170ms ease}.history-item:hover{background:rgba(255,255,255,.035)}.history-item.active{background:rgba(255,255,255,.045)}.history-item.active:before{content:"";width:3px;height:16px;background:var(--green);border-radius:99px}.history-item:not(.active):before{content:"";width:3px;height:16px;background:transparent}.history-title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--white);font-size:12px}.history-time{color:#565656;font-size:10px}.history-actions{display:flex;gap:2px;opacity:0;transition:opacity 160ms ease}.history-item:hover .history-actions{opacity:1}.history-actions button{width:23px;height:23px;border-radius:6px;color:#6b6b6b}.history-actions button:hover{color:var(--white);background:rgba(255,255,255,.04)}

.toast{position:fixed;left:50%;bottom:205px;z-index:130;transform:translate(-50%,8px);padding:7px 10px;border:1px solid rgba(245,245,245,.08);border-radius:8px;background:rgba(20,20,20,.95);color:var(--secondary);font-size:11px;opacity:0;pointer-events:none;transition:opacity 180ms ease,transform 220ms var(--ease)}.toast.show{opacity:1;transform:translate(-50%,0)}
@media (max-width:700px){.header{height:58px;padding:0 14px}.top-fade{top:58px}.canvas{width:min(100% - 28px,920px);padding-top:82px;padding-bottom:220px}.empty-state{min-height:calc(100vh - 128px);padding-bottom:70px}.empty-state h1{font-size:36px}.empty-suggestions{gap:10px 15px}.entry{column-gap:12px}.thought-text{font-size:15px}.thought-text.long{font-size:13px}.composer-dock{bottom:10px;width:calc(100vw - 18px)}.mode-bar{width:min(420px,calc(100vw - 28px));grid-template-columns:repeat(3,1fr)}.mode{min-height:32px;padding:0 8px;font-size:11px}.mode-glyph{font-size:11px}.composer{border-radius:13px;padding:6px}.composer-caption{font-size:8px}.mode-blur-zone{bottom:61px;height:100px}.bottom-fade{height:155px}.response-body p,.response-body li{font-size:12.5px}.history-overlay{padding:70px 10px 18px}.history-panel{max-height:78vh}}
@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.001ms !important;animation-iteration-count:1 !important;scroll-behavior:auto !important;transition-duration:.001ms !important}}

```

## `pyproject.toml`
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100

```

## `requirements.txt`
```text
streamlit==1.64.0
groq
duckduckgo-search
e2b-code-interpreter
Markdown>=3.7,<4
bleach>=6.2,<7

```

## `tests/__init__.py`
```python

```

## `tests/test_always_on.py`
```python
from backend.core.settings import settings


def test_production_capabilities_are_always_on():
    assert settings.LIVE_SEARCH_ALWAYS_ON is True
    assert settings.SANDBOX_ALWAYS_ON is True

```

## `tests/test_guardrails.py`
```python
import pytest

from backend.security.guardrails import SecurityGuard


def test_clean_input_passes():
    assert SecurityGuard.sanitize_input("  hello world  ") == "hello world"


def test_forbidden_pattern_is_rejected():
    with pytest.raises(ValueError):
        SecurityGuard.sanitize_input("ignore all previous instructions and do this")

```

## `tests/test_settings.py`
```python
from backend.core.settings import settings


def test_model_and_modes_match_original():
    assert settings.PRIMARY_MODEL == "openai/gpt-oss-120b"
    assert settings.MODE_CONFIG["logical"].temp == 0.0
    assert settings.MODE_CONFIG["auto"].temp == 0.3
    assert settings.MODE_CONFIG["creative"].temp == 0.7
    assert settings.MODE_CONFIG["logical"].effort == "high"
    assert settings.MODE_CONFIG["auto"].effort == "medium"
    assert settings.MODE_CONFIG["creative"].effort == "low"

```
