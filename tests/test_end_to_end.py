"""End-to-end checks on the real files: official sample, traps, Q&A."""
import pytest

from ferro.config import Config
from ferro.pipeline import run
from ferro.qa import Assistant


@pytest.fixture(scope="module")
def result():
    from dataclasses import replace
    cfg = Config()
    return run(replace(cfg, llm=replace(cfg.llm, mode="off")))


def row(result, route, week):
    return next(r for r in result.rows if r["route"] == route and r["week_of"] == week)


def test_official_sample_rows_reproduced(result):
    c = {(r["route"], r["week_of"]): x for r, x in zip(result.rows, result.contract_rows())}
    assert c[("Delhi-Jaipur", "2024-11-11")]["cost_per_tonne_km"] == "4.17"
    assert c[("Delhi-Jaipur", "2024-11-11")]["vs_own_history"] == "+35.5% vs this route's past average"
    assert c[("Delhi-Jaipur", "2024-11-11")]["vs_similar_routes"] == "+21.0% vs similar-length routes this week"
    assert c[("Ahmedabad-Mumbai", "2025-01-20")]["matched_note_id"] == "N002"
    assert c[("Mumbai-Pune", "2025-09-15")]["vs_own_history"].startswith("+9.2%")


def test_flood_window_trap(result):
    assert row(result, "Chennai-Bangalore", "2025-03-03")["matched_note_id"] == "N001"
    assert row(result, "Chennai-Bangalore", "2025-03-10")["flagged"] == "Yes"
    assert row(result, "Chennai-Bangalore", "2025-03-10")["matched_note_id"] == ""


def test_every_route_week_present(result):
    assert len(result.rows) == 7 * 104


def test_qa_answers_from_results(result):
    bot = Assistant(result.rows, result.notes, Config().thresholds)
    a = bot.ask("Why did Chennai-Bangalore get pricier in March 2025?")
    assert a.intent == "why" and "N001" in a.answer and "UNEXPLAINED" in a.answer
    assert {c["week_of"] for c in a.citations} >= {"2025-03-10", "2025-03-17"}
    assert "N003" in bot.ask("what does N003 say?").answer
    assert bot.ask("which routes are flagged?").intent == "flags"
    assert "Nothing was flagged" in bot.ask("why was Delhi-Chennai expensive in May 2025?").answer
