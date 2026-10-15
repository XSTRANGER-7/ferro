# Evaluation report

**All suites passed:** ✅ yes

| Suite | Result |
|---|---|
| official_sample | ✅ 3/3 |
| labeled_cases | ✅ 20/20 |
| note_parsing | ✅ 10/10 |
| guardrails | ✅ 18/18 |
| retrieval | ✅ 5/5 (recall@4 = 1.0, MRR = 1.0) |
| hallucination_audit | ✅ 3/3 (fabricated = 0) |
| contract | ✅ 4/4 |

## official_sample

| id | pass | detail |
|---|---|---|
| Delhi-Jaipur 2024-11-11 | ✅ | all graded fields identical |
| Ahmedabad-Mumbai 2025-01-20 | ✅ | all graded fields identical |
| Mumbai-Pune 2025-09-15 | ✅ | all graded fields identical |

## labeled_cases

| id | pass | detail |
|---|---|---|
| L01 | ✅ | expected `Yes`, got `Yes` — +35% spike, no note for Delhi-Jaipur in Nov 2024 (N007 is May 2024 and says roads improved). Official sample row. |
| L02 | ✅ | expected `Yes`, got `Yes` — Second week of the same unexplained spike |
| L03 | ✅ | expected `No (justified) N002`, got `No (justified) N002` — Festival surcharge note for this corridor and this exact week. Official sample row. |
| L04 | ✅ | expected `No (justified) N001`, got `No (justified) N001` — Flooding Feb 24 - Mar 8 on this corridor |
| L05 | ✅ | expected `No (justified) N001`, got `No (justified) N001` — Week of Mar 3-9 overlaps the flood window (ends Mar 8) |
| L06 | ✅ | expected `Yes`, got `Yes` — Still elevated, but N001 says roads passable by Mar 9 - outside the note window |
| L07 | ✅ | expected `Yes`, got `Yes` — N009 says conditions returned to normal - it is not a reason for higher cost |
| L08 | ✅ | expected `Yes`, got `Yes` — Gradual creep: +9% own, +24% vs peers. Official sample row. |
| L09 | ✅ | expected `Yes`, got `Yes` — Creep continues, ~+39% vs Delhi-Jaipur |
| L10 | ✅ | expected `Yes`, got `Yes` — Creep continues, ~+39% vs Delhi-Jaipur |
| L11 | ✅ | expected `No`, got `No` — Decoy N005: maintenance but costs not affected; data shows no rise |
| L12 | ✅ | expected `No`, got `No` — Decoy N007: road improvement week; normal cost |
| L13 | ✅ | expected `No`, got `No` — Decoy N008: no disruption; normal cost |
| L14 | ✅ | expected `No`, got `No` — Diesel step-up (~+12%) stays under the +15% own-history threshold |
| L15 | ✅ | expected `No`, got `No` — Diesel week; route did not move |
| L16 | ✅ | expected `No`, got `No` — Week after the festival: back to normal |
| L17 | ✅ | expected `No`, got `No` — Flood effects over |
| L18 | ✅ | expected `No`, got `No` — Spike over |
| L19 | ✅ | expected `No`, got `No` — First week on record: no history so a rise cannot be shown |
| L20 | ✅ | expected `No`, got `No` — Decoy N010: mandate absorbed without rate change |

## note_parsing

| id | pass | detail |
|---|---|---|
| N001 | ✅ | matches |
| N002 | ✅ | matches |
| N003 | ✅ | matches |
| N004 | ✅ | matches |
| N005 | ✅ | matches |
| N006 | ✅ | matches |
| N007 | ✅ | matches |
| N008 | ✅ | matches |
| N009 | ✅ | matches |
| N010 | ✅ | matches |

## guardrails

| id | pass | detail |
|---|---|---|
| G01 | ✅ | expected `(none)`, got `(none)` — Right route + right week but note says roads IMPROVED (N007) |
| G02 | ✅ | expected `(none)`, got `(none)` — Right route + right week but note says costs NOT affected (N005) |
| G03 | ✅ | expected `(none)`, got `(none)` — Right route + quarter but note says NO disruptions (N008) |
| G04 | ✅ | expected `(none)`, got `(none)` — All-routes toll note whose routes are outside the dataset (N004) |
| G05 | ✅ | expected `(none)`, got `(none)` — All-routes note reporting stable demand (N006) |
| G06 | ✅ | expected `(none)`, got `(none)` — All-routes mandate absorbed without rate change (N010) |
| G07 | ✅ | expected `(none)`, got `(none)` — Same corridor but note marks the RETURN to normal (N009) |
| G08 | ✅ | expected `(none)`, got `(none)` — Right corridor + right cause but window ended Mar 8 (N001) |
| G09 | ✅ | expected `(none)`, got `(none)` — Right corridor but the festival week was the week before (N002) |
| G10 | ✅ | expected `(none)`, got `(none)` — Right week but wrong corridor for the festival note (N002) |
| G11 | ✅ | expected `(none)`, got `(none)` — Shares a city (Chennai) with the flood corridor but is a different route (N001) |
| G12 | ✅ | expected `(none)`, got `(none)` — Diesel note states 5-7%; a +16% rise is far bigger (N003 magnitude) |
| G13 | ✅ | expected `(none)`, got `(none)` — Diesel hit every route; it cannot explain a gap vs peers (N003) |
| G14 | ✅ | expected `(none)`, got `(none)` — Diesel level shift already absorbed by the 8-week baseline (N003 expired) |
| G15 | ✅ | expected `N003`, got `N003` — Positive control: rise vs own history fits the diesel note |
| G16 | ✅ | expected `N001`, got `N001` — Positive control: flood week |
| G17 | ✅ | expected `N002`, got `N002` — Positive control: festival week |
| G18 | ✅ | expected `N001`, got `N001` — Positive control: corridor notes cover both directions |

## retrieval

| id | pass | detail |
|---|---|---|
| Ahmedabad-Mumbai 2025-01-20 -> N002 | ✅ | rank 1; top-k ['N002', 'N006', 'N003', 'N010'] |
| Bangalore-Chennai 2025-02-24 -> N001 | ✅ | rank 1; top-k ['N001', 'N009', 'N006', 'N003'] |
| Chennai-Bangalore 2025-02-24 -> N001 | ✅ | rank 1; top-k ['N001', 'N009', 'N006', 'N003'] |
| Chennai-Bangalore 2025-03-03 -> N001 | ✅ | rank 1; top-k ['N001', 'N009', 'N006', 'N003'] |
| Mumbai-Delhi 2025-05-12 -> N003 | ✅ | rank 1; top-k ['N003', 'N005', 'N008', 'N006'] |

## hallucination_audit

| id | pass | detail |
|---|---|---|
| Ahmedabad-Mumbai 2025-01-20 -> N002 | ✅ | route, window and effect all check out |
| Chennai-Bangalore 2025-02-24 -> N001 | ✅ | route, window and effect all check out |
| Chennai-Bangalore 2025-03-03 -> N001 | ✅ | route, window and effect all check out |

## contract

| id | pass | detail |
|---|---|---|
| header matches sample exactly | ✅ | ['route', 'week_of', 'cost_per_tonne_km', 'vs_own_history', 'vs_similar_routes', 'flagged', 'matched_note_id', 'reason'] |
| every row has valid types/formats | ✅ | 728 rows, 0 invalid |
| every week_of is a Monday | ✅ |  |
| one row per route-week | ✅ |  |

## Threshold sensitivity

| own-history % | peer % | flagged (Yes) | justified | label accuracy |
|---|---|---|---|---|
| 10 | 15 | 24 | 3 | 19/20 |
| 10 | 20 | 17 | 3 | 19/20 |
| 10 | 25 | 11 | 3 | 18/20 |
| 12.5 | 15 | 23 | 3 | 20/20 |
| 12.5 | 20 | 16 | 3 | 20/20 |
| 12.5 | 25 | 10 | 3 | 19/20 |
| 15 | 15 | 23 | 3 | 20/20 |
| 15 | 20 | 16 | 3 | 20/20 ← chosen |
| 15 | 25 | 10 | 3 | 19/20 |
| 17.5 | 15 | 23 | 3 | 20/20 |
| 17.5 | 20 | 16 | 3 | 20/20 |
| 17.5 | 25 | 10 | 3 | 19/20 |
| 20 | 15 | 23 | 3 | 20/20 |
| 20 | 20 | 16 | 3 | 20/20 |
| 20 | 25 | 10 | 3 | 19/20 |
