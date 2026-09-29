from backend.core.settings import settings


def test_model_and_modes_match_original():
    assert settings.PRIMARY_MODEL == "openai/gpt-oss-120b"
    assert settings.MODE_CONFIG["logical"].temp == 0.0
    assert settings.MODE_CONFIG["auto"].temp == 0.3
    assert settings.MODE_CONFIG["creative"].temp == 0.7
    assert settings.MODE_CONFIG["logical"].effort == "high"
    assert settings.MODE_CONFIG["auto"].effort == "medium"
    assert settings.MODE_CONFIG["creative"].effort == "low"
