import asyncio
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from app.models.research_llm import OpenAIResearchProvider, ResearchProviderConfig, ResearchProviderError
from app.schemas.assistant import AssistantRequest, ResearchDraft, SECTION_TITLES
from app.services.research_assistant import generate_research, validate_draft
from app.services.research_data import collect_evidence, source, ResearchDataError


def draft(content="Historical evidence is limited.", citations=None):
    return ResearchDraft(**{key: {"content": content, "source_ids": citations or []} for key in SECTION_TITLES})


class Reader:
    def __init__(self):
        self.auth_calls = 0
        self.paths = []

    async def authenticate(self):
        self.auth_calls += 1

    async def get(self, path, params=None):
        self.paths.append(path)
        if path == "market/symbols":
            return [{"symbol": "TSLA", "company_name": "Tesla Inc."}, {"symbol": "AAPL", "company_name": "Apple Inc."}, {"symbol": "MSFT", "company_name": "Microsoft Corporation"}]
        if path == "portfolio":
            return []
        raise AssertionError(path)

    async def optional(self, path, params=None):
        self.paths.append(path)
        return None


def test_tesla_and_comparison_resolution_and_missing_data():
    reader = Reader()
    symbols, sources, warnings = asyncio.run(collect_evidence(AssistantRequest(question="Explain RSI for Tesla."), reader, None))
    assert symbols == ["TSLA"]
    assert not next(s for s in sources if s.id == "technical:TSLA").available
    assert any("no indicator values were fabricated" in warning for warning in warnings)
    assert "portfolio" not in reader.paths
    symbols, _, _ = asyncio.run(collect_evidence(AssistantRequest(question="Compare AAPL and MSFT."), reader, None))
    assert symbols == ["AAPL", "MSFT"]


def test_portfolio_question_uses_authenticated_holdings():
    reader = Reader()
    _, sources, _ = asyncio.run(collect_evidence(AssistantRequest(question="Summarize my portfolio risk."), reader, None))
    assert "portfolio" in reader.paths
    assert next(s for s in sources if s.kind == "portfolio").data["positions"] == []


@pytest.mark.parametrize("content", ["Guaranteed profits await.", "Returns are guaranteed.", "You cannot lose.", "Risk-free gains."])
def test_rejects_profit_certainty(content):
    with pytest.raises(ResearchProviderError):
        validate_draft(draft(content), [])


def test_rejects_unknown_and_unavailable_citations():
    for citation in ["unknown", "quote:TSLA"]:
        with pytest.raises(ResearchProviderError):
            validate_draft(draft(citations=[citation]), [source("quote:TSLA", "market", "Tesla quote")])


def test_unknown_company_requires_supported_symbol():
    with pytest.raises(ResearchDataError) as error:
        asyncio.run(collect_evidence(AssistantRequest(question="Explain UNKNOWN."), Reader(), None))
    assert error.value.status == 422


def test_generation_labels_sections_and_rechecks_session():
    class Provider:
        config = SimpleNamespace(model="test-model")

        def ensure_configured(self):
            pass

        async def generate(self, question, evidence):
            assert "token" not in str(evidence)
            return draft(citations=["company:TSLA"])

    reader = Reader()
    report = asyncio.run(generate_research(AssistantRequest(question="Explain RSI for Tesla."), reader, Provider(), None))
    assert reader.auth_calls == 2
    assert report.ai_generated and report.label == "AI-generated research"
    assert all(getattr(report, name).content for name in SECTION_TITLES)
    assert "No profits" in report.educational_conclusion.content


def test_missing_server_key_disables_provider():
    with pytest.raises(ResearchProviderError):
        OpenAIResearchProvider(ResearchProviderConfig(api_key=SecretStr(""))).ensure_configured()


def test_http_requires_session_and_validates_question():
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        result = client.post("/research/assistant", json={"question": "Explain NVDA performance."})
        assert result.status_code == 401
        result = client.post("/research/assistant", headers={"Authorization": "Bearer test-session"}, json={"question": "   "})
        assert result.status_code == 422
