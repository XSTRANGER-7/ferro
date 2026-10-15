# Reproducibility check

3 untouched runs, each in a **fresh Python process**, same input files.

* Graded-field differences (route, week, cost, both comparisons, flag, note id): **0**
* Reason-text differences: **0**
* Verdict: **IDENTICAL ✅**

| run | rows | Yes | No (justified) | No | LLM API calls | cache hits | results.csv sha256 |
|---|---|---|---|---|---|---|---|
| run_1 | 728 | 16 | 3 | 709 | 0 | 0 | `9fef1c622f0d4408…` |
| run_2 | 728 | 16 | 3 | 709 | 0 | 0 | `9fef1c622f0d4408…` |
| run_3 | 728 | 16 | 3 | 709 | 0 | 0 | `9fef1c622f0d4408…` |

| file | identical across runs |
|---|---|
| results.csv | ✅ (1 distinct hash) |
| flagged_results.csv | ✅ (1 distinct hash) |
| run.json | ✅ (1 distinct hash) |

Randomness: the verdict path has none (no sampling, sorted iteration, fixed formatting). The optional LLM runs at temperature 0 with seed 7, and its responses are cached by prompt hash. It only rephrases reason text; validated fields come from code, so the LLM cannot move a flag, note id or number.
