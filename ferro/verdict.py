"""The trust gate: decides whether a retrieved note *genuinely* justifies a flagged cost rise.

A note justifies a candidate route-week only if ALL checks pass:
  1. scope     the note covers this route (or all routes, and they are in this dataset)
  2. window    the note's effective window overlaps this Monday-Sunday week
  3. effect    the note describes a cost *increase* (not "costs were not affected", not
               "no disruptions", not "roads improved")
  4. magnitude a market-wide note (All Routes) cannot explain a rise vs *peers*, since they
               faced the same shock; and if a note states a size ("5-7%"), the rise vs own
               history must fit within it (+ tolerance)
No passing note -> the row stays flagged ("Yes") and matched_note_id stays blank. We never
guess; a confident wrong reason is worse than "couldn't find one".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .config import Thresholds
from .notes import NoteFact


@dataclass
class Check:
    name: str
    passed: bool
    detail: str


@dataclass
class NoteEvaluation:
    note_id: str
    passed: bool
    checks: list[Check] = field(default_factory=list)

    @property
    def first_failure(self) -> Check | None:
        return next((c for c in self.checks if not c.passed), None)

    def to_dict(self) -> dict:
        return {"note_id": self.note_id, "passed": self.passed,
                "checks": [c.__dict__ for c in self.checks]}


def evaluate_note(fact: NoteFact, route: str, week: date, own_pct: float, trigger: str,
                  t: Thresholds) -> NoteEvaluation:
    checks: list[Check] = []

    scope_ok = fact.applies_to_route(route)
    if fact.scope_kind == "none":
        detail = "note applies to routes outside this dataset" if fact.applies_to.lower().startswith("all") \
            else f"cannot read a route from '{fact.applies_to}'"
    elif scope_ok:
        detail = "applies to all routes" if fact.scope_kind == "all" else f"same corridor ({fact.applies_to})"
    else:
        detail = f"note is about {fact.applies_to}, not {route}"
    checks.append(Check("scope", scope_ok, detail))

    overlap = fact.overlaps(week)
    checks.append(Check(
        "window", overlap,
        f"note window {fact.window_start}..{fact.window_end} "
        + ("covers" if overlap else "does not cover") + f" week of {week.isoformat()}"))

    effect_ok = fact.effect == "increase"
    effect_why = next((r.split("—", 1)[-1].strip() for r in fact.rationale if r.startswith("effect")), fact.effect)
    checks.append(Check("effect", effect_ok,
                        ("note describes a cost increase: " if effect_ok else "note does not describe a cost increase: ")
                        + effect_why))

    mag_ok, mag_detail = True, "no stated magnitude; route-specific event"
    if fact.scope_kind == "all" and trigger in ("peer", "both"):
        mag_ok = False
        mag_detail = ("market-wide note cannot explain a gap vs similar routes, which faced the same change")
    elif fact.magnitude_pct:
        hi = fact.magnitude_pct[1] + t.magnitude_tolerance_pp
        mag_ok = own_pct <= hi
        mag_detail = (f"note states ~{fact.magnitude_pct[0]:g}-{fact.magnitude_pct[1]:g}%; observed "
                      f"{own_pct:+.1f}% vs own history " + ("fits" if mag_ok else f"exceeds it (limit {hi:.0f}%)"))
    elif fact.scope_kind == "all":
        mag_detail = "market-wide note; rise is vs own history only"
    checks.append(Check("magnitude", mag_ok, mag_detail))

    return NoteEvaluation(fact.note_id, all(c.passed for c in checks), checks)


def pick_justification(evaluations: list[NoteEvaluation], facts: dict[str, NoteFact],
                       week: date) -> NoteEvaluation | None:
    passing = [e for e in evaluations if e.passed]
    if not passing:
        return None
    # Most specific evidence wins: corridor notes before market-wide ones, then the
    # note dated closest to the week, then note id for a stable tie-break.
    return sorted(passing, key=lambda e: (
        facts[e.note_id].scope_kind != "corridor",
        abs((date.fromisoformat(facts[e.note_id].date) - week).days),
        e.note_id))[0]
