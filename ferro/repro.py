"""Reproducibility check: three untouched runs in fresh processes, then diff everything."""
from __future__ import annotations

import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path

from .config import ROOT, Config

GRADED = ["route", "week_of", "cost_per_tonne_km", "vs_own_history", "vs_similar_routes", "flagged", "matched_note_id"]


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _rows(p: Path) -> list[dict]:
    with open(p, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def check(n_runs: int = 3, cfg: Config | None = None) -> dict:
    cfg = cfg or Config()
    base = cfg.paths.output_dir / "repro"
    runs = []
    for i in range(1, n_runs + 1):
        out = base / f"run_{i}"
        proc = subprocess.run([sys.executable, "-m", "ferro", "run", "--out", str(out), "--quiet"],
                              cwd=ROOT, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"run {i} failed:\n{proc.stderr}")
        runs.append(out)

    ref = _rows(runs[0] / "results.csv")
    report = {"runs": n_runs, "files": {}, "graded_field_diffs": 0, "reason_text_diffs": 0, "per_run": []}
    for out in runs:
        rows = _rows(out / "results.csv")
        graded = sum(a[f] != b[f] for a, b in zip(ref, rows) for f in GRADED) + abs(len(ref) - len(rows))
        reasons = sum(a["reason"] != b["reason"] for a, b in zip(ref, rows))
        report["graded_field_diffs"] += graded
        report["reason_text_diffs"] += reasons
        tl = json.loads((out / "token_log.json").read_text(encoding="utf-8"))
        report["per_run"].append({
            "run": out.name, "rows": len(rows),
            "flag_counts": {k: sum(r["flagged"] == k for r in rows) for k in ("Yes", "No (justified)", "No")},
            "results_sha256": _sha(out / "results.csv"), "run_json_sha256": _sha(out / "run.json"),
            "llm_api_calls": tl["billable_api_calls"]["calls"], "llm_cache_hits": tl["served_from_cache"]["calls"],
        })
    for name in ("results.csv", "flagged_results.csv", "run.json"):
        hashes = sorted({_sha(o / name) for o in runs})
        report["files"][name] = {"identical": len(hashes) == 1, "sha256": hashes}
    report["identical"] = report["graded_field_diffs"] == 0 and all(f["identical"] for k, f in report["files"].items()
                                                                     if k != "run.json" or report["reason_text_diffs"] == 0)
    (cfg.paths.output_dir / "repro_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (cfg.paths.output_dir / "repro_report.md").write_text(to_markdown(report), encoding="utf-8")
    return report


def to_markdown(r: dict) -> str:
    lines = ["# Reproducibility check", "",
             f"{r['runs']} untouched runs, each in a **fresh Python process**, same input files.", "",
             f"* Graded-field differences (route, week, cost, both comparisons, flag, note id): **{r['graded_field_diffs']}**",
             f"* Reason-text differences: **{r['reason_text_diffs']}**",
             f"* Verdict: **{'IDENTICAL ✅' if r['identical'] else 'DIFFERENT ❌'}**", "",
             "| run | rows | Yes | No (justified) | No | LLM API calls | cache hits | results.csv sha256 |",
             "|---|---|---|---|---|---|---|---|"]
    for p in r["per_run"]:
        fc = p["flag_counts"]
        lines.append(f"| {p['run']} | {p['rows']} | {fc['Yes']} | {fc['No (justified)']} | {fc['No']} | "
                     f"{p['llm_api_calls']} | {p['llm_cache_hits']} | `{p['results_sha256'][:16]}…` |")
    lines += ["", "| file | identical across runs |", "|---|---|"]
    for name, f in r["files"].items():
        lines.append(f"| {name} | {'✅' if f['identical'] else '❌'} ({len(f['sha256'])} distinct hash) |")
    lines += ["", "Randomness: the verdict path has none (no sampling, sorted iteration, fixed formatting). The optional "
              "LLM runs at temperature 0 with seed 7, and its responses are cached by prompt hash. It only rephrases "
              "reason text; validated fields come from code, so the LLM cannot move a flag, note id or number."]
    return "\n".join(lines) + "\n"
