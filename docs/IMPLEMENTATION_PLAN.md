# Implementation Plan — Ferro

> Smart assistant that watches shipping costs, flags unjustified rises, and explains them using only evidence it can cite.

This plan was written **before** the code, from a first pass over the brief and the data. Each phase lists its goal, deliverables and exit criteria. All phases are now complete. The "Status" column says where each phase was checked.

---

## 0. What the brief actually grades (requirements → design hooks)

| # | Requirement (from brief) | Where it lives | How we prove it |
|---|---|---|---|
| R1 | Group by route (origin→destination) **and** `route_type` | `metrics.py::weekly_costs` | unit test + sample-row match |
| R2 | Weekly cost / tonne-km = Σcost / Σ(tonnes × km) | `metrics.py` | reproduces the official sample numbers exactly (4.17, 3.29, 3.98) |
| R3 | Monday-start weeks, `week_of` = Monday | `metrics.py::monday_of` | unit test incl. Sunday edge |
| R4 | vs own history = mean of the **8 prior weekly values**, strictly before the week; fewer → use all available, say so | `metrics.py::add_baselines` | test with < 8 weeks; README §Edge cases |
| R5 | vs similar routes = mean of **other** same-type routes, same week, route excluded | `metrics.py::add_baselines` | unit test (self-exclusion) |
| R6 | Flag rising + out-of-ordinary vs history **or** peers | `flagging.py` | labeled eval set |
| R7 | Check notes before flagging (RAG) | `retrieval.py` + `notes.py` | retrieval recall@k in eval |
| R8 | Grounded plain-English reason | `explain.py` (+ optional `llm.py`) | output validator + spot-check audit |
| R9 | Stretch: Q&A over own findings | `qa.py`, web UI chat | scripted Q&A tests |
| G1 | Justified ⇒ exact note, right route, right window, note actually implies a cost rise | `verdict.py` gate | adversarial guardrail tests (10 decoys) |
| G2 | No note ⇒ unexplained, never guess | `verdict.py` default | eval |
| G3 | 3 untouched runs identical | `cli repro` | `output/repro_report.md` |
| G4 | Token / cost log for one full run | `llm.py` ledger | `output/token_log.json` |
| G5 | Output matches `sample_output_format_v2.csv` exactly | `report.py` | contract test (columns, order, types) |

---

## 1. Data findings that drove the design (week 0 exploration)

* 2,940 shipments, 7 routes, 104 Monday-weeks (2024-01-01 → 2025-12-22). Every route has a shipment every week, so there are no gap weeks in this file. The code still handles gaps.
* Route types: **Short** = Mumbai-Pune, Delhi-Jaipur (each route has only **one** peer). **Medium** = Ahmedabad-Mumbai, Chennai-Bangalore, Kolkata-Bhubaneswar. **Long** = Mumbai-Delhi, Delhi-Chennai.
* Routes in the same type do not cost the same: Mumbai-Pune normally sits about 10% above Delhi-Jaipur. So the peer threshold has to be wider than the history threshold.
* Planted signals spotted:
  1. Delhi-Jaipur spike, weeks 2024-11-11 & 11-18 — no note covers it. (N007 is the same route but May 2024 and says roads *improved*.)
  2. Ahmedabad-Mumbai spike, 2025-01-20 — N002 festival surcharge, same week.
  3. Chennai-Bangalore elevated for **four** weeks, 2025-02-24 → 03-17. N001 covers only **Feb 24 – Mar 8**. Mar 10 and Mar 17 are outside the window, and N009 says normal conditions were restored. Those two weeks must be **unexplained**.
  4. All routes step up roughly 5–8% from 2025-05-05 — N003 diesel. On its own this stays under the flag threshold.
  5. Mumbai-Pune drifts up through H2 2025 (3.5 → 4.5). The trailing 8-week baseline drifts with it, so own-history shows only +2–9%. The peer comparison catches it (+20–39%). This is the "quiet creep" from the brief.
* Six of the ten notes are **decoys**: they say costs were *not* affected (N005, N010), report no disruptions (N006, N008), describe improvements (N007, N009), or apply to routes outside the dataset (N004).

---

## 2. Phases

| Phase | Goal | Deliverables | Exit criteria | Status |
|---|---|---|---|---|
| P1 Docs & contract | Freeze definitions before coding | this plan, `ARCHITECTURE.md`, `DECISIONS.md` | every requirement row in §0 has an owner module | ✅ |
| P2 Core metrics | Load, validate, weekly aggregate, baselines | `data.py`, `metrics.py`, tests | official sample numbers reproduced to 0.1 pp | ✅ |
| P3 Flagging | Explainable threshold rules | `flagging.py`, `config.py` | eval: all labeled anomalies flagged, 0 false flags on negative controls | ✅ |
| P4 Note understanding | Notes → structured facts (scope, window, effect, magnitude) | `notes.py` | each of 10 notes parsed = hand-written ground truth | ✅ |
| P5 Retrieval (RAG) | Vector index over notes + metadata-aware hybrid search | `retrieval.py` | recall@4 = 100% for justifying notes | ✅ |
| P6 Verdict gate | Deterministic justification; cite or don't | `verdict.py` | 10/10 adversarial decoys rejected | ✅ |
| P7 Explanations | Grounded reason text; optional LLM rewrite with validator + cache | `explain.py`, `llm.py` | validator rejects any invented note id / flipped verdict | ✅ |
| P8 Output & repro | Contract CSV, enriched JSON, 3-run diff, token log | `report.py`, `cli.py` | 3 runs byte-identical on graded fields | ✅ |
| P9 Q&A | Ask questions about findings | `qa.py` | scripted questions answered with citations | ✅ |
| P10 UI | Dashboard + route explorer + assistant | `server.py`, `web/` | runs offline, no build step | ✅ |
| P11 Eval & docs | Labeled set, eval report, README | `eval/`, `README.md` | `python -m ferro eval` all green | ✅ |

---

## 3. Key decisions (summary — full reasoning in `DECISIONS.md`)

1. **The LLM never decides a verdict.** Flags and justifications are computed by deterministic code. The LLM (optional) only rewrites the wording, and a validator checks the rewrite. This is why the 3-run check passes even with an LLM in the loop.
2. **Notes are parsed into facts**: scope, effective window, effect direction, and magnitude. The gate reasons over these facts, not over similarity scores. Retrieval ranks the evidence; the gate decides whether it counts.
3. **Thresholds:** own-history > **+15%**, or peers > **+20%** while still above own history. Peers need a wider band because routes in the same type have different normal levels. The official sample confirms this choice: Mumbai-Pune is flagged at +9.2% own / +23.6% peer.
4. **Market-wide notes (All Routes)** can only justify an own-history rise within their stated size (5–7% + 3 pp tolerance). They can never justify a peer-driven flag, because the peers had the same shock.
5. **Zero heavy dependencies**: pandas + numpy, a numpy TF-IDF vector index, and a stdlib HTTP server with a hand-rolled SVG UI. It runs offline in a clean venv in seconds.

---

## 4. Risks & mitigations

| Risk | Mitigation |
|---|---|
| LLM invents a note or flips a verdict | LLM gets only the verdict + cited note text; output is validated (note ids ⊆ allowed, verdict keyword present); on failure we fall back to the template |
| Non-determinism | temperature 0, fixed seed, response cache keyed on prompt hash, sorted iteration, fixed float formatting |
| Thresholds over-fit to this file | thresholds live in `config.py`; README shows how many flags each threshold produces |
| Retrieval misses the right note | hybrid score (metadata scope + time proximity + TF-IDF); recall@k measured in eval; the gate also gets every in-scope note, so a missed retrieval cannot produce a false "justified" |
| Bad input rows | `data.py` quarantines rows (non-positive qty/km/cost, bad dates, duplicates) and reports them; it never crashes or silently drops them |
