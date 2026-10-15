# Workflows

## 1. Runtime workflow (one run)

```
 ┌───────────────┐   ┌─────────────────┐   ┌─────────────────────┐   ┌────────────────┐
 │ 1 Load &      │──►│ 2 Weekly        │──►│ 3 Baselines         │──►│ 4 Flag rules   │
 │   validate    │   │   Σcost/Σtkm    │   │   own 8-wk (prior)  │   │   own>15% or   │
 │   quarantine  │   │   Mon–Sun weeks │   │   peers (same type, │   │   peer>20%&own>0│
 └───────────────┘   └─────────────────┘   │   self excluded)    │   └───────┬────────┘
                                           └─────────────────────┘           │ candidate?
                                                                    no ◄─────┤
                                                    "No" + template reason   │ yes
                                                                             ▼
 ┌───────────────┐   ┌─────────────────┐   ┌─────────────────────┐   ┌────────────────┐
 │ 8 Write       │◄──│ 7 Explain       │◄──│ 6 Verdict gate      │◄──│ 5 Retrieve top-4│
 │   results.csv │   │   template →    │   │   scope ✓ window ✓  │   │   notes: vector │
 │   run.json    │   │   (LLM rewrite  │   │   effect ✓ magn. ✓  │   │   sim + scope + │
 │   token_log   │   │   + validator)  │   │   pass → justified  │   │   time proximity│
 └───────────────┘   └─────────────────┘   │   none → "Yes"      │   └────────────────┘
                                           └─────────────────────┘
```

Notes are parsed once per run (step 0): `context_notes.csv` → `NoteFact[]` → vector index.

## 2. How a question is answered

```
"why did Chennai-Bangalore get pricier in March?"
   │ parse: route=Chennai-Bangalore, months=[3], intent=why
   ▼
select rows in run results (route ∧ period) → keep flagged / justified
   ▼
compose answer: counts + per-week line (cost, both deltas, verdict, reason with note id)
   ▼ (optional) LLM rephrase → grounding validator → else rule answer
answer + citations [route-week…] + note ids
```

## 3. Developer workflow

| Step | Command | Produces |
|---|---|---|
| Unit + e2e tests | `python -m pytest -q` | 21 tests: metric edge cases, quarantine, note parsing, gate, validator, LLM guardrail, Q&A |
| Full run | `python -m ferro run` | `output/results.csv`, `flagged_results.csv`, `run.json`, `token_log.json` |
| Evaluate | `python -m ferro eval` | `output/eval_report.md` (7 suites + threshold sensitivity) |
| Reproducibility | `python -m ferro repro` | `output/repro_report.md` (3 fresh-process runs, sha256 per file) |
| Ask | `python -m ferro ask "which routes are flagged?"` | answer in the terminal |
| Landing + dashboard | `python -m ferro serve` → http://127.0.0.1:8765 (landing) · /app (dashboard) | interactive UI |

Change a threshold → edit `ferro/config.py` → `eval` (accuracy + sensitivity) → `repro`.

## 4. Demo script (10-minute walkthrough)

1. **Problem and contract (1 min).** Show `sample_output_format_v2.csv`, then **Trust & eval**: the "Official sample rows" ring at 3/3. We reproduce the graders' own numbers.
2. **Overview (1.5 min).** Read the headline aloud. Route health cards show 3 routes needing review. Toggle the heatmap to *vs similar routes*: the Mumbai-Pune creep lights up. This is why there are two baselines.
3. **The trap (2 min).** Open `/app#/explorer/Chennai-Bangalore/2025-03-03`. The green N001 band means justified. Press **→**: Mar 10 turns red. In the story, the note check fails on *dates*, and the shipment drill-down says "route-wide, 5 of 5 shipments". Press **→** again: Mar 17, where N009 fails on *cost effect* ("returned to normal").
4. **Decoys (1 min).** Notes timeline, filtered to *Decoys*: six dashed bands, none of which can justify anything. On Delhi-Jaipur, the Nov 2024 red dots sit far from N007's May window.
5. **Act on it (1 min).** In the Review queue, expand an alert, mark it *Investigating*, add a note, and export the review log.
6. **What-if (1 min).** Click the *Strict* preset → 24 alerts and 8 changed weeks, hand labels 19/20. Back to *Balanced* → the same 16. The thresholds aren't knife-edge.
7. **Ask (0.5 min).** Press Ctrl+K, type "why did chennai-bangalore get pricier in march", press Enter → a cited answer.
8. **Trust (1.5 min).** Guardrail probe table, 0 fabricated justifications, identical sha256 across 3 runs, the cost log, and the LLM validator test.
9. **Trade-offs (0.5 min).** See `DECISIONS.md` D4, D10, D11.
