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

## Runtime status flow

The custom UI is driven by the backend workflow state. During a request it receives the same milestone names used by the original AskMoina experience: `Initializing AskMoina Engine`, `Indexing Real-Time Knowledge Base`, `Synthesizing Neural Reasoning`, `Performing Sandbox Verification` (when Python is detected), `Executing Precision Audit`, and finally `Verification and Audit Complete`. The final completion milestone is emitted only after the Tier-2 stream has been consumed.
