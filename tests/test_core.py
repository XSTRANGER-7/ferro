"""Unit tests for edge cases the brief cares about. Run: python -m pytest -q"""
from datetime import date

import math
import pandas as pd
import pytest

from ferro.config import FLAG_JUSTIFIED, FLAG_YES, Thresholds
from ferro.data import validate_shipments
from ferro.explain import fmt_pct, own_history_text, peer_text, validate_explanation
from ferro.flagging import trigger_for
from ferro.metrics import add_baselines, monday_of, weekly_costs
from ferro.notes import parse_note
from ferro.retrieval import VectorIndex
from ferro.verdict import evaluate_note

T = Thresholds()


def ship(rows):
    cols = ["shipment_id", "origin", "destination", "route_type", "quantity_tonnes", "distance_km",
            "freight_cost_inr", "shipment_date"]
    raw = pd.DataFrame([dict(zip(cols, map(str, r))) for r in rows])
    return validate_shipments(raw)


# ---------------------------------------------------------------- weeks & metrics

def test_monday_of_handles_sunday_and_monday():
    s = pd.Series(pd.to_datetime(["2024-01-01", "2024-01-07", "2024-01-08"]))  # Mon, Sun, Mon
    assert [d.date().isoformat() for d in monday_of(s)] == ["2024-01-01", "2024-01-01", "2024-01-08"]


def test_weekly_cost_is_total_cost_over_total_tonne_km():
    df, _ = ship([("a", "X", "Y", "Short", 10, 100, 1000, "2024-01-01"),   # 1.0 / tkm
                  ("b", "X", "Y", "Short", 10, 100, 3000, "2024-01-02")])  # 3.0 / tkm
    w = weekly_costs(df)
    assert w.loc[0, "cost_per_tonne_km"] == pytest.approx(4000 / 2000)


def _weekly_from(values_by_route, rtype="Short"):
    recs = []
    for route, vals in values_by_route.items():
        for i, v in enumerate(vals):
            if v is None:
                continue  # gap week
            recs.append({"route": route, "route_type": rtype, "week_of": pd.Timestamp("2024-01-01") + pd.Timedelta(weeks=i),
                         "shipments": 1, "total_cost": v, "total_tkm": 1.0, "cost_per_tonne_km": v})
    return add_baselines(pd.DataFrame(recs), 8)


def test_own_baseline_uses_only_prior_weeks_and_at_most_eight():
    w = _weekly_from({"A-B": [1, 1, 1, 1, 1, 1, 1, 1, 2, 9]}).query("route == 'A-B'").reset_index(drop=True)
    assert math.isnan(w.loc[0, "own_baseline"]) and w.loc[0, "own_weeks_used"] == 0
    assert w.loc[3, "own_baseline"] == 1 and w.loc[3, "own_weeks_used"] == 3        # fewer than 8 -> all prior
    assert w.loc[8, "own_baseline"] == 1 and w.loc[8, "own_pct"] == pytest.approx(100)  # current week excluded
    assert w.loc[9, "own_baseline"] == pytest.approx((7 * 1 + 2) / 8)                 # window slides


def test_gap_weeks_are_not_invented():
    w = _weekly_from({"A-B": [1, None, 3]}).query("route == 'A-B'").reset_index(drop=True)
    assert len(w) == 2 and w.loc[1, "own_baseline"] == 1 and w.loc[1, "own_weeks_used"] == 1


def test_peer_average_excludes_the_route_itself():
    w = _weekly_from({"A-B": [2], "C-D": [4], "E-F": [6]})
    row = w[w.route == "A-B"].iloc[0]
    assert row.peer_baseline == pytest.approx(5) and row.peer_routes == ["C-D", "E-F"]


def test_no_peer_gives_nan_not_zero():
    w = _weekly_from({"A-B": [2]})
    assert math.isnan(w.iloc[0].peer_baseline) and peer_text(w.iloc[0].peer_pct).startswith("N/A")


# ---------------------------------------------------------------- data quality

def test_bad_rows_are_quarantined_with_reasons():
    df, dq = ship([("a", "X", "Y", "Short", 10, 100, 1000, "2024-01-01"),
                   ("b", "X", "Y", "Short", 0, 100, 1000, "2024-01-01"),
                   ("c", "X", "Y", "Short", 10, 100, 1000, "not-a-date"),
                   ("a", "X", "Y", "Short", 10, 100, 1000, "2024-01-01"),
                   ("d", " mumbai ", "pune", "short", 10, 100, 1000, "2024-01-01")])
    assert len(df) == 2 and set(df.route) == {"X-Y", "Mumbai-Pune"}
    assert {q["reason"] for q in dq.quarantined} == {"non-positive or missing quantity_tonnes",
                                                      "unparseable shipment_date", "duplicate shipment_id"}


def test_conflicting_route_type_uses_majority_and_warns():
    df, dq = ship([("a", "X", "Y", "Short", 1, 1, 1, "2024-01-01"), ("b", "X", "Y", "Short", 1, 1, 1, "2024-01-01"),
                   ("c", "X", "Y", "Long", 1, 1, 1, "2024-01-01")])
    assert set(df.route_type) == {"Short"} and dq.warnings


# ---------------------------------------------------------------- flagging

def test_trigger_rules():
    assert trigger_for(float("nan"), 50, T) is None            # no history -> cannot show a rise
    assert trigger_for(16, 0, T) == "own"
    assert trigger_for(5, 25, T) == "peer"
    assert trigger_for(-1, 25, T) is None                       # pricier than peers but falling
    assert trigger_for(20, 25, T) == "both"
    assert trigger_for(14.9, 19.9, T) is None


# ---------------------------------------------------------------- notes & gate

def note(nid, d, applies, text):
    return parse_note(nid, date.fromisoformat(d), applies, text)


def test_explicit_range_window_and_effect():
    n = note("N1", "2025-02-24", "Chennai-Bangalore", "Flooding from Feb 24 to Mar 8, forcing higher trip costs.")
    assert (n.window_start, n.window_end, n.effect) == ("2025-02-24", "2025-03-08", "increase")
    assert n.applies_to_route("Bangalore-Chennai") and not n.applies_to_route("Delhi-Chennai")


def test_no_impact_language_wins_over_cost_words():
    n = note("N2", "2024-07-29", "Mumbai-Delhi", "Maintenance caused delays; costs were not significantly affected.")
    assert n.effect == "none" and not n.can_justify


def test_all_routes_outside_dataset_has_no_scope():
    n = note("N3", "2024-03-11", "All Routes", "A new toll plaza... affected routes are not part of this dataset.")
    assert n.scope_kind == "none" and not n.applies_to_route("Mumbai-Pune")


def test_market_wide_note_limits():
    n = note("N4", "2025-05-05", "All Routes", "Diesel prices rose starting this week, pushing up costs by roughly 5-7%.")
    wk = date(2025, 5, 12)
    assert evaluate_note(n, "Mumbai-Delhi", wk, 8.0, "own", T).passed
    assert not evaluate_note(n, "Mumbai-Delhi", wk, 16.0, "own", T).passed          # too big
    assert not evaluate_note(n, "Mumbai-Delhi", wk, 8.0, "peer", T).passed          # peers had it too
    assert not evaluate_note(n, "Mumbai-Delhi", date(2025, 7, 7), 8.0, "own", T).passed  # absorbed


# ---------------------------------------------------------------- retrieval

def test_vector_index_ranks_relevant_doc_first_and_is_deterministic():
    idx = VectorIndex().add(["a", "b"], ["flood on chennai bangalore highway", "festival surcharge ahmedabad"])
    assert idx.search("chennai flood")[0][0] == "a"
    assert idx.search("chennai flood") == idx.search("chennai flood")


# ---------------------------------------------------------------- explanation guardrail

def test_validator_blocks_hallucinations():
    g = 'FACTS: {"vs_own_history_pct": 29.5} DRAFT: Matches note N002 dated 2025-01-20 ... +29.5% rise'
    assert validate_explanation("A festival surcharge (N002) explains the +29.5% rise.", g, FLAG_JUSTIFIED, "N002", ["N002"])[0]
    assert not validate_explanation("Explained by N003 diesel.", g, FLAG_JUSTIFIED, "N002", ["N002"])[0]
    assert not validate_explanation("N002 explains a +31% rise.", g, FLAG_JUSTIFIED, "N002", ["N002"])[0]
    assert not validate_explanation("N002 applies, but this is unexplained.", g, FLAG_JUSTIFIED, "N002", ["N002"])[0]
    assert not validate_explanation("Costs went up 29.5%.", g, FLAG_YES, None, [])[0]  # must say unexplained


def test_percent_formatting_never_shows_negative_zero():
    assert fmt_pct(-0.04) == "+0.0%" and fmt_pct(35.46) == "+35.5%" and fmt_pct(-3.25) == "-3.2%"
    assert own_history_text(float("nan")) == "N/A (no prior weeks)"
