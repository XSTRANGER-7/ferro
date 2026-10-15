"""Command line: python -m ferro <run|eval|repro|ask|serve>"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import replace
from pathlib import Path

from .config import Config


def _config(args) -> Config:
    cfg = Config()
    if getattr(args, "no_llm", False):
        cfg = replace(cfg, llm=replace(cfg.llm, mode="off"))
    if getattr(args, "out", None):
        cfg = replace(cfg, paths=replace(cfg.paths, output_dir=Path(args.out)))
    return cfg


def cmd_run(args) -> int:
    from .pipeline import run
    from .report import write_outputs
    cfg = _config(args)
    t0 = time.perf_counter()
    result = run(cfg)
    paths = write_outputs(result, cfg.paths.output_dir)
    if not args.quiet:
        fc = result.meta["flag_counts"]
        tl = result.ledger.summary()
        print(f"Ferro run complete in {time.perf_counter() - t0:.1f}s")
        print(f"  {result.meta['route_weeks']} route-weeks | {len(result.meta['routes'])} routes | "
              f"{result.meta['first_week']} → {result.meta['last_week']}")
        print(f"  Flagged (unexplained): {fc['Yes']} | Justified by note: {fc['No (justified)']} | Normal: {fc['No']}")
        print(f"  Data quality: {result.data_quality.rows_used}/{result.data_quality.rows_read} rows used, "
              f"{len(result.data_quality.quarantined)} quarantined")
        llm = tl["billable_api_calls"]
        print(f"  LLM: {'on (' + tl['model'] + ')' if tl['llm_enabled'] else 'off (template explanations)'} | "
              f"API calls {llm['calls']} | cache hits {tl['served_from_cache']['calls']} | ${llm['cost_usd']:.6f}")
        for k, p in paths.items():
            print(f"  → {k}: {p}")
    return 0


def cmd_eval(args) -> int:
    from .evaluation import run_all, to_markdown
    cfg = _config(args)
    report = run_all(cfg, with_sensitivity=not args.fast)
    out = cfg.paths.output_dir
    (out / "eval_report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    (out / "eval_report.md").write_text(to_markdown(report), encoding="utf-8")
    for s in report["suites"]:
        extra = f"  recall@{s['k']}={s['recall_at_k']} MRR={s['mrr']}" if s["suite"] == "retrieval" else ""
        print(f"  {'PASS' if s['ok'] else 'FAIL'}  {s['suite']:<20} {s['passed']}/{s['total']}{extra}")
        for c in s["cases"]:
            if not c["pass"]:
                print(f"        ✗ {c['id']}: {c.get('detail') or c.get('got')}")
    print(f"→ {out / 'eval_report.md'}")
    return 0 if report["all_passed"] else 1


def cmd_repro(args) -> int:
    from .repro import check
    r = check(args.runs, _config(args))
    print(f"{r['runs']} runs | graded diffs {r['graded_field_diffs']} | reason diffs {r['reason_text_diffs']} | "
          f"{'IDENTICAL' if r['identical'] else 'DIFFERENT'}")
    for p in r["per_run"]:
        print(f"  {p['run']}: {p['flag_counts']} sha={p['results_sha256'][:16]}")
    return 0 if r["identical"] else 1


def cmd_ask(args) -> int:
    from .llm import LLMClient
    from .pipeline import run
    from .qa import Assistant
    cfg = _config(args)
    result = run(cfg)
    bot = Assistant(result.rows, result.notes, cfg.thresholds, LLMClient(cfg.llm, cfg.paths.cache_dir, result.ledger))
    questions = [" ".join(args.question)] if args.question else None
    if questions is None:
        print("Ask about the findings (blank line to quit).")
        while True:
            try:
                q = input("you › ").strip()
            except EOFError:
                break
            if not q:
                break
            print(bot.ask(q).answer, "\n")
        return 0
    print(bot.ask(questions[0]).answer)
    return 0


def cmd_serve(args) -> int:
    from .server import serve
    serve(_config(args), host=args.host, port=args.port)
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="ferro", description="Watch freight costs and explain unjustified rises.")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--no-llm", action="store_true", help="force template explanations")
        sp.add_argument("--out", help="output directory (default ./output)")

    sp = sub.add_parser("run", help="full run → output/results.csv + run.json + token_log.json")
    common(sp)
    sp.add_argument("--quiet", action="store_true")
    sp.set_defaults(fn=cmd_run)

    sp = sub.add_parser("eval", help="run the evaluation harness")
    common(sp)
    sp.add_argument("--fast", action="store_true", help="skip the threshold sensitivity grid")
    sp.set_defaults(fn=cmd_eval)

    sp = sub.add_parser("repro", help="N fresh-process runs + diff")
    common(sp)
    sp.add_argument("--runs", type=int, default=3)
    sp.set_defaults(fn=cmd_repro)

    sp = sub.add_parser("ask", help="ask a question about the findings")
    common(sp)
    sp.add_argument("question", nargs="*")
    sp.set_defaults(fn=cmd_ask)

    sp = sub.add_parser("serve", help="launch the web dashboard")
    common(sp)
    sp.add_argument("--host", default="127.0.0.1")
    sp.add_argument("--port", type=int, default=8765)
    sp.set_defaults(fn=cmd_serve)

    args = p.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    return args.fn(args)
