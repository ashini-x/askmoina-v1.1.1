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
