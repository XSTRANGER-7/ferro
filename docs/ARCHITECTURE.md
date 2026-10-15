# Architecture — Ferro

## 1. System overview

```
                       ┌──────────────────────────────────── ferro (Python package) ─────────────────────────────┐
 shipment_records.csv ─┤ data.py  ──►  metrics.py  ──►  flagging.py ──►  candidates (rose past a threshold)      │
                       │ validate      weekly Σcost/Σtkm    rules            │                                     │
                       │ quarantine    8-wk own baseline                     ▼                                     │
                       │               peer baseline           retrieval.py (RAG)                                 │
 context_notes.csv ────┤ notes.py  ──► NoteFact[] ──────────►  hybrid search: scope + time + TF-IDF vectors      │
                       │ scope/window/effect/magnitude                        │ top-k evidence                    │
                       │                                                      ▼                                    │
                       │                                        verdict.py  (deterministic gate)                  │
                       │                                        route ✓ window ✓ effect ✓ magnitude ✓             │
                       │                                                      │ verdict + cited note | none       │
                       │                                                      ▼                                    │
                       │                                        explain.py  template ─► (optional) llm.py rewrite  │
                       │                                                      │        validator + cache + ledger  │
                       │                                                      ▼                                    │
                       │                                        report.py → output/results.csv (contract)         │
                       │                                                    output/run.json (enriched)            │
                       │                                                    output/token_log.json                 │
                       └───────────────────────────────────────────────────────┬──────────────────────────────────┘
                                                                               │
                              server.py (stdlib HTTP, JSON API) ◄──────────────┘
                                   │            ▲
                                   ▼            │  qa.py (question → intent → rows + notes → grounded answer)
                              web/ dashboard (ES-module SPA + hand-rolled SVG charts, works offline)
```

## 2. Modules

| Module | Responsibility | Pure? |
|---|---|---|
| `config.py` | Thresholds, paths, LLM settings (env-overridable). One frozen dataclass. | yes |
| `data.py` | Load CSV, normalise names (trim, title-case), parse dates, **quarantine** invalid rows with a reason, resolve conflicting `route_type` per route. | yes |
| `metrics.py` | `monday_of`, weekly aggregation (Σcost / Σtkm), trailing-8-week own baseline (prior weeks only), peer baseline (same type, same week, self excluded), % deltas. | yes |
| `flagging.py` | Decide *candidate* (rose beyond a threshold) and the trigger (`own`, `peer`, `both`). | yes |
| `notes.py` | Turns free text into `NoteFact(scope, window_start, window_end, effect, magnitude, rationale)` with transparent rules. Each rule writes down why it fired. | yes |
| `retrieval.py` | `VectorIndex`: TF-IDF (sublinear tf, smoothed idf, L2 norm) in numpy with cosine search. `retrieve()` combines semantic score + scope match + time proximity. | yes |
| `verdict.py` | The trust gate. A note justifies a candidate only if **every** check passes. It returns the per-note check trace, which the UI shows. | yes |
| `explain.py` | Deterministic, grounded reason text. Optional LLM rewrite → `validate_explanation` → template fallback. | yes (LLM optional) |
| `llm.py` | OpenAI-compatible client (Groq / Ollama / OpenRouter / OpenAI) over `urllib`, temperature 0, seed, on-disk cache, token ledger with pricing. | I/O |
| `pipeline.py` | Orchestrates one run and returns a `RunResult`. | yes |
| `report.py` | Contract CSV (exact columns/order/format) + enriched JSON + candidate CSV. | I/O |
| `qa.py` | Q&A: extract route/month/date/intent → select result rows → compose an answer citing rows and note ids (optional LLM phrasing, validated). | yes |
| `insights.py` | Reviewer aids that never change a verdict: `week_drilldown` (shipments behind a route-week, classified as route-wide / single carrier / gradual drift / mixed) and `simulate` (re-run with other thresholds, diff vs current, hand-label accuracy). | yes |
| `server.py` | Stdlib `ThreadingHTTPServer`: `GET /api/bootstrap`, `/api/trust`, `/api/week`, `/api/simulate`, `/download/*`; `POST /api/ask`; static `web/` (`/` → landing, `/app` → dashboard, explicit JS MIME type for ES modules). | I/O |
| `cli.py` | `run`, `repro`, `eval`, `ask`, `serve`. | I/O |

## 3. Data contracts

**WeeklyRow** (one per route × week)
`route, route_type, week_of, shipments, total_cost, total_tkm, cost_per_tonne_km, own_baseline, own_weeks_used, own_pct, peer_baseline, peer_routes, peer_pct`

**Decision** (one per WeeklyRow)
`candidate: bool, trigger: own|peer|both|None, flagged: "Yes" | "No (justified)" | "No", matched_note_id, verdict_trace[], reason`

**Contract CSV** (`output/results.csv`), identical to `sample_output_format_v2.csv`:
`route, week_of, cost_per_tonne_km, vs_own_history, vs_similar_routes, flagged, matched_note_id, reason`

## 4. Why the verdict is deterministic but the system is still "AI"

| Layer | Technique | Role |
|---|---|---|
| Retrieval | Vector index (TF-IDF embeddings + cosine) with metadata re-ranking | finds candidate evidence for a route-week; scored by recall@k |
| Note understanding | Rule-based information extraction into typed facts | turns prose ("from Feb 24 to Mar 8", "costs were not significantly affected", "5-7%") into checkable constraints |
| Generation | LLM rewrite (optional), constrained + validated | readable explanations, Q&A phrasing |
| Q&A | Intent + entity extraction, retrieval over the agent's own results | stretch goal; answers only from computed rows |

The LLM sits at the **edges** (language in, language out). It never sits in the decision path. This one choice is what gives us both "no hallucinated justifications" and "identical across runs".

## 5. Determinism checklist

* All groupbys `sort=True`, outputs sorted by `(route, week_of)`.
* Floats are kept unrounded until formatting. Formatting uses fixed `"{:+.1f}%"` / `"{:.2f}"`.
* No set iteration without `sorted()`. No wall-clock time in graded files (the run timestamp only goes in `run.json` metadata, which is excluded from the diff).
* LLM: `temperature=0`, `seed=7`, cache keyed by `sha256(model + prompt)`. Even if the provider is nondeterministic, the verdict, note id and numbers come from code.

## 6. Failure modes handled

| Situation | Behaviour |
|---|---|
| Route's first week | `vs_own_history = "N/A (no prior weeks)"`, not flagged (a rise can't be established) |
| 1–7 prior weeks | uses all of them; `run.json` records `own_weeks_used`; README states it |
| Gap weeks (no shipments) | the baseline uses the 8 most recent *observed* prior weeks; a missing week is never filled in or interpolated |
| No peer that week | `vs_similar_routes = "N/A (no peer routes this week)"`, peer trigger disabled |
| Invalid rows | quarantined with a reason in `run.json → data_quality` |
| Conflicting `route_type` for a route | the majority type is used and a warning is logged |
| LLM down / no key / bad output | template explanation, logged in the ledger as `fallback` |
| Note applies to `All Routes` but says routes are outside the dataset | scope = ∅, never matches |

## 7. Front-end structure (`web/`)

| File | Role |
|---|---|
| `landing.html` + `css/landing.css` + `js/landing.js` | Landing page served at `/`. It explains the problem and the product, with animations driven by live `/api/bootstrap` and `/api/trust` data (and static fallbacks) |
| `index.html` | Dashboard app shell served at `/app`: sidebar, top bar, view outlet, drawer, command palette, toasts, tooltip |
| `css/app.css` | Design tokens (light/dark), components, animations, reduced-motion and print rules |
| `js/main.js` | Hash router with page lifecycle (`render` → `onResize` / `destroy`), nav counts, drawer, palette, shortcuts, theme |
| `js/store.js` | Run data loaded once from `/api/bootstrap`; review statuses (browser storage); plain-English guidance (`nextStep`, `whatHappened`) |
| `js/charts.js` | Sparkline, monthly bars, heatmap, line chart (crosshair, note bands, flag markers), timeline, score rings |
| `js/detail.js` | The week story (4 steps → verdict → shipments → evidence → review), shared by explorer, drawer and queue |
| `js/pages/*.js` | One module per page: overview, alerts, explorer, results, notes, whatif, ask, trust |

Data colours follow a validated categorical palette (cost = blue, own baseline = orange, peer average = aqua). Status colours (critical/good) always come with an icon or label, so meaning never relies on colour alone.
