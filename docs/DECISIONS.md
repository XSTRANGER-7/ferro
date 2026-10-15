# Design decisions & trade-offs

Each entry gives: the decision, the alternatives considered, and why. These are the talking points for the Round 2 walkthrough.

---

### D1 — Weekly cost = Σcost / Σ(tonnes × km), not the mean of per-shipment ratios
* **Why:** the brief says "total freight cost / (quantity × distance)". The weighted form follows that wording, and it **reproduces the official sample exactly**: Delhi-Jaipur 2024-11-11 = 4.17. The mean of per-shipment ratios gives 4.16.
* **Effect:** a big shipment counts proportionally more. That is the right behaviour for spend monitoring.

### D2 — Own-history baseline = simple mean of the previous 8 *weekly values*
* Strictly prior weeks, no look-ahead. Fewer than 8 available → use all of them (`own_weeks_used` records how many). Zero → `N/A (no prior weeks)` and the week can't be flagged.
* It reproduces the sample's +35.5% / +29.5% / +9.2%.
* Gap weeks (none in this file) use the 8 most recent *observed* weeks. We never interpolate.

### D3 — Peer baseline = simple mean of the *other* same-type routes' weekly values
* Self-excluded, per the brief. Short routes have exactly one peer, so for them the "peer average" is just the other route. This is documented in the UI subtitle.
* It reproduces the sample's +21.0% / +22.5% / +23.6%.

### D4 — Flag thresholds: own > +15%, or peer > +20% while own > 0
* **Two baselines catch two failure modes.** A *spike* shows up against own history. A *slow creep* does not: the trailing average climbs with it (Mumbai-Pune H2-2025 shows only +3–9% vs own history). Only the peer comparison exposes it (+20–39%).
* **Why the peer threshold is wider:** routes in the same type have different normal levels (Mumbai-Pune ≈ +10% over Delhi-Jaipur in quiet weeks).
* **Why `own > 0` for a peer flag:** "rising" is part of the brief's definition. A route that is structurally pricier than its peers but falling is not a rise.
* **Evidence it's not over-fit:** the sensitivity grid in `output/eval_report.md` shows identical flags for any own threshold from 12.5% to 20% (with peer at 20%), and 20/20 label accuracy across that band. The official sample's Mumbai-Pune row (flagged at +9.2% own / +23.6% peer) pins the peer side.
* **Rejected:** z-scores or a per-route standard-deviation band. They are more "statistical", but they are harder to explain to an ops manager, they need more history than 8 weeks, and they put noisy routes on a different footing from calm ones.

### D5 — Every route-week is in `results.csv`; candidates also go in `flagged_results.csv`
* The graders check "weekly cost tracking and comparisons", so every row carries its numbers. Normal weeks get `flagged = No` with a short reason. The sample's 3 rows are a subset of our output and match field-for-field.

### D6 — Notes become typed facts before they are used
* Similarity alone can't tell "costs rose because of flooding" from "costs were **not** affected by maintenance". Both mention the route and costs. So `notes.py` extracts **scope / window / effect / magnitude** with transparent rules. Each fact carries the text span that produced it.
* **No-impact language wins.** "costs were not significantly affected" overrides any cost word elsewhere in the note.
* **Unknown ⇒ cannot justify.** If we can't read a note's effect, it is never used as a reason.
* **Rejected:** having an LLM extract the facts at run time. That adds nondeterminism to the decision path for a corpus of 10 notes, and a rules extractor is unit-testable against hand-written ground truth (`eval/note_ground_truth.json`, 10/10).

### D7 — Window semantics
| Note language | Window |
|---|---|
| "from Feb 24 to Mar 8" | exactly that range (year from the note date) |
| "starting this week" (level shift) | week of note + 8 weeks, i.e. until the trailing baseline has absorbed the new level |
| "this quarter" | the calendar quarter of the note date |
| anything else | the Monday–Sunday week of the note date |

A week matches if its Monday–Sunday span **overlaps** the window. So the week of Mar 3–9 is covered by "until Mar 8", and the week of Mar 10 is not. That boundary is the Chennai-Bangalore trap.

### D8 — Market-wide notes (All Routes) have limits
* They **cannot explain a gap vs peers**, because every peer had the same diesel increase. So they never justify a peer-triggered flag.
* If the note states a size ("5–7%"), the rise vs own history must fit within it (+3 pp tolerance). A +16% jump is not explained by a 5–7% fuel rise.
* In this dataset N003 never ends up justifying a row: the diesel step stays under +15% everywhere. The gate is still tested both ways by guardrail probes G12–G15.

### D9 — Corridor notes cover both directions
* "Chennai-Bangalore highway flooding" affects Bangalore→Chennai trucks too. A note **never** matches a route that merely shares one city (G11: Delhi-Chennai vs the Chennai-Bangalore flood note).

### D10 — Retrieval: own TF-IDF vector index + hybrid re-rank instead of a hosted vector DB
* 10 notes. A numpy TF-IDF index is exact, deterministic, offline and instant. The same `add/search` interface could be backed by Chroma/FAISS + sentence-transformers if the corpus grows to thousands of notes.
* Hybrid score = 0.4·semantic + 0.3·scope + 0.3·time proximity. Retrieval measured recall@4 = 1.0 and MRR = 1.0 on every case where a note should match.
* **Retrieval does not decide anything.** Missing a note can only produce a false "unexplained" (the safe direction). It can never produce a fabricated justification.

### D11 — The LLM is optional and sits at the edges only
* Without a key the system produces fully grounded template reasons (0 calls, $0). With `GROQ_API_KEY` (free tier, open-source Llama-3.1-8B) or a local Ollama, the LLM **rephrases** reasons and Q&A answers.
* Every rewrite must pass `validate_explanation`:
  * note ids ⊆ evidence
  * the justified verdict names its note
  * a flagged verdict says unexplained/review
  * every number appears in the facts it was given

  Otherwise we keep the template. Verified with a mock server that injects hallucinations, and with a permanent test (`tests/test_llm_guardrail.py`).
* Temperature 0, seed 7, and a sha256-keyed response cache. A second run costs $0 and is byte-identical.
* **Call volume:** one call per candidate row (19). Normal weeks (709) never touch the LLM.

### D12 — Zero heavy dependencies; stdlib web server; hand-rolled SVG charts
* pandas + numpy only. The dashboard works **offline** (no CDN), which matters for a live demo. There's no build step.
* **Trade-off:** more JS by hand than with a charting library, but full control over the evidence-trail views that matter here.

### D13 — No timestamps in outputs
* `results.csv`, `flagged_results.csv` and `run.json` contain no wall-clock data, so three runs are **byte-identical** (sha256 shown in `output/repro_report.md`). The input fingerprint (sha256 of both CSVs) is recorded instead.
