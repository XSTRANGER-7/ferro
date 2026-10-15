"""Write run outputs. No wall-clock timestamps, so repeated runs give byte-identical files."""
from __future__ import annotations

import csv
import json
from pathlib import Path

from .config import CONTRACT_COLUMNS, FLAG_NO
from .pipeline import RunResult


def write_contract_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CONTRACT_COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def run_payload(result: RunResult) -> dict:
    return {
        "meta": {**result.meta, "input_fingerprint": result.input_fingerprint},
        "data_quality": result.data_quality.to_dict(),
        "notes": [n.to_dict() for n in result.notes],
        "rows": result.rows,
        "token_log": result.ledger.summary(),
    }


def write_outputs(result: RunResult, out_dir: Path) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    contract = result.contract_rows()
    paths = {
        "results": out_dir / "results.csv",            # every route-week, contract format
        "flagged": out_dir / "flagged_results.csv",     # only rows that rose past a threshold
        "run": out_dir / "run.json",                    # enriched: baselines, evidence, check traces
        "token_log": out_dir / "token_log.json",
    }
    write_contract_csv(contract, paths["results"])
    write_contract_csv([c for c in contract if c["flagged"] != FLAG_NO], paths["flagged"])
    paths["run"].write_text(json.dumps(run_payload(result), indent=1, default=str), encoding="utf-8")
    ledger = result.ledger.summary()
    ledger["entries"] = [e.__dict__ for e in result.ledger.entries]
    paths["token_log"].write_text(json.dumps(ledger, indent=2), encoding="utf-8")
    return paths
