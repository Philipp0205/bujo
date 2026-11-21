"""Shared test setup: no test may see a real gateway setting from the shell."""
import pytest


@pytest.fixture(autouse=True)
def no_llm_env(monkeypatch):
    for name in ("OCR_LLM_BASE", "OCR_LLM_KEY", "OCR_LLM_MODEL", "OCR_LLM_TIMEOUT"):
        monkeypatch.delenv(name, raising=False)
