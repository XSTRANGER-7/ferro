"""Reviewer aids: shipment drill-down patterns and the threshold what-if simulation."""
from dataclasses import replace

import pytest

from ferro.config import Config
from ferro.data import load_shipments
from ferro.insights import simulate, week_drilldown
from ferro.pipeline import run


@pytest.fixture(scope="module")
def ctx():
    cfg = Config()
    cfg = replace(cfg, llm=replace(cfg.llm, mode="off"))
    res = run(cfg)
    ships, _ = load_shipments(cfg.paths.shipments)
    return cfg, {(r["route"], r["week_of"]): r for r in res.rows}, ships, res


def test_route_wide_spike_is_recognised(ctx):
    _, rows, ships, _ = ctx
    d = week_drilldown(ships, rows[("Delhi-Jaipur", "2024-11-11")])
    assert d["pattern"] == "route_wide" and d["above_count"] == d["total"] == 4
    assert {t["transporter"] for t in d["transporters"]} == {"Om Sai Transport", "Speedway Logistics", "Trident Carriers"}


def test_creep_is_described_against_peers(ctx):
    _, rows, ships, _ = ctx
    d = week_drilldown(ships, rows[("Mumbai-Pune", "2025-12-08")])
    assert d["pattern"] == "gradual_drift" and "Delhi-Jaipur" in d["insight"]


def test_normal_week_has_no_outliers(ctx):
    _, rows, ships, _ = ctx
    assert week_drilldown(ships, rows[("Mumbai-Delhi", "2024-07-29")])["pattern"] == "none"


def test_simulation_matches_pipeline_and_reports_changes(ctx):
    cfg, _, _, res = ctx
    same = simulate(cfg, 15, 20, res.rows)
    assert same["changes"] == [] and same["flag_counts"] == res.meta["flag_counts"]
    strict = simulate(cfg, 10, 15, res.rows)
    assert strict["flag_counts"]["Yes"] > res.meta["flag_counts"]["Yes"]
    assert all(c["before"] != c["after"] for c in strict["changes"])
    assert strict["label_accuracy"]["total"] == 20
