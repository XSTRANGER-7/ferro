# Data Pipeline: how Ferro loads, cleans, transforms and uses the data

This document follows the data from the two input CSVs to every value in `output/results.csv`. It covers:
* what each stage does
* why it does it that way
* what it does with bad data
* how to check it yourself

Every number below was measured on the supplied files. Every "what happens if…" example was produced by running the real code.

Code references: `ferro/data.py` (load + clean + validate), `metrics.py` (weeks + baselines), `notes.py` (note facts), `flagging.py`, `pipeline.py`, `report.py`.

---

## 1. The pipeline at a glance

```
shipment_records.csv ──► ① LOAD as text ──► ② NORMALISE ──► ③ VALIDATE ──┬──► quarantine list (row, id, reason)
                                                                          │
                                                                          ▼
                                                   ④ DERIVE  route · tonne_km · week_of
                                                                          │
                                                                          ▼
                                                   ⑤ AGGREGATE  one row per route × week
                                                      cost_per_tonne_km = Σ cost ÷ Σ tonne-km
                                                                          │
                                                                          ▼
                                                   ⑥ BASELINES  own 8-week average · same-type peer average
                                                                          │
context_notes.csv ──► ⑦ LOAD + PARSE into facts ──► (verdict gate) ◄──────┘
                                                                          │
                                                                          ▼
                                                   ⑧ FORMAT  results.csv (contract) · run.json (full detail)
```

| Stage | Module | In | Out |
|---|---|---|---|
| ① Load | `data.load_shipments` | CSV file | raw table, every cell as text |
| ② Normalise | `data.validate_shipments` | raw table | trimmed, typed columns |
| ③ Validate | `data.validate_shipments` | typed table | clean rows + `DataQuality` report |
| ④ Derive | `data._resolve_route_types`, `metrics.monday_of` | clean rows | `route`, `tonne_km`, `week_of` |
| ⑤ Aggregate | `metrics.weekly_costs` | shipments | 728 route-week rows |
| ⑥ Baselines | `metrics.add_baselines` | route-weeks | own / peer averages and % changes |
| ⑦ Notes | `data.load_notes`, `notes.parse_notes` | notes CSV | 10 `NoteFact` records |
| ⑧ Format | `pipeline`, `report` | rows + verdicts | `results.csv`, `flagged_results.csv`, `run.json` |

---

## 2. Inputs

### 2.1 `shipment_records.csv`: one row per shipment

| Column | Type after cleaning | Used for | Cleaning applied |
|---|---|---|---|
| `shipment_id` | text | duplicate detection, shipment drill-down | duplicates quarantined (first kept) |
| `origin` | text | route key | trim, collapse spaces, Title Case |
| `destination` | text | route key | trim, collapse spaces, Title Case |
| `route_type` | `Short` / `Medium` / `Long` | peer grouping | trim, Title Case, must be one of the three |
| `material` | text | drill-down display only | none (not used in any calculation) |
| `quantity_tonnes` | float > 0 | tonne-km | numeric parse, must be > 0 |
| `distance_km` | float > 0 | tonne-km | numeric parse, must be > 0 |
| `freight_cost_inr` | float > 0 | cost | numeric parse, must be > 0 |
| `shipment_date` | date | week assignment | strict `YYYY-MM-DD` parse |
| `transporter` | text | drill-down only (which carriers drove a rise) | none (not used in verdicts) |

`material` and `transporter` deliberately take **no part in the verdict**. The brief defines cost per tonne-km at the route level. They are shown in the shipment drill-down to help a reviewer decide what to do (e.g. "one carrier" vs "the whole lane").

### 2.2 `context_notes.csv`: free-text evidence

| Column | Cleaning | Used for |
|---|---|---|
| `note_id` | trim | citation in `matched_note_id` |
| `date` | trim, strict `YYYY-MM-DD` | anchor for the note's window |
| `applies_to` | trim | route scope (`All Routes` or `CityA-CityB`) |
| `note` | trim | parsed into facts; quoted in reasons |

Notes are sorted by `note_id`, so file order can never change results.

### 2.3 `sample_output_format_v2.csv`: the output contract

It is not used as data. It is read by the eval harness to check that our header, column order and value formats match, and that our numbers for its three rows match exactly.

---

## 3. What the data looks like (measured profile)

| Property | Value |
|---|---|
| Rows | 2,940 |
| Empty cells | 0 |
| Duplicate `shipment_id` / duplicate rows | 0 / 0 |
| Cells with stray whitespace | 0 |
| Rows quarantined | **0**: the supplied file is clean, and the cleaning rules are proven on synthetic dirty data in §6 |
| Date range | 2024-01-01 (Mon) → 2025-12-28 (Sun): exactly **104 complete Monday–Sunday weeks** |
| Routes | 7 (one direction each) |
| Shipments per route-week | min 3 · mean 4.04 · max 5. No route has a missing week |
| `quantity_tonnes` | 9.0 – 22.0 (mean 15.5) |
| `distance_km` | 147 – 2,220 (mean 763) |
| `freight_cost_inr` | 4,710 – 105,839 (mean 27,585) |
| Materials | 6 (Auto Parts, Cement, FMCG Cartons, Packaged Foods, Steel Coils, Textiles) |
| Transporters | 6. *Coromandel Carriers* appears only on Delhi-Chennai (89 shipments) |
| Shipments by weekday | spread evenly, including **428 on Sundays** (so Sunday week-assignment matters) |

Per route:

| Route | Type | Shipments | Distance range (km) | Median ₹ / t-km | Transporters |
|---|---|---|---|---|---|
| Mumbai-Pune | Short | 418 | 147.0 – 153.0 | 3.48 | 5 |
| Delhi-Jaipur | Short | 416 | 274.4 – 285.6 | 3.14 | 5 |
| Ahmedabad-Mumbai | Medium | 421 | 519.6 – 540.6 | 2.59 | 5 |
| Chennai-Bangalore | Medium | 410 | 343.1 – 357.0 | 2.76 | 5 |
| Kolkata-Bhubaneswar | Medium | 433 | 431.2 – 448.8 | 2.65 | 5 |
| Mumbai-Delhi | Long | 423 | 1,372.2 – 1,427.9 | 2.06 | 5 |
| Delhi-Chennai | Long | 419 | 2,150.2 – 2,220.0 | 2.09 | 6 |

Observations that shaped the design:
* **Distances vary within a route** (e.g. Mumbai-Delhi ± 2%). That's why cost is normalised by the actual km of each shipment, not by a nominal route distance.
* **The file is not in date order.** Shipment ids are not chronological within a week, and the whole Delhi-Chennai block (SHP02522 – SHP02940) was appended at the end. Every step groups and sorts explicitly, so input row order cannot affect the output.
* **Longer routes are cheaper per tonne-km** (≈ ₹2.1 Long vs ≈ ₹3.1–3.5 Short). That's why peers are compared only within the same `route_type`.
* **Routes of the same type are not priced the same.** Mumbai-Pune normally sits ≈ 10% above Delhi-Jaipur. That's why the peer threshold (+20%) is wider than the own-history threshold (+15%).

---

## 4. Stage ① Load

```python
raw = pd.read_csv(path, dtype=str, keep_default_na=False)
```

* **Every cell is read as text.** That way *we* decide how to interpret `"0"`, `" 12 "`, `"6,000"` or `"NA"`, instead of pandas guessing. A city literally called "NA" or "None" would otherwise silently become a missing value.
* **Required columns are checked up front.** If any of the 8 required columns is missing, the run stops immediately with a clear error rather than producing partial output:
  `shipment_id, origin, destination, route_type, quantity_tonnes, distance_km, freight_cost_inr, shipment_date`.
* Extra, unknown columns are ignored.

---

## 5. Stage ② Normalise

| Field | Rule | Example |
|---|---|---|
| `origin`, `destination` | strip ends · collapse internal whitespace · Title Case | `"  mumbai "` → `Mumbai`, `"PUNE"` → `Pune` |
| `route_type` | strip · Title Case | `"short"` → `Short` |
| numeric fields | `pd.to_numeric(errors="coerce")`: anything not a plain number becomes *missing* (then quarantined in ③) | `"6,000"` → missing → quarantined |
| `shipment_date` | strict `%Y-%m-%d`; anything else becomes *missing* (then quarantined) | `"01/02/2024"`, `"2024-02-30"` → quarantined |

Why strict instead of "smart" parsing:
* `01/02/2024` is 1 Feb in India and 2 Jan in the US. Guessing would silently put a shipment in the wrong week. Rejecting it with a reason is safer and visible.
* `6,000` could be six thousand or a typo. A wrong cost would directly create or hide a flag, so we never guess. We do not impute or "repair" values anywhere in the pipeline.

---

## 6. Stage ③ Validate and quarantine

Each row is tested against the rules below, in this order. A row that fails is **removed from the calculation and recorded** with its CSV line number, its id and the **first** rule it broke. Nothing is dropped silently.

| # | Rule | Quarantine reason |
|---|---|---|
| 1 | origin and destination present | `missing origin/destination` |
| 2 | origin ≠ destination | `origin equals destination` |
| 3 | date parses as `YYYY-MM-DD` and is a real date | `unparseable shipment_date` |
| 4 | route_type ∈ {Short, Medium, Long} | `unknown route_type` |
| 5 | quantity_tonnes > 0 | `non-positive or missing quantity_tonnes` |
| 6 | distance_km > 0 | `non-positive or missing distance_km` |
| 7 | freight_cost_inr > 0 | `non-positive or missing freight_cost_inr` |
| 8 | shipment_id not seen before (first occurrence kept) | `duplicate shipment_id` |

Rules 5–7 matter most: a zero or negative quantity or distance would make tonne-km zero or negative. That would divide by zero, or flip the sign of cost per tonne-km.

### 6.1 Proof on dirty data

The supplied file triggers none of these rules, so the following synthetic rows were pushed through the real `validate_shipments`. This is the actual output:

| CSV line | id | Input problem | Result |
|---|---|---|---|
| 2 | X01 | `"  mumbai "`, `"PUNE"`, `"short"` | ✅ kept as `Mumbai` → `Pune`, `Short` |
| 3 | X02 | quantity `0` | ❌ `non-positive or missing quantity_tonnes` |
| 4 | X03 | distance `-5` | ❌ `non-positive or missing distance_km` |
| 5 | X04 | cost `"6,000"` | ❌ `non-positive or missing freight_cost_inr` |
| 6 | X05 | date `01/02/2024` | ❌ `unparseable shipment_date` |
| 7 | X06 | Mumbai → Mumbai | ❌ `origin equals destination` |
| 8 | X07 | route_type `Tiny` | ❌ `unknown route_type` |
| 9 | X01 (again) | duplicate id | ❌ `duplicate shipment_id` |
| 10 | X09 | empty origin | ❌ `missing origin/destination` |
| 11 | X10 | same route, but `Medium` | ✅ kept; triggers the route-type check (§7.1) |
| 12 | X11 | empty cost | ❌ `non-positive or missing freight_cost_inr` |
| 13 | X12 | date `2024-02-30` | ❌ `unparseable shipment_date` |

These cases are also covered by `tests/test_core.py::test_bad_rows_are_quarantined_with_reasons`.

### 6.2 Where the quarantine report goes

`DataQuality` records `rows_read`, `rows_used`, `rows_quarantined`, the first 50 quarantined rows, and any warnings. It is written to:
* `output/run.json → data_quality`
* the CLI summary (`Data quality: 2940/2940 rows used, 0 quarantined`)
* the dashboard: the Trust & eval page and the Overview KPI tile

---

## 7. Stage ④ Derive fields

### 7.1 `route` and one `route_type` per route

* `route = origin + "-" + destination` (e.g. `Delhi-Jaipur`). It is **directional**: "same start and end point" in the brief. Every route in this file runs in one direction only.
* The brief says `route_type` is given. If a file ever disagreed with itself (the same route marked `Short` on some rows and `Medium` on others), the route would land in two peer groups. Ferro therefore enforces **one type per route**: the majority type wins, and a warning is recorded.

  ```
  Mumbai-Pune: conflicting route_type (Medium=1, Short=1); using Medium
  ```
  A tie is broken alphabetically so the result is deterministic. This is a fallback; the warning is the real signal that the source data needs fixing.

### 7.2 `tonne_km`

```
tonne_km = quantity_tonnes × distance_km
```
This is computed per shipment, using that shipment's own distance (distances vary by about ±2% within a route).

### 7.3 `week_of`: Monday-start weeks

```python
week_of = date − weekday(date) days      # Monday = 0 … Sunday = 6
```

| Shipment date | Weekday | `week_of` |
|---|---|---|
| 2024-01-01 | Mon | 2024-01-01 |
| 2024-01-07 | **Sun** | **2024-01-01** (same week, not the next) |
| 2024-01-08 | Mon | 2024-01-08 |
| 2025-01-05 | Sun | **2024-12-30** (a week crossing the year boundary belongs to its Monday) |

Weeks are assigned **before** any calculation, as the brief requires.

---

## 8. Stage ⑤ Weekly aggregation

One row per `(route, route_type, week_of)`:

```
shipments          = count of shipments
total_cost         = Σ freight_cost_inr
total_tkm          = Σ (quantity_tonnes × distance_km)
cost_per_tonne_km  = total_cost ÷ total_tkm
```

### 8.1 Why Σcost ÷ Σtonne-km and not the average of per-shipment ratios

The brief defines the metric as *total freight cost / (quantity × distance)*. Dividing totals is that definition. It also weights each shipment by the work it represents: a 22-tonne truck counts for more than a 9-tonne one, which is right for spend monitoring.

It also reproduces the brief's sample row; the simple mean does not:

| Method | Delhi-Jaipur, week of 2024-11-11 | Sample says |
|---|---|---|
| **Σcost ÷ Σtonne-km** | **4.1730 → "4.17"** | **4.17** ✅ |
| mean of the 4 shipment ratios | 4.1618 → "4.16" | ✗ |

Across all 728 route-weeks the two methods differ by at most ₹0.021 per tonne-km. That's small, but enough to change a rounded figure.

### 8.2 Worked example: Delhi-Jaipur, week of 2024-11-11

| Shipment | Date | Transporter | Tonnes | Km | Tonne-km | Cost ₹ | ₹ / t-km |
|---|---|---|---|---|---|---|---|
| SHP01094 | 11 Nov | Trident Carriers | 14.6 | 282.4 | 4,123.04 | 16,887 | 4.096 |
| SHP01095 | 11 Nov | Om Sai Transport | 21.7 | 278.3 | 6,039.11 | 25,465 | 4.217 |
| SHP01096 | 12 Nov | Om Sai Transport | 14.4 | 282.7 | 4,070.88 | 16,730 | 4.110 |
| SHP01093 | 13 Nov | Speedway Logistics | 21.3 | 281.2 | 5,989.56 | 25,306 | 4.225 |
| **Week** | | | | | **20,222.59** | **84,388** | **84,388 ÷ 20,222.59 = 4.1730** |

### 8.3 Result shape

7 routes × 104 weeks = **728 route-week rows**. There are no gaps in this file. If a route had a week with no shipments, that week simply would not exist: no row, no zero, no interpolation.

---

## 9. Stage ⑥ Comparison baselines

Both baselines are computed from the **unrounded** weekly values. Rounding happens only when writing output.

### 9.1 vs own history

```
own_baseline(route, week) = mean of the route's most recent 8 weekly values strictly BEFORE this week
own_pct                   = (cost_per_tonne_km ÷ own_baseline − 1) × 100
```

* **No look-ahead:** the current week and anything after it are never included.
* **It's the mean of 8 weekly values,** not Σcost ÷ Σtkm over 8 weeks. The brief says "rolling average cost per tonne-km", and this reproduces the sample (+35.5%).
* **Fewer than 8 prior weeks** (the first 8 weeks of each route, 56 rows): use all the prior weeks available. Nothing is padded or extrapolated. The count is stored in `run.json → own_weeks_used`, and reasons say "(Own-history baseline uses only N prior weeks)".
* **No prior weeks** (the first week of each route, 7 rows): `vs_own_history = "N/A (no prior weeks)"`. The row cannot be flagged, because a rise cannot be shown without history.
* **Gap weeks:** the 8 most recent *observed* weeks are used. A missing week is never treated as zero.

Worked example (Delhi-Jaipur, 2024-11-11). The 8 prior weeks are:

| 16 Sep | 23 Sep | 30 Sep | 7 Oct | 14 Oct | 21 Oct | 28 Oct | 4 Nov |
|---|---|---|---|---|---|---|---|
| 3.1643 | 3.1518 | 3.0157 | 3.0884 | 3.0946 | 3.0777 | 3.0342 | 3.0070 |

mean = **3.0792** → 4.1730 ÷ 3.0792 − 1 = **+35.5%** ✅ (the sample says +35.5%)

### 9.2 vs similar routes

```
peer_baseline(route, week) = mean cost_per_tonne_km of all OTHER routes with the same route_type in the same week
peer_pct                   = (cost_per_tonne_km ÷ peer_baseline − 1) × 100
```

* **Self-excluded,** as the brief requires. It's implemented as (sum of the type-week − own value) ÷ (count − 1), and the peer list is stored in `run.json → peer_routes`.
* **Short routes have one peer each** (Mumbai-Pune ↔ Delhi-Jaipur), Long routes have one each (Mumbai-Delhi ↔ Delhi-Chennai), and Medium routes have two.
* **No peer that week:** `vs_similar_routes = "N/A (no peer routes this week)"`, and the peer trigger is off for that row.

Worked example: Delhi-Jaipur 2024-11-11 against Mumbai-Pune that week (3.4477) → 4.1730 ÷ 3.4477 − 1 = **+21.0%** ✅ (the sample says +21.0%).

---

## 10. Stage ⑦ Context notes → facts

Notes are prose. Before they can be checked against a route-week, `notes.parse_notes` converts each one into four typed facts. It records the exact text that triggered each fact, so the reading can be audited (dashboard → Notes & evidence → "Why it was read this way").

| Fact | How it's read |
|---|---|
| **Scope** | `All Routes` → every route, unless the text says the routes are *not part of this dataset* (then none). `A-B` → that corridor, in either direction. A route sharing only one city does **not** match |
| **Window** | `from Feb 24 to Mar 8` → that exact range. `starting this week` → a level shift: the note's week + 8 weeks. `this quarter` → that calendar quarter. Otherwise the Monday–Sunday week of the note's date |
| **Effect** | "No impact" language is checked **first** and wins: *not significantly affected, without a rate change, absorbed by transporters, no disruptions, remained stable, returned to normal, improved road*. Then increase language: *surcharge, higher costs, pushing up, rose, increase, detours, new toll*. Neither → `unknown`, which never justifies anything |
| **Magnitude** | `5-7%` → [5, 7]; a single `x%` → [x, x] |

Result for the supplied notes (checked against an independently hand-written reading in `eval/note_ground_truth.json`, 10/10):

| Note | Scope | Window | Effect | Can justify? |
|---|---|---|---|---|
| N001 | Chennai ↔ Bangalore | 2025-02-24 → 2025-03-08 | increase | ✅ |
| N002 | Ahmedabad ↔ Mumbai | 2025-01-20 → 2025-01-26 | increase | ✅ |
| N003 | All routes | 2025-05-05 → 2025-06-29 (level shift) | increase, 5–7% | ✅ (within its limits) |
| N004 | none ("not part of this dataset") | 2024-03-11 → 03-17 | increase | ❌ out of scope |
| N005 | Mumbai ↔ Delhi | 2024-07-29 → 08-04 | none ("not significantly affected") | ❌ |
| N006 | All routes | 2025-07-01 → 09-30 (quarter) | none ("no major disruptions") | ❌ |
| N007 | Delhi ↔ Jaipur | 2024-05-20 → 05-26 | none ("improved road") | ❌ |
| N008 | Kolkata ↔ Bhubaneswar | 2025-04-01 → 06-30 (quarter) | none ("no significant disruptions") | ❌ |
| N009 | Chennai ↔ Bangalore | 2025-03-17 → 03-23 | none ("returned to normal") | ❌ |
| N010 | All routes | 2025-10-27 → 11-02 | none ("without a rate change") | ❌ |

How these facts are used to accept or reject a note for a flagged week is covered in `ARCHITECTURE.md` and `DECISIONS.md` (D6–D9).

---

## 11. What is deliberately *not* cleaned

| Not done | Why |
|---|---|
| **Outlier removal.** 49 shipments are more than 3σ from their route median | Unusual costs are exactly what we're looking for. Removing them would hide the Delhi-Jaipur and Chennai-Bangalore spikes |
| **Imputation** of missing or invalid values | A guessed cost or date could create or hide a flag. Invalid rows are quarantined and reported instead |
| **Filling missing weeks** | A week with no shipments has no cost. Inventing one would distort both baselines |
| **Normalising `material` / `transporter`** | They don't feed any calculation. They're displayed as-is in the drill-down |
| **Currency or inflation adjustment** | All costs are INR in the same 2-year period. Rises are judged against recent history and same-week peers, which already absorb broad price changes |
| **Merging A-B with B-A** for cost | The brief defines a route by its start *and* end point. Only *notes* treat a corridor as covering both directions (a flooded highway affects both) |

---

## 12. Stage ⑧ Output: where every column comes from

`output/results.csv` has one row per route-week (728 rows), sorted by `route` and then `week_of`. Its columns match `sample_output_format_v2.csv` exactly.

| Column | Source | Format |
|---|---|---|
| `route` | §7.1 | `Origin-Destination` |
| `week_of` | §7.3 | `YYYY-MM-DD`, always a Monday |
| `cost_per_tonne_km` | §8 | 2 decimals, e.g. `4.17` |
| `vs_own_history` | §9.1 | `+35.5% vs this route's past average` · `N/A (no prior weeks)` |
| `vs_similar_routes` | §9.2 | `+21.0% vs similar-length routes this week` · `N/A (no peer routes this week)` |
| `flagged` | flag rule + note check | `Yes` · `No (justified)` · `No` |
| `matched_note_id` | note check | `N00x` only when `No (justified)`, otherwise blank |
| `reason` | explanation built from the numbers above and the cited note's own words | plain English |

Formatting rules:
* Percentages use 1 decimal with a sign and are computed from unrounded values. A value that rounds to zero prints as `+0.0%`, never `-0.0%`.
* The CSV is UTF-8 with `\n` line endings. Fields containing commas are quoted.
* There are **no timestamps** in any output file, so repeat runs are byte-identical.

Companion files:
* `output/flagged_results.csv`: the same columns, only the `Yes` and `No (justified)` rows.
* `output/run.json`: every intermediate value per row, plus the parsed notes, the data-quality report and the token log. Per-row fields: `shipments`, `total_cost`, `total_tkm`, `own_baseline`, `own_weeks_used`, `peer_baseline`, `peer_routes`, `trigger`, `retrieved` notes with scores, and the four-check `evaluations` for each note.

---

## 13. Determinism of the data path

| Risk | How it's prevented |
|---|---|
| Input row order | all groupbys use `sort=True`; output sorted by `(route, week_of)`; notes sorted by id |
| Float noise | values stay unrounded until the final formatting step; formatting is fixed |
| Locale (dates, decimals) | strict ISO dates; plain decimal numbers only |
| Changed input | `run.json → meta.input_fingerprint` is the sha256 of both CSVs, so you can see exactly which files produced a result |

`python -m ferro repro` runs the whole pipeline three times in fresh processes. It confirms `results.csv`, `flagged_results.csv` and `run.json` have identical sha256 hashes.

---

## 14. How to verify it yourself

```bash
python -m ferro run          # prints rows read / used / quarantined
python -m pytest -q                 # Monday bucketing, Σ-ratio, no look-ahead, <8 weeks, gap weeks,
                                    # peer self-exclusion, quarantine, route-type conflicts
python -m ferro eval         # official sample rows reproduced field-for-field; output contract checks
python -m ferro repro        # 3 identical runs
```

To trace a single number by hand, open `output/run.json` and find the row (e.g. `"route": "Delhi-Jaipur", "week_of": "2024-11-11"`). It lists `total_cost`, `total_tkm`, `own_baseline`, `peer_baseline` and `peer_routes`. In the dashboard, open the same week: the story shows the same values, and **Shipments this week** lists the individual shipments behind them.

---

## 15. Known limitations

* **Route-type ties** are broken alphabetically. That's deterministic but arbitrary; the warning is what should prompt a fix in the source data.
* **Title Casing** handles normal city names. Names with internal capitals (e.g. "McLeod Ganj") would need a lookup table.
* **Thousands separators** (`6,000`) are rejected rather than parsed. That's safe for this format; a feed that always uses them would need an explicit, configured locale.
* **Blank `shipment_id`s** are allowed: ids are not used in any calculation, and the duplicate check skips blanks.
* **Note parsing** is rule-based and tuned to the phrasing of operations notes. A note using unfamiliar wording is read as `unknown` and cannot justify a rise. That is the safe failure mode: a false "unexplained", never a false "justified".
