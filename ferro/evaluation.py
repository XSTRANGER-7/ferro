"""Eval harness: why we trust the output enough to submit it.

Suites
  1. official_sample    our numbers vs the three rows in sample_output_format_v2.csv
  2. labeled_cases      20 hand-labeled route-weeks (anomalies, justified rises, decoys, edge cases)
  3. note_parsing       parser output vs an independently written reading of every note
  4. guardrails         18 adversarial "would this note justify it?" probes through the gate
  5. retrieval          recall@k / MRR of the RAG step for every case where a note should match
  6. hallucination      every justified output row re-checked against the ground-truth note reading
  7. contract           columns, order and value formats of results.csv
  8. sensitivity        how flag counts and label accuracy move with the thresholds
"""
from __future__ import annotations

import csv
import json
import re
from dataclasses import replace
from datetime import date
from pathlib import Path

from .config import CONTRACT_COLUMNS, FLAG_JUSTIFIED, FLAG_NO, FLAG_YES, Config
from .notes import NoteFact
from .pipeline import RunResult, run
from .retrieval import NoteRetriever
from .verdict import evaluate_note, pick_justification


def _read_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _suite(name: str, cases: list[dict]) -> dict:
    passed = sum(c["pass"] for c in cases)
    return {"suite": name, "passed": passed, "total": len(cases), "ok": passed == len(cases), "cases": cases}


def official_sample(result: RunResult, cfg: Config) -> dict:
    by_key = {(r["route"], r["week_of"]): c for r, c in zip(result.rows, result.contract_rows())}
    cases = []
    for s in _read_csv(cfg.paths.sample_format):
        ours = by_key.get((s["route"], s["week_of"]))
        fields = ["cost_per_tonne_km", "vs_own_history", "vs_similar_routes", "flagged", "matched_note_id"]
        diffs = {f: (s[f], ours[f]) for f in fields if ours is None or s[f] != ours[f]}
        cases.append({"id": f"{s['route']} {s['week_of']}", "pass": not diffs,
                      "detail": "all graded fields identical" if not diffs else f"differs: {diffs}"})
    return _suite("official_sample", cases)


def labeled(result: RunResult, cfg: Config) -> dict:
    by_key = {(r["route"], r["week_of"]): r for r in result.rows}
    cases = []
    for c in _read_csv(cfg.paths.eval_dir / "labeled_cases.csv"):
        r = by_key.get((c["route"], c["week_of"]))
        got = (r["flagged"], r["matched_note_id"]) if r else ("<missing>", "")
        ok = got == (c["expected_flagged"], c["expected_note_id"])
        cases.append({"id": c["case_id"], "pass": ok, "route": c["route"], "week_of": c["week_of"],
                      "expected": f"{c['expected_flagged']} {c['expected_note_id']}".strip(),
                      "got": f"{got[0]} {got[1]}".strip(), "why": c["why_this_label"]})
    return _suite("labeled_cases", cases)


def _ground_truth(cfg: Config) -> dict:
    gt = json.loads((cfg.paths.eval_dir / "note_ground_truth.json").read_text(encoding="utf-8"))
    gt.pop("_comment", None)
    return gt


def note_parsing(result: RunResult, cfg: Config) -> dict:
    gt = _ground_truth(cfg)
    cases = []
    for n in result.notes:
        g = gt[n.note_id]
        scope = "ALL" if n.scope_kind == "all" else "NONE" if n.scope_kind == "none" else n.corridor
        checks = {
            "scope": scope == g["corridor"],
            "window_start": n.window_start == g["window_start"],
            "window_end": g["window_end"] is None or n.window_end == g["window_end"],
            "can_justify": n.can_justify == g["can_justify"],
            "magnitude": n.magnitude_pct == g.get("magnitude", n.magnitude_pct) if "magnitude" in g else True,
        }
        cases.append({"id": n.note_id, "pass": all(checks.values()),
                      "detail": ", ".join(k for k, v in checks.items() if not v) or "matches", "why": g["why"]})
    return _suite("note_parsing", cases)


def guardrails(result: RunResult, cfg: Config) -> dict:
    facts = {n.note_id: n for n in result.notes}
    cases = []
    for c in _read_csv(cfg.paths.eval_dir / "guardrail_cases.csv"):
        week = date.fromisoformat(c["week_of"])
        # Exhaustive: every note goes through the gate, not just retrieved ones.
        evals = [evaluate_note(f, c["route"], week, float(c["own_pct"]), c["trigger"], cfg.thresholds)
                 for f in facts.values()]
        win = pick_justification(evals, facts, week)
        got = win.note_id if win else ""
        cases.append({"id": c["case_id"], "pass": got == c["expected_note_id"], "attack": c["attack"],
                      "expected": c["expected_note_id"] or "(none)", "got": got or "(none)"})
    return _suite("guardrails", cases)


def retrieval(result: RunResult, cfg: Config) -> dict:
    retriever = NoteRetriever(result.notes)
    targets = [(c["route"], c["week_of"], c["expected_note_id"])
               for c in _read_csv(cfg.paths.eval_dir / "guardrail_cases.csv") if c["expected_note_id"]]
    targets += [(c["route"], c["week_of"], c["expected_note_id"])
                for c in _read_csv(cfg.paths.eval_dir / "labeled_cases.csv") if c["expected_note_id"]]
    cases, rr = [], []
    for route, wk, nid in sorted(set(targets)):
        ranked = [h.note_id for h in retriever.retrieve(route, date.fromisoformat(wk), top_k=len(result.notes))]
        rank = ranked.index(nid) + 1
        rr.append(1 / rank)
        cases.append({"id": f"{route} {wk} -> {nid}", "pass": rank <= cfg.retrieval_top_k, "rank": rank,
                      "top_k": ranked[: cfg.retrieval_top_k]})
    s = _suite("retrieval", cases)
    s["recall_at_k"] = round(s["passed"] / max(1, s["total"]), 3)
    s["mrr"] = round(sum(rr) / max(1, len(rr)), 3)
    s["k"] = cfg.retrieval_top_k
    return s


def hallucination(result: RunResult, cfg: Config) -> dict:
    gt = _ground_truth(cfg)
    cases = []
    for r in result.rows:
        if r["flagged"] != FLAG_JUSTIFIED:
            if r["flagged"] == FLAG_YES and r["matched_note_id"]:
                cases.append({"id": f"{r['route']} {r['week_of']}", "pass": False,
                              "detail": "flagged row carries a note id"})
            continue
        g = gt.get(r["matched_note_id"])
        wk = date.fromisoformat(r["week_of"])
        problems = []
        if not g:
            problems.append("cited note does not exist")
        else:
            if not g["can_justify"]:
                problems.append("note does not describe a cost rise")
            if g["corridor"] == "NONE" or (g["corridor"] != "ALL" and
                                            sorted(g["corridor"]) != sorted(r["route"].split("-"))):
                problems.append("wrong route")
            ws = date.fromisoformat(g["window_start"])
            we = date.fromisoformat(g["window_end"]) if g["window_end"] else date.max
            if not (ws <= date.fromordinal(wk.toordinal() + 6) and we >= wk):
                problems.append("wrong window")
            if r["matched_note_id"] not in r["reason"]:
                problems.append("reason text does not name the note")
        cases.append({"id": f"{r['route']} {r['week_of']} -> {r['matched_note_id']}", "pass": not problems,
                      "detail": "; ".join(problems) or "route, window and effect all check out"})
    s = _suite("hallucination_audit", cases)
    s["fabricated"] = s["total"] - s["passed"]
    return s


def contract(result: RunResult, cfg: Config) -> dict:
    out = cfg.paths.output_dir / "results.csv"
    cases = []
    with open(out, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        header = reader.fieldnames
        rows = list(reader)
    with open(cfg.paths.sample_format, newline="", encoding="utf-8") as fh:
        sample_header = next(csv.reader(fh))
    cases.append({"id": "header matches sample exactly", "pass": header == sample_header == CONTRACT_COLUMNS,
                  "detail": str(header)})
    pct = re.compile(r"^[+-]\d+\.\d% vs |^N/A \(")
    bad = [r for r in rows if not (re.fullmatch(r"\d+\.\d{2}", r["cost_per_tonne_km"])
                                   and re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["week_of"])
                                   and pct.match(r["vs_own_history"]) and pct.match(r["vs_similar_routes"])
                                   and r["flagged"] in (FLAG_YES, FLAG_JUSTIFIED, FLAG_NO)
                                   and (r["matched_note_id"] == "" or re.fullmatch(r"N\d{3}", r["matched_note_id"]))
                                   and (r["matched_note_id"] != "") == (r["flagged"] == FLAG_JUSTIFIED)
                                   and r["reason"])]
    cases.append({"id": "every row has valid types/formats", "pass": not bad, "detail": f"{len(rows)} rows, {len(bad)} invalid"})
    mondays = all(date.fromisoformat(r["week_of"]).weekday() == 0 for r in rows)
    cases.append({"id": "every week_of is a Monday", "pass": mondays, "detail": ""})
    keys = [(r["route"], r["week_of"]) for r in rows]
    cases.append({"id": "one row per route-week", "pass": len(keys) == len(set(keys)), "detail": ""})
    return _suite("contract", cases)


def sensitivity(cfg: Config) -> dict:
    labels = _read_csv(cfg.paths.eval_dir / "labeled_cases.csv")
    grid = []
    for own in (10.0, 12.5, 15.0, 17.5, 20.0):
        for peer in (15.0, 20.0, 25.0):
            c = replace(cfg, thresholds=replace(cfg.thresholds, own_history_pct=own, peer_pct=peer),
                        llm=replace(cfg.llm, mode="off"))
            res = run(c)
            by_key = {(r["route"], r["week_of"]): r for r in res.rows}
            acc = sum((by_key[(l["route"], l["week_of"])]["flagged"], by_key[(l["route"], l["week_of"])]["matched_note_id"])
                      == (l["expected_flagged"], l["expected_note_id"]) for l in labels)
            grid.append({"own_pct": own, "peer_pct": peer, "flagged_yes": res.meta["flag_counts"][FLAG_YES],
                         "justified": res.meta["flag_counts"][FLAG_JUSTIFIED], "label_accuracy": f"{acc}/{len(labels)}"})
    return {"suite": "sensitivity", "grid": grid}


def run_all(cfg: Config | None = None, with_sensitivity: bool = True) -> dict:
    cfg = cfg or Config()
    from .report import write_outputs
    result = run(cfg)
    write_outputs(result, cfg.paths.output_dir)
    suites = [official_sample(result, cfg), labeled(result, cfg), note_parsing(result, cfg),
              guardrails(result, cfg), retrieval(result, cfg), hallucination(result, cfg), contract(result, cfg)]
    report = {
        "all_passed": all(s["ok"] for s in suites),
        "summary": {s["suite"]: f"{s['passed']}/{s['total']}" for s in suites},
        "suites": suites,
    }
    if with_sensitivity:
        report["sensitivity"] = sensitivity(cfg)
    return report


def to_markdown(report: dict) -> str:
    lines = ["# Evaluation report", "", f"**All suites passed:** {'✅ yes' if report['all_passed'] else '❌ no'}", "",
             "| Suite | Result |", "|---|---|"]
    for s in report["suites"]:
        extra = ""
        if s["suite"] == "retrieval":
            extra = f" (recall@{s['k']} = {s['recall_at_k']}, MRR = {s['mrr']})"
        if s["suite"] == "hallucination_audit":
            extra = f" (fabricated = {s['fabricated']})"
        lines.append(f"| {s['suite']} | {'✅' if s['ok'] else '❌'} {s['passed']}/{s['total']}{extra} |")
    for s in report["suites"]:
        lines += ["", f"## {s['suite']}", "", "| id | pass | detail |", "|---|---|---|"]
        for c in s["cases"]:
            detail = c.get("detail") or c.get("attack") or c.get("why") or ""
            if "expected" in c:
                detail = f"expected `{c['expected']}`, got `{c['got']}` — {detail}"
            if "rank" in c:
                detail = f"rank {c['rank']}; top-k {c['top_k']}"
            lines.append(f"| {c['id']} | {'✅' if c['pass'] else '❌'} | {detail} |")
    if "sensitivity" in report:
        lines += ["", "## Threshold sensitivity", "",
                  "| own-history % | peer % | flagged (Yes) | justified | label accuracy |", "|---|---|---|---|---|"]
        for g in report["sensitivity"]["grid"]:
            mark = " ← chosen" if (g["own_pct"], g["peer_pct"]) == (15.0, 20.0) else ""
            lines.append(f"| {g['own_pct']:g} | {g['peer_pct']:g} | {g['flagged_yes']} | {g['justified']} | "
                         f"{g['label_accuracy']}{mark} |")
    return "\n".join(lines) + "\n"
