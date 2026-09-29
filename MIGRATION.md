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


### Live workflow labels
The Streamlit host now runs the backend request in a process-local background job and polls it from a Streamlit fragment. `ChatService` reports real phase transitions to the job manager; the custom component renders those labels with restrained motion. This keeps the UI status synchronized with search, synthesis, optional E2B verification, audit, and final completion instead of using a fake timer.
