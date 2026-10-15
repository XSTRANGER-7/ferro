# Ferro — a smart assistant that watches shipping costs

![Ferro landing page](docs/screenshots/01-landing-hero.png)

Ferro tracks every route's **cost per tonne-km week by week** and compares it with the route's own recent past and with similar routes. It **flags rises that look out of the ordinary**, then checks a set of context notes for a genuine reason. A rise is marked *justified* only when a note covers that **route**, that **week**, actually describes a **cost increase**, and (for market-wide notes) is **big enough**. Everything else stays flagged with a plain-English reason. Nothing is guessed.

```
python -m ferro run      # → output/results.csv  (contract format, every route-week)
python -m ferro serve    # → http://127.0.0.1:8765 landing page, /app dashboard + assistant
```

| | |
|---|---|
| **Result** | 728 route-weeks · **16 unexplained rises** · **3 justified** (N002, N001 ×2) · 709 normal |
| **Official sample** | all 3 rows of `sample_output_format_v2.csv` reproduced field-for-field |
| **Eval** | 7/7 suites green: 20/20 labeled cases, 18/18 adversarial guardrails, recall@4 = 1.0, **0 fabricated** justifications |
| **Repro** | 3 fresh-process runs → byte-identical files (same sha256) |
| **Cost** | default run: 0 LLM calls, $0. LLM mode: 19 calls, ≈ 4.7K in / 1.5K out tokens, ≈ **$0.0004** |
| **Deps** | Python 3.10+, pandas, numpy. Nothing else: the UI and server use the standard library and work offline |

## Screenshots

> All screenshots are of the real app running on the supplied data (`python -m ferro serve`). Nothing is mocked. They are stored in [`docs/screenshots/`](docs/screenshots/).

### Landing page (`/`)

| | |
|---|---|
| ![Hero](docs/screenshots/01-landing-hero.png) | ![The creep problem](docs/screenshots/02-landing-creep.png) |
| **Hero:** a live product mock built from the run's data, with animated flags and the note-check card | **The problem:** Mumbai-Pune crept ~30% while its own 8-week average hid it; similar routes expose it |
| ![Why trust it](docs/screenshots/03-landing-trust-story.png) | ![Mobile landing](docs/screenshots/15-mobile-landing.png) |
| **Why trust it:** the Chennai-Bangalore flood replayed week by week. Two weeks are justified by N001; two stay unexplained | **Mobile:** the same page at 390 px |

### Dashboard (`/app`)

**Overview:** a plain-English headline, KPI tiles, the four decision steps, and route health cards.

![Overview](docs/screenshots/04-dashboard-overview.png)

**Heatmap, "vs similar routes" view:** the slow Mumbai-Pune creep becomes visible.

![Heatmap vs similar routes](docs/screenshots/05-heatmap-vs-similar-routes.png)

| | |
|---|---|
| ![Review queue](docs/screenshots/06-review-queue.png) | ![Route explorer](docs/screenshots/07-route-explorer.png) |
| **Review queue:** triage statuses, notes, what happened / what we checked / next step, export | **Route explorer:** cost vs own 8-week average vs similar routes; note windows shaded; flags marked |
| ![Week story](docs/screenshots/08-week-story-shipments.png) | ![Evidence drawer](docs/screenshots/09-evidence-drawer.png) |
| **Week story:** the 4 steps, the verdict, the shipment drill-down ("route-wide: 5 of 5 shipments"), and the evidence trail | **Evidence drawer:** Delhi-Jaipur 11 Nov 2024. N007 is rejected on dates and on cost effect |
| ![Notes timeline](docs/screenshots/10-notes-timeline.png) | ![What-if lab](docs/screenshots/11-whatif-lab.png) |
| **Notes & evidence:** note windows vs flagged weeks for every route, and how each note was read | **What-if lab:** the *Strict* preset re-runs the real pipeline: 24 alerts, 8 changed weeks |
| ![Ask the assistant](docs/screenshots/12-ask-assistant.png) | ![Trust and eval](docs/screenshots/13-trust-eval.png) |
| **Ask the assistant:** a grounded answer with clickable route-week citations | **Trust & eval:** suite scores, the 3-run proof, the cost log, the guardrail probes |
| ![Dark mode](docs/screenshots/14-dark-mode-explorer.png) | ![Mobile dashboard](docs/screenshots/16-mobile-dashboard.png) |
| **Dark mode:** Mumbai-Pune's 2025 creep against Delhi-Jaipur | **Mobile:** the dashboard at 390 px |

---

## 1. Quick start

```bash
pip install -r requirements.txt   # pandas, numpy (+ pytest for tests)

python -m ferro run         # full run → output/
python -m ferro eval        # evaluation harness → output/eval_report.md
python -m ferro repro       # 3 untouched runs + diff → output/repro_report.md
python -m ferro ask "why did Chennai-Bangalore get pricier in March 2025?"
python -m ferro serve       # landing page http://127.0.0.1:8765 · dashboard /app
python -m pytest -q         # 25 unit / end-to-end tests
```

**Optional LLM** (only rephrases explanations and answers; never decides anything):

```bash
# Groq free tier, open-source Llama-3.1-8B (default provider)
export GROQ_API_KEY=...                  # Windows PowerShell: $env:GROQ_API_KEY="..."
# or a local model via Ollama
export FERRO_LLM_BASE_URL=http://localhost:11434/v1 FERRO_LLM_MODEL=llama3.1:8b
python -m ferro run               # LLM mode turns on automatically; --no-llm forces templates
```

## 2. Deliverables map

| Brief asks for | Where |
|---|---|
| Working code | `ferro/` (package), `web/` (dashboard) |
| Output CSV matching `sample_output_format.csv` | **`output/results.csv`** (every route-week). Also `output/flagged_results.csv` (only Yes / No (justified)) |
| README: how it works, how built, how checked | this file + `docs/ARCHITECTURE.md`, `docs/DATA_PIPELINE.md` (data loading, cleaning, transformation, lineage), `docs/DECISIONS.md`, `docs/WORKFLOW.md`, `docs/IMPLEMENTATION_PLAN.md` |
| Reproducibility check across 3 runs | **`output/repro_report.md`** |
| Token / cost log for one full run | **`output/token_log.json`** (+ §7 below) |
| Eval harness / labeled set | `eval/` + **`output/eval_report.md`** |
| 10-min walkthrough | script in `docs/WORKFLOW.md §4` |

## 3. How it works

```
shipments ─► validate ─► weekly Σcost/Σtkm ─► own 8-wk & peer baselines ─► flag rules ─┐
notes ─► typed facts (scope/window/effect/magnitude) ─► vector index ─► retrieve top-4 ◄─┘
                                                       ─► 4-check verdict gate ─► grounded reason ─► results.csv
```

1. **Load and validate.** Names are trimmed and title-cased. Bad rows (non-positive qty/km/cost, bad dates, duplicate ids) are **quarantined with a reason**. A route with conflicting `route_type` uses the majority type, with a warning. (This file is clean: 2,940/2,940 rows used.)
2. **Weekly cost.** `week_of` = the Monday of each shipment's Monday–Sunday week. `cost_per_tonne_km = Σ freight_cost / Σ (tonnes × km)` per route × route_type × week.
3. **Baselines, exactly as specified.**
   * *vs own history:* mean of the route's previous **8** weekly values, strictly before the week.
   * *vs similar routes:* mean of the **other** routes with the same `route_type`, same week.
4. **Flag rule.** The week is a candidate when it is **> +15% vs own history**, or **> +20% vs similar routes while still above its own history** ("rising").
   * Own history catches spikes. Peers catch slow creep, which the trailing average hides.
5. **RAG.** Each note is parsed into a `NoteFact`, and a TF-IDF vector index (numpy, cosine) is built over the notes. For each candidate, a hybrid ranker (semantic similarity + route scope + time proximity) returns the top 4 notes.
6. **Verdict gate.** A note justifies the rise only if **all four checks pass**:

   | Check | Rejects |
   |---|---|
   | scope | a note about another route (even one sharing a city), or an All-Routes note whose routes are "not part of this dataset" |
   | window | a note whose dates don't overlap this Monday–Sunday week |
   | effect | "costs were not affected", "absorbed without a rate change", "no disruptions", "roads improved", "returned to normal" |
   | magnitude | market-wide notes vs a peer gap (peers had the same shock); a rise larger than the stated "5–7%" |

   Pass → `No (justified)` + `matched_note_id`. No pass → `Yes`, blank note id, and a reason that names the closest note and **why it failed**.
7. **Explain.** A deterministic template builds the reason from the computed numbers and the cited note's own words. If an LLM is configured, it may rephrase that reason. The rewrite is **validated**: no new note ids, no new numbers, the verdict kept, the cited note named. Otherwise the template stays.
8. **Ask.** `qa.py` extracts route, period, note id and intent from a question, selects rows from *this run's results*, and answers with citations.

## 4. What it found

| Route | Weeks | Verdict | Why |
|---|---|---|---|
| Delhi-Jaipur | 2024-11-11, 11-18 | **Yes** | +35.5% / +27.6% vs own history. The only Delhi-Jaipur note (N007) is from May 2024 and says roads *improved* |
| Ahmedabad-Mumbai | 2025-01-20 | No (justified) · **N002** | festival-week surcharge, same corridor, same week |
| Chennai-Bangalore | 2025-02-24, 03-03 | No (justified) · **N001** | flooding Feb 24 – Mar 8 (the week of Mar 3–9 overlaps Mar 8) |
| Chennai-Bangalore | 2025-03-10, 03-17 | **Yes** | still elevated after the flood window closed. N009 says conditions "returned to normal", which is not a cost reason |
| Mumbai-Pune | 2025-06-23 and 11 weeks Sep–Dec 2025 | **Yes** | slow creep from ~3.4 to 4.5 ₹/t-km: only +3–9% vs its own (rising) average, but +20–39% vs Delhi-Jaipur. Diesel (N003) can't explain it, because Delhi-Jaipur had the same diesel rise |

Not flagged, on purpose:
* the **diesel step from 2025-05-05**: every route rises ~5–8%, inside normal range
* Mumbai-Delhi maintenance week (N005, "costs not significantly affected")
* Delhi-Chennai, which never moves

### Edge cases & how they're handled

| Case | Handling |
|---|---|
| **Fewer than 8 prior weeks** (first 8 weeks of each route) | Uses all available prior weeks, never padded. `run.json → own_weeks_used` records the count, and the reason text says so for any flagged row. The **first week** has no history: `vs_own_history = "N/A (no prior weeks)"`, and it is never flagged, because a rise can't be shown. |
| Week with no peers | `vs_similar_routes = "N/A (no peer routes this week)"`; the peer trigger is disabled |
| Short routes | only one peer each (Mumbai-Pune ↔ Delhi-Jaipur), so the "peer average" is that one route |
| Gap weeks | the baseline uses the 8 most recent observed weeks; nothing is interpolated |
| Sunday shipments | belong to the week that started the previous Monday |
| Percent rounding | values stay unrounded until formatting, so a value can never print as "-0.0%" |
| Note that is "All Routes" but out of dataset (N004) | scope = none → never matches |
| Reverse direction of a corridor note | matches (same highway); a route sharing only one city does not |

## 5. How I convinced myself it is right

`python -m ferro eval` → `output/eval_report.md`:

| Suite | Result | What it proves |
|---|---|---|
| Official sample | 3/3 | our cost, both comparisons, flag and note id equal the graders' own rows |
| Labeled cases | 20/20 | hand labels: every planted anomaly, both flood-window edges, decoy weeks, the first week |
| Note parsing | 10/10 | parser output = an independently hand-written reading of every note (`eval/note_ground_truth.json`) |
| Guardrails | 18/18 | adversarial probes: right route + wrong window, right week + wrong route, "not affected" notes, shared-city routes, diesel vs peers, diesel too small, expired level shift, plus 4 positive controls |
| Retrieval | recall@4 = 1.0, MRR = 1.0 | the RAG step surfaces the right note first whenever one should match |
| Hallucination audit | 3/3, **0 fabricated** | every justified row re-checked against the ground-truth note reading: route, window, effect, and the id appears in the reason |
| Contract | 4/4 | header identical to the sample, every value well-formed, one row per route-week, every week_of a Monday |

**Threshold sensitivity** (in the same report): any own-history threshold from 12.5% to 20% with peer at 20% gives the same 16 flags and 20/20 accuracy. The result is not knife-edge.

**Unit tests** (`pytest`, 25): Monday bucketing, the weighted ratio, the no-look-ahead baseline, the fewer-than-8 rule, gap weeks, peer self-exclusion, quarantine, note windows and negation, market-wide limits, the explanation validator, a fake LLM that hallucinates every second reply (graded fields unchanged), plus the shipment drill-down patterns and the what-if simulator.

## 6. Reproducibility

`python -m ferro repro` runs the full pipeline **three times in fresh Python processes** and diffs the outputs (`output/repro_report.md`):

* graded-field differences: **0** · reason-text differences: **0**
* `results.csv`, `flagged_results.csv` and `run.json` have **identical sha256** across all runs

Why it's deterministic:
* The decision path has no randomness: no sampling, sorted iteration, fixed formatting, no timestamps in outputs.
* The optional LLM runs at **temperature 0, seed 7**. Responses are **cached by prompt hash**, so run 2 onward makes zero API calls. The LLM only rephrases text, and the validator rejects any rewrite that changes a note id, a number or the verdict.

**Shown, not just claimed:** with a mock OpenAI-compatible server that hallucinates every 4th reply:
* 19 calls on run 1, then 19 cache hits on run 2 (byte-identical files)
* 4 rewrites rejected by the validator
* **0** graded-field differences vs template mode

## 7. Token / cost log (one full run over all 2,940 shipments)

The LLM is called **once per candidate row** (19). It is never called for the 709 normal weeks, and never for the verdict.

| Mode | LLM calls | Input tokens | Output tokens | Cost |
|---|---|---|---|---|
| Default (no key: grounded templates) | **0** | 0 | 0 | **$0** |
| LLM mode, projected from the exact prompts (`token_log.json → projected_if_llm_enabled`) | 19 | ~4,744 | ~1,520 (est. 80/call, capped at 160) | **≈ $0.00036** |
| LLM mode via mock server (measured usage field) | 19 | 4,112 | 1,577 | ≈ $0.00033 |
| Any re-run (cache) | 0 | 0 | 0 | $0 |

Pricing is Groq's published on-demand rate for `llama-3.1-8b-instant` (**$0.05 / 1M input, $0.08 / 1M output**). Override it with `FERRO_LLM_PRICE_IN` / `FERRO_LLM_PRICE_OUT`. Ollama locally costs $0. Projected tokens use a ~4 chars/token estimate; with a real key, `token_log.json` records the provider's own `usage` numbers per call (`entries[]`).

> Honesty note: no real provider key was available while building this, so the submitted `output/token_log.json` is from the default template run, and LLM-mode figures are projected (or measured against the mock). Setting `GROQ_API_KEY` and running `python -m ferro run` regenerates the log with real usage.

## 8. Dashboard

`python -m ferro serve` starts two pages:
* **http://127.0.0.1:8765**: an animated **landing page** that explains the problem and the product. Its charts are drawn from the live run: a product mock, the Mumbai-Pune creep, a step-by-step replay of the Chennai-Bangalore flood trap, and trust numbers loaded from the eval.
* **http://127.0.0.1:8765/app**: the dashboard. It's a single-page app with a sidebar, three sections and eight pages. It works offline, needs no build step, supports light/dark/system themes, and fits mobile screens. Animations respect `prefers-reduced-motion`.

| Page | What you get |
|---|---|
| **Overview** | Plain-English headline ("16 cost rises need your review on 3 routes"), an animated trace of the worst route, KPI tiles with monthly flag bars and animated counters, a 4-step "how it decides" explainer, **route health cards** (26-week sparkline + status per route), and a route × week heatmap you can switch between *vs own history* and *vs similar routes* (the second view reveals the Mumbai-Pune creep) |
| **Review queue** | Triage every alert: Open / Investigating / Resolved / False alarm, plus free-text notes (saved in your browser). A progress bar, filters, sorting, and expandable cards answer *what happened · what we checked · suggested next step*. **Export review log** (CSV) and print |
| **Route explorer** | Route pills, an animated line chart (cost · 8-week average · similar-route average), note windows shaded with ⊘ marking decoys, a hover crosshair, ranges (All / year / last 26 weeks). Step through weeks with **← →**, or jump between flags with **Shift + ← →** |
| **Week story** (explorer, drawer, queue) | 4 steps: *Measure → Own history → Similar routes → Note check*, each turning red or green; the verdict with a **suggested next step**; a **shipment drill-down** that shows whether the rise is route-wide, one carrier, or a gradual drift vs peers; and the **evidence trail** (retrieval relevance + the four checks for each note) |
| **All results** | The contract table with search, filters, sortable columns, inline deviation bars, pagination, and download (full / flagged / current view). Click a row to open its story in a side drawer |
| **Notes & evidence** | A **timeline** of note windows vs flagged weeks for every route (green = can justify, dashed grey = decoy), plus a card for each note with its four extracted facts and the rationale |
| **What-if lab** | Threshold sliders and presets that **re-run the real pipeline** on the server. Shows the new counts, the hand-label accuracy, and exactly which route-weeks change verdict |
| **Ask the assistant** | Chat with a typing indicator, grouped suggestions, citation chips that open the evidence, copy and new-conversation buttons |
| **Trust & eval** | Score rings per eval suite, the case-by-case tables, the 3-run sha256 proof, the cost log, data quality, and the rules in force |

Global features:
* **Ctrl + K** (or `/`) opens a command palette that searches pages, routes, flagged weeks, notes and actions, or sends your text to the assistant
* **`?`** opens help, and **`g` then a letter** jumps between pages
* Glossary tooltips appear on every dashed-underlined term, and toasts confirm actions
* Every view has a deep link, e.g. `/app#/explorer/Chennai-Bangalore/2025-03-10`

New API endpoints behind it:
* `/api/week?route=&week=`: shipment drill-down (`ferro/insights.py`)
* `/api/simulate?own=&peer=`: what-if re-run, cached per threshold pair

None of these change a verdict; they help a human act on one.

## 9. Project layout

```
ferro/   config · data · metrics · flagging · notes · retrieval · verdict · explain · llm
                pipeline · report · qa · insights · evaluation · repro · server · cli
web/            index.html · css/app.css · js/{main,store,util,charts,detail}.js · js/pages/*.js   (ES modules, no build, no CDN)
eval/           labeled_cases.csv · guardrail_cases.csv · note_ground_truth.json
tests/          test_core.py · test_end_to_end.py · test_llm_guardrail.py · test_insights.py
docs/           IMPLEMENTATION_PLAN · ARCHITECTURE · DATA_PIPELINE · DECISIONS · WORKFLOW · screenshots/
output/         results.csv · flagged_results.csv · run.json · token_log.json · eval_report.md · repro_report.md
```

## 10. Limitations & next steps

* Thresholds are fixed percentages. With a longer history, a per-route volatility band could replace them, and the eval harness would show whether it helps.
* Note parsing is rule-based and tuned to the language of operations notes. A larger, messier corpus would justify an LLM extractor whose output is cached, reviewed, and frozen as data. That would keep the decision path deterministic.
* Peer comparison for Short routes rests on a single peer. A larger network would give a sturdier peer average.
* Q&A understands routes, months, quarters, dates, note ids and common intents. Anything else falls back to a summary and suggestions rather than guessing.
