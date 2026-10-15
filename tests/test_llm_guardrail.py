"""The LLM may rephrase reasons but can never move a verdict, note id or number."""
from dataclasses import replace

from ferro import pipeline
from ferro.config import Config


class FakeLLM:
    """Stands in for LLMClient: alternates a faithful rewrite and a hallucinated one."""

    def __init__(self, *a, **k):
        from ferro.llm import TokenLedger
        self.calls = 0
        self.enabled = True
        self.ledger = a[2] if len(a) > 2 else TokenLedger(Config().llm)

    def complete(self, messages, purpose):
        self.calls += 1
        draft = messages[-1]["content"].split("DRAFT: ", 1)[1].split("\nRewrite")[0]
        return "Caused by N999 and a 55.5% fuel spike." if self.calls % 2 else "In short: " + draft


def test_llm_rewrites_cannot_change_graded_fields(monkeypatch):
    cfg = Config()
    base = pipeline.run(replace(cfg, llm=replace(cfg.llm, mode="off")))
    monkeypatch.setattr(pipeline, "LLMClient", FakeLLM)
    llm_run = pipeline.run(cfg)
    graded = ["route", "week_of", "cost_per_tonne_km", "vs_own_history", "vs_similar_routes", "flagged", "matched_note_id"]
    a, b = base.contract_rows(), llm_run.contract_rows()
    assert [[r[f] for f in graded] for r in a] == [[r[f] for f in graded] for r in b]
    sources = [r["reason_source"] for r in llm_run.rows if r["flagged"] != "No"]
    assert "llm" in sources and "template" in sources          # hallucinations fell back
    assert not any("N999" in r["reason"] for r in llm_run.rows)
