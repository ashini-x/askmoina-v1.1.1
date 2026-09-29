from backend.core.settings import settings


def test_production_capabilities_are_always_on():
    assert settings.LIVE_SEARCH_ALWAYS_ON is True
    assert settings.SANDBOX_ALWAYS_ON is True
