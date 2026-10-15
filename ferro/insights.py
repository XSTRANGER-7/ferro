"""Reviewer aids: shipment-level drill-down and threshold what-if simulation.

These never change a verdict. They help a human decide what to do about one.
"""
from __future__ import annotations

import csv
from dataclasses import replace
from datetime import date, timedelta

import pandas as pd

from .config import FLAG_NO, Config
from .metrics import monday_of

CLEARLY_ABOVE = 0.10  # a shipment counts as "clearly above" when >10% over the route's recent average


def week_drilldown(shipments: pd.DataFrame, row: dict) -> dict:
    """Shipments behind one route-week, and how widespread the price change was."""
    wk = date.fromisoformat(row["week_of"])
    df = shipments[(shipments["route"] == row["route"])].copy()
    df["week_of"] = monday_of(df["shipment_date"]).dt.date
    df["cpt"] = df["freight_cost_inr"] / df["tonne_km"]
    cur = df[df["week_of"] == wk].sort_values(["shipment_date", "shipment_id"])
    base = row.get("own_baseline")

    prior_start = wk - timedelta(weeks=8)
    prior = df[(df["week_of"] < wk) & (df["week_of"] >= prior_start)]
    prior_by_t = (prior.groupby("transporter").apply(lambda g: g["freight_cost_inr"].sum() / g["tonne_km"].sum(),
                                                     include_groups=False).to_dict() if len(prior) else {})

    items = []
    for s in cur.itertuples():
        pct = (s.cpt / base - 1) * 100 if base else None
        items.append({
            "shipment_id": s.shipment_id, "date": s.shipment_date.date().isoformat(), "transporter": s.transporter,
            "material": s.material, "tonnes": float(s.quantity_tonnes), "km": float(s.distance_km),
            "cost": float(s.freight_cost_inr), "cost_per_tonne_km": float(s.cpt), "pct_vs_baseline": pct,
            "clearly_above": bool(pct is not None and pct > CLEARLY_ABOVE * 100),
        })

    transporters = []
    for t, g in cur.groupby("transporter", sort=True):
        now = g["freight_cost_inr"].sum() / g["tonne_km"].sum()
        before = prior_by_t.get(t)
        transporters.append({"transporter": t, "shipments": int(len(g)), "cost_per_tonne_km": float(now),
                             "prior_8wk": float(before) if before else None,
                             "change_pct": float((now / before - 1) * 100) if before else None})

    above = [i for i in items if i["clearly_above"]]
    n, k = len(items), len(above)
    carriers_above = sorted({i["transporter"] for i in above})
    peer = row.get("peer_baseline")
    if row.get("trigger") == "peer" and peer and n:
        over_peer = sum(i["cost_per_tonne_km"] > peer for i in items)
        pattern = "gradual_drift"
        insight = (f"Gradual drift: shipments are only slightly above this route's own (already rising) average, "
                   f"but {over_peer} of {n} cost more than the similar-route average of ₹{peer:.2f}/t-km. "
                   f"The route has crept up over many weeks. Benchmark its rate card against "
                   f"{', '.join(row.get('peer_routes') or ['peer routes'])}.")
    elif base is None or n == 0:
        pattern, insight = "unknown", "No history to compare shipments against yet."
    elif k == 0:
        pattern, insight = "none", "No individual shipment was priced clearly (>10%) above the route's recent average."
    elif k / n >= 0.75 and len(carriers_above) >= 2:
        pattern = "route_wide"
        insight = (f"Route-wide: {k} of {n} shipments, across {len(carriers_above)} transporters, were priced more than "
                   f"10% above the route's recent average. This looks like a route or market change, not one carrier. "
                   f"Ask for the cause (fuel, tolls, detours) before negotiating.")
    elif len(carriers_above) == 1:
        pattern = "single_carrier"
        insight = (f"Concentrated: the high-priced shipments all came from {carriers_above[0]}. "
                   f"Check that transporter's invoices and rate card first.")
    else:
        pattern = "mixed"
        insight = (f"Mixed: {k} of {n} shipments were priced clearly above the route's recent average "
                   f"({', '.join(carriers_above)}).")
    return {"route": row["route"], "week_of": row["week_of"], "baseline": base, "shipments": items,
            "transporters": transporters, "pattern": pattern, "insight": insight,
            "above_count": k, "total": n}


def simulate(cfg: Config, own_pct: float, peer_pct: float, base_rows: list[dict]) -> dict:
    """Re-run the real pipeline with different thresholds and report what changes."""
    from .pipeline import run
    own_pct = max(1.0, min(100.0, float(own_pct)))
    peer_pct = max(1.0, min(100.0, float(peer_pct)))
    c = replace(cfg, thresholds=replace(cfg.thresholds, own_history_pct=own_pct, peer_pct=peer_pct),
                llm=replace(cfg.llm, mode="off"))
    res = run(c)
    base = {(r["route"], r["week_of"]): r for r in base_rows}
    changes = []
    for r in res.rows:
        b = base[(r["route"], r["week_of"])]
        if (r["flagged"], r["matched_note_id"]) != (b["flagged"], b["matched_note_id"]):
            changes.append({"route": r["route"], "week_of": r["week_of"], "before": b["flagged"], "after": r["flagged"],
                            "note": r["matched_note_id"], "own_pct": r["own_pct"], "peer_pct": r["peer_pct"]})
    labels_path = cfg.paths.eval_dir / "labeled_cases.csv"
    acc = None
    if labels_path.exists():
        by = {(r["route"], r["week_of"]): r for r in res.rows}
        with open(labels_path, newline="", encoding="utf-8") as fh:
            labels = list(csv.DictReader(fh))
        hits = sum((by[(l["route"], l["week_of"])]["flagged"], by[(l["route"], l["week_of"])]["matched_note_id"])
                   == (l["expected_flagged"], l["expected_note_id"]) for l in labels)
        acc = {"correct": hits, "total": len(labels)}
    return {
        "own_pct": own_pct, "peer_pct": peer_pct, "flag_counts": res.meta["flag_counts"],
        "flagged": [{"route": r["route"], "week_of": r["week_of"], "flagged": r["flagged"],
                     "note": r["matched_note_id"]} for r in res.rows if r["flagged"] != FLAG_NO],
        "changes": changes, "label_accuracy": acc,
    }
