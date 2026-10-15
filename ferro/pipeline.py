"""One end-to-end run: load -> weekly metrics -> flag -> retrieve -> verdict -> explain."""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from datetime import date

import pandas as pd

from .config import FLAG_JUSTIFIED, FLAG_NO, FLAG_YES, Config
from .data import DataQuality, load_notes, load_shipments
from .explain import explain_candidate, own_history_text, peer_text, template_reason
from .flagging import trigger_for
from .llm import LLMClient, TokenLedger
from .metrics import add_baselines, weekly_costs
from .notes import NoteFact, parse_notes
from .retrieval import NoteRetriever
from .verdict import NoteEvaluation, evaluate_note, pick_justification


@dataclass
class RunResult:
    rows: list[dict]                       # one enriched dict per route-week, sorted (route, week_of)
    notes: list[NoteFact]
    data_quality: DataQuality
    ledger: TokenLedger
    config: Config
    input_fingerprint: str = ""
    meta: dict = field(default_factory=dict)

    def contract_rows(self) -> list[dict]:
        return [{
            "route": r["route"], "week_of": r["week_of"],
            "cost_per_tonne_km": f"{r['cost_per_tonne_km']:.2f}",
            "vs_own_history": r["vs_own_history"], "vs_similar_routes": r["vs_similar_routes"],
            "flagged": r["flagged"], "matched_note_id": r["matched_note_id"], "reason": r["reason"],
        } for r in self.rows]


def _fingerprint(*paths) -> str:
    h = hashlib.sha256()
    for p in paths:
        h.update(open(p, "rb").read())
    return h.hexdigest()[:16]


def _nan_to_none(x):
    return None if isinstance(x, float) and math.isnan(x) else x


def run(config: Config | None = None, shipments_path=None, notes_path=None) -> RunResult:
    cfg = config or Config()
    t = cfg.thresholds
    shipments_path = shipments_path or cfg.paths.shipments
    notes_path = notes_path or cfg.paths.notes

    shipments, dq = load_shipments(shipments_path)
    notes_df = load_notes(notes_path)
    facts = parse_notes(notes_df, t.level_shift_active_weeks)
    facts_by_id = {f.note_id: f for f in facts}
    retriever = NoteRetriever(facts)

    weekly = add_baselines(weekly_costs(shipments), t.history_weeks)
    ledger = TokenLedger(cfg.llm)
    llm = LLMClient(cfg.llm, cfg.paths.cache_dir, ledger)

    rows: list[dict] = []
    for rec in weekly.to_dict("records"):
        week: date = rec["week_of"].date()
        row = {
            "route": rec["route"], "route_type": rec["route_type"], "week_of": week.isoformat(),
            "shipments": int(rec["shipments"]), "total_cost": float(rec["total_cost"]),
            "total_tkm": float(rec["total_tkm"]), "cost_per_tonne_km": float(rec["cost_per_tonne_km"]),
            "own_baseline": float(rec["own_baseline"]), "own_weeks_used": int(rec["own_weeks_used"]),
            "own_pct": float(rec["own_pct"]), "peer_baseline": float(rec["peer_baseline"]),
            "peer_routes": rec["peer_routes"], "peer_pct": float(rec["peer_pct"]),
        }
        row["trigger"] = trigger_for(row["own_pct"], row["peer_pct"], t)
        row["vs_own_history"] = own_history_text(row["own_pct"])
        row["vs_similar_routes"] = peer_text(row["peer_pct"])
        row["retrieved"], row["evaluations"] = [], []
        matched: NoteFact | None = None
        closest_eval: NoteEvaluation | None = None

        if row["trigger"] is None:
            flagged = FLAG_NO
            row["reason"] = template_reason(row, flagged, None, None, None, t)
            row["reason_source"] = "template"
        else:
            hits = retriever.retrieve(row["route"], week, cfg.retrieval_top_k)
            evals = [evaluate_note(facts_by_id[h.note_id], row["route"], week, row["own_pct"], row["trigger"], t)
                     for h in hits]
            winner = pick_justification(evals, facts_by_id, week)
            if winner:
                flagged, matched = FLAG_JUSTIFIED, facts_by_id[winner.note_id]
            else:
                flagged = FLAG_YES
                # "Closest" note to mention in the reason: it must at least cover this route. Prefer
                # the one that came nearest to passing (most checks passed), then a route-specific
                # note, then the nearest in time.
                in_scope = [e for e in evals if e.checks[0].passed]
                if in_scope:
                    closest_eval = sorted(in_scope, key=lambda e: (
                        -sum(c.passed for c in e.checks),
                        facts_by_id[e.note_id].scope_kind != "corridor",
                        facts_by_id[e.note_id].days_from(week),
                        e.note_id))[0]
            reason, source = explain_candidate(
                row, flagged, matched, closest_eval,
                facts_by_id[closest_eval.note_id] if closest_eval else None, t,
                llm)
            row["reason"], row["reason_source"] = reason, source
            row["retrieved"] = [h.to_dict() for h in hits]
            row["evaluations"] = [e.to_dict() for e in evals]

        row["flagged"] = flagged
        row["matched_note_id"] = matched.note_id if matched else ""
        row["closest_note_id"] = closest_eval.note_id if closest_eval else ""
        for k in ("own_baseline", "own_pct", "peer_baseline", "peer_pct"):
            row[k] = _nan_to_none(row[k])
        rows.append(row)

    rows.sort(key=lambda r: (r["route"], r["week_of"]))
    result = RunResult(rows=rows, notes=facts, data_quality=dq, ledger=ledger, config=cfg,
                       input_fingerprint=_fingerprint(shipments_path, notes_path))
    result.meta = {
        "routes": sorted({r["route"] for r in rows}),
        "weeks": len({r["week_of"] for r in rows}),
        "route_weeks": len(rows),
        "first_week": min(r["week_of"] for r in rows) if rows else None,
        "last_week": max(r["week_of"] for r in rows) if rows else None,
        "flag_counts": {k: sum(r["flagged"] == k for r in rows) for k in (FLAG_YES, FLAG_JUSTIFIED, FLAG_NO)},
        "thresholds": t.__dict__,
    }
    return result
