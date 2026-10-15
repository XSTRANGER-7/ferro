"""Grounded, plain-English reasons.

Every reason is first built from a deterministic template that only uses computed numbers and
the cited note's own text. If an LLM is configured, it may *rephrase* that draft; the rewrite
is accepted only if `validate_explanation` confirms it kept the verdict, mentions no extra
note ids, and introduces no new numbers or dates. Otherwise we keep the template.
"""
from __future__ import annotations

import json
import math
import re

from .config import FLAG_JUSTIFIED, FLAG_NO, FLAG_YES, Thresholds
from .llm import LLMClient
from .notes import NoteFact
from .verdict import NoteEvaluation


def _isnan(x) -> bool:
    return x is None or (isinstance(x, float) and math.isnan(x))


def fmt_pct(x: float) -> str:
    r = round(x, 1)
    return f"{0.0 if r == 0 else r:+.1f}%"


def own_history_text(own_pct: float) -> str:
    return "N/A (no prior weeks)" if _isnan(own_pct) else f"{fmt_pct(own_pct)} vs this route's past average"


def peer_text(peer_pct: float) -> str:
    return "N/A (no peer routes this week)" if _isnan(peer_pct) else f"{fmt_pct(peer_pct)} vs similar-length routes this week"


def _first_sentence(text: str) -> str:
    s = re.split(r"(?<=[.!?])\s+", text.strip())[0]
    return s if s.endswith((".", "!", "?")) else s + "."


def _history_caveat(weeks_used: int, history_weeks: int) -> str:
    if 0 < weeks_used < history_weeks:
        return f" (Own-history baseline uses only {weeks_used} prior week{'s' if weeks_used != 1 else ''}.)"
    return ""


FAILURE_PHRASES = {
    "scope": lambda c: c.detail,
    "window": lambda c: c.detail.replace("note window", "its window"),
    "effect": lambda c: c.detail.replace("note does not describe a cost increase: ", "it does not describe a cost increase (") + ")",
    "magnitude": lambda c: c.detail,
}


def template_reason(row: dict, flagged: str, matched: NoteFact | None,
                    closest: NoteEvaluation | None, closest_fact: NoteFact | None, t: Thresholds) -> str:
    own, peer = row["own_pct"], row["peer_pct"]
    caveat = _history_caveat(row["own_weeks_used"], t.history_weeks)

    if flagged == FLAG_JUSTIFIED and matched is not None:
        mag = ""
        if matched.magnitude_pct:
            mag = f" The {fmt_pct(own)} rise fits the ~{matched.magnitude_pct[0]:g}-{matched.magnitude_pct[1]:g}% the note states."
        return (f"Matches note {matched.note_id} dated {matched.date}: \"{_first_sentence(matched.text)}\" "
                f"It applies to {row['route']} and its window ({matched.window_start} to {matched.window_end}) "
                f"covers this week, so the cost rise has a clear explanation.{mag}{caveat}")

    if flagged == FLAG_YES:
        driver = {
            "own": f"Cost jumped {fmt_pct(own)} vs this route's past average",
            "peer": (f"Cost is {fmt_pct(peer)} vs similar-length routes this week and still above its own past "
                     f"average ({fmt_pct(own)}); its trailing average has risen with it, so the rise shows mainly "
                     f"against peers"),
            "both": f"Cost is {fmt_pct(own)} vs this route's past average and {fmt_pct(peer)} vs similar-length routes",
        }[row["trigger"]]
        if closest is not None and closest_fact is not None:
            fails = [FAILURE_PHRASES[c.name](c) for c in closest.checks if not c.passed]
            evidence = (f"The closest note ({closest_fact.note_id}, {closest_fact.date}) does not justify it: "
                        + "; ".join(fails) + ".")
        else:
            evidence = "No matching note found for this route or date range."
        return f"{driver}. {evidence} No genuine justification found; flagged for human review.{caveat}"

    # Not a candidate
    if _isnan(own):
        return "First week on record for this route: no prior weeks to compare against, so a rise cannot be assessed."
    return (f"Within normal range: {fmt_pct(own)} vs past average and "
            + (f"{fmt_pct(peer)} vs similar routes" if not _isnan(peer) else "no peer routes this week")
            + f" (flag thresholds +{t.own_history_pct:g}% / +{t.peer_pct:g}%).{caveat}")


# ---------------------------------------------------------------- LLM layer

SYSTEM_PROMPT = (
    "You rewrite freight-cost alerts for an operations manager in 1-2 plain-English sentences. "
    "Use ONLY the facts provided. Keep the verdict exactly as given. Do not invent causes, notes, "
    "numbers or dates. If a note id is listed as cited, name it. Never mention any other note id. "
    "Reply with the sentences only."
)


def build_messages(row: dict, flagged: str, draft: str, allowed_ids: list[str]) -> list[dict]:
    facts = {
        "route": row["route"], "week_of": row["week_of"], "verdict": flagged,
        "cost_per_tonne_km": round(row["cost_per_tonne_km"], 2),
        "vs_own_history_pct": None if _isnan(row["own_pct"]) else round(row["own_pct"], 1),
        "vs_similar_routes_pct": None if _isnan(row["peer_pct"]) else round(row["peer_pct"], 1),
        "note_ids_you_may_mention": allowed_ids,
    }
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"FACTS: {json.dumps(facts)}\nDRAFT: {draft}\nRewrite the draft."},
    ]


def validate_explanation(text: str | None, grounding: str, flagged: str, matched_id: str | None,
                         allowed_ids: list[str]) -> tuple[bool, str]:
    """`grounding` is all text the model was given (facts + draft); every number must come from it."""
    if not text or len(text) > 700:
        return False, "empty or too long"
    ids = set(re.findall(r"\bN\d{3}\b", text))
    if not ids <= set(allowed_ids):
        return False, f"mentions note ids not in evidence: {sorted(ids - set(allowed_ids))}"
    low = text.lower()
    if flagged == FLAG_JUSTIFIED:
        if matched_id not in ids:
            return False, "justified reason must cite the matched note id"
        if any(w in low for w in ("unexplained", "no justification", "no genuine")):
            return False, "contradicts the justified verdict"
    if flagged == FLAG_YES and not any(w in low for w in ("unexplained", "review", "no genuine", "not explained",
                                                          "no matching", "no justification")):
        return False, "flagged reason must say the rise is unexplained / needs review"
    allowed_nums = {float(x) for x in re.findall(r"\d+(?:\.\d+)?", grounding)}
    for num in re.findall(r"\d+(?:\.\d+)?", text):
        if float(num) not in allowed_nums:
            return False, f"introduces a number not in the facts: {num}"
    return True, "ok"


def explain_candidate(row: dict, flagged: str, matched: NoteFact | None, closest: NoteEvaluation | None,
                      closest_fact: NoteFact | None, t: Thresholds, llm: LLMClient | None) -> tuple[str, str]:
    """Return (reason, source) where source is 'template' or 'llm'."""
    draft = template_reason(row, flagged, matched, closest, closest_fact, t)
    if llm is None:
        return draft, "template"
    allowed = [x for x in [matched.note_id if matched else None, closest_fact.note_id if closest_fact else None] if x]
    messages = build_messages(row, flagged, draft, allowed)
    text = llm.complete(messages, purpose="explain_flag")
    if text is None:
        return draft, "template"
    # Numbers are grounded if they appear in the draft or in the facts we handed over.
    ok, why = validate_explanation(text, messages[1]["content"], flagged, matched.note_id if matched else None, allowed)
    if not ok:
        from .llm import LedgerEntry
        llm.ledger.add(LedgerEntry("explain_flag", "fallback", 0, 0, note=f"validator rejected: {why}"))
        return draft, "template"
    return text, "llm"
