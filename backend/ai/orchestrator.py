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
