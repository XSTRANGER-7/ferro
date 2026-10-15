"""Turn free-text context notes into typed, checkable facts.

Each note becomes a NoteFact with:
  scope      which routes it applies to ("all", a corridor, or nothing)
  window     the dates during which it can explain a cost change
  effect     "increase" | "none" | "unknown": does the note actually describe a cost rise?
  magnitude  stated size of the effect, e.g. (5, 7) for "roughly 5-7%"
and a `rationale` list recording *which text* triggered each decision, so a reviewer
can audit the extraction instead of trusting it.

Rules are deliberately conservative: anything we cannot read with confidence is
"unknown", which the verdict gate treats as *not* a justification.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

import pandas as pd

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

# Phrases saying the event did NOT raise costs. Checked first: an explicit "costs were not
# affected" beats any incidental cost word elsewhere in the note.
NO_IMPACT_PATTERNS = [
    (r"costs?\s+(?:were|was)\s+not\s+(?:significantly\s+)?affected", "states costs were not affected"),
    (r"without\s+a\s+rate\s+change", "states there was no rate change"),
    (r"absorbed\s+by\s+(?:the\s+)?transporters", "costs absorbed by transporters"),
    (r"no\s+(?:major|significant)\s+disruptions?", "reports no disruptions"),
    (r"remained\s+(?:stable|normal)", "reports conditions remained stable/normal"),
    (r"returned\s+to\s+normal", "reports a return to normal (end of an event, not a cause of cost)"),
    (r"improved\s+road", "describes improved roads (would lower, not raise, cost)"),
]
INCREASE_PATTERNS = [
    (r"surcharge", "mentions a surcharge"),
    (r"higher\s+(?:trip\s+)?costs?", "mentions higher costs"),
    (r"pushing\s+up", "says costs were pushed up"),
    (r"prices?\s+rose|rose\s+nationwide|\brose\b", "says prices rose"),
    (r"\bincreas(?:e|ed|ing)\b", "mentions an increase"),
    (r"longer\s+detours", "mentions longer detours"),
    (r"toll\s+plaza|new\s+toll", "mentions a new toll"),
]
OUT_OF_DATASET = r"not\s+part\s+of\s+this\s+dataset|outside\s+(?:of\s+)?this\s+dataset|not\s+in\s+this\s+dataset"


@dataclass
class NoteFact:
    note_id: str
    date: str
    applies_to: str
    text: str
    scope_kind: str                    # "all" | "corridor" | "none"
    corridor: list[str]                # [cityA, cityB] for corridor scope
    window_start: str
    window_end: str
    window_kind: str                   # "explicit_range" | "level_shift" | "quarter" | "week"
    effect: str                        # "increase" | "none" | "unknown"
    magnitude_pct: list[float] | None  # [low, high]
    rationale: list[str] = field(default_factory=list)

    @property
    def can_justify(self) -> bool:
        return self.scope_kind != "none" and self.effect == "increase"

    def applies_to_route(self, route: str) -> bool:
        if self.scope_kind == "all":
            return True
        if self.scope_kind == "corridor":
            parts = route.split("-")
            # A corridor note covers both directions of travel on that corridor.
            return sorted(p.lower() for p in parts) == sorted(c.lower() for c in self.corridor)
        return False

    def overlaps(self, week_start: date) -> bool:
        week_end = week_start + timedelta(days=6)
        return date.fromisoformat(self.window_start) <= week_end and date.fromisoformat(self.window_end) >= week_start

    def days_from(self, week_start: date) -> int:
        """Distance in days between the week and the note's window (0 if overlapping)."""
        week_end = week_start + timedelta(days=6)
        ws, we = date.fromisoformat(self.window_start), date.fromisoformat(self.window_end)
        if self.overlaps(week_start):
            return 0
        return (ws - week_end).days if week_end < ws else (week_start - we).days

    def to_dict(self) -> dict:
        d = asdict(self)
        d["can_justify"] = self.can_justify
        return d


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _parse_day(token_month: str, token_day: str, year: int) -> date:
    return date(year, MONTHS[token_month[:3].lower()], int(token_day))


def parse_note(note_id: str, note_date: date, applies_to: str, text: str,
               level_shift_weeks: int = 8) -> NoteFact:
    t = text.lower()
    rationale: list[str] = []

    # --- scope -------------------------------------------------------------
    corridor: list[str] = []
    if applies_to.strip().lower() in {"all routes", "all", "*"}:
        if re.search(OUT_OF_DATASET, t):
            scope = "none"
            rationale.append("scope: 'All Routes' header, but text says affected routes are not in this dataset -> no scope")
        else:
            scope = "all"
            rationale.append("scope: applies to all routes")
    else:
        corridor = [p.strip() for p in applies_to.split("-") if p.strip()]
        scope = "corridor" if len(corridor) == 2 else "none"
        rationale.append(f"scope: corridor {applies_to} (either direction)" if scope == "corridor"
                         else f"scope: could not read corridor from '{applies_to}'")

    # --- window ------------------------------------------------------------
    rng = re.search(r"from\s+([a-z]{3,9})\.?\s+(\d{1,2})\s+(?:to|until|through|-)\s+([a-z]{3,9})\.?\s+(\d{1,2})", t)
    if rng and rng.group(1)[:3] in MONTHS and rng.group(3)[:3] in MONTHS:
        start = _parse_day(rng.group(1), rng.group(2), note_date.year)
        end = _parse_day(rng.group(3), rng.group(4), note_date.year)
        if end < start:
            end = end.replace(year=end.year + 1)
        kind = "explicit_range"
        rationale.append(f"window: explicit range '{rng.group(0)}' -> {start}..{end}")
    elif re.search(r"starting\s+(?:this|that)\s+week|starting\s+from|from\s+this\s+week\s+onward", t):
        start = _monday(note_date)
        end = start + timedelta(weeks=level_shift_weeks) - timedelta(days=1)
        kind = "level_shift"
        rationale.append(f"window: level shift starting week of {start}; active {level_shift_weeks} weeks "
                         f"(until the trailing baseline absorbs it) -> {start}..{end}")
    elif re.search(r"this\s+quarter", t):
        q0 = (note_date.month - 1) // 3 * 3 + 1
        start = date(note_date.year, q0, 1)
        end = (date(note_date.year + (q0 + 3 > 12), (q0 + 3 - 1) % 12 + 1, 1) - timedelta(days=1))
        kind = "quarter"
        rationale.append(f"window: 'this quarter' -> {start}..{end}")
    else:
        start = _monday(note_date)
        end = start + timedelta(days=6)
        kind = "week"
        rationale.append(f"window: week of the note date -> {start}..{end}")

    # --- effect ------------------------------------------------------------
    effect = "unknown"
    for pat, why in NO_IMPACT_PATTERNS:
        if re.search(pat, t):
            effect = "none"
            rationale.append(f"effect: none — {why}")
            break
    if effect == "unknown":
        for pat, why in INCREASE_PATTERNS:
            if re.search(pat, t):
                effect = "increase"
                rationale.append(f"effect: increase — {why}")
                break
    if effect == "unknown":
        rationale.append("effect: unknown — no explicit cost-impact language (treated as not justifying)")

    # --- magnitude ---------------------------------------------------------
    magnitude = None
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*%", t)
    if m:
        magnitude = [float(m.group(1)), float(m.group(2))]
    else:
        m = re.search(r"(\d+(?:\.\d+)?)\s*%", t)
        if m:
            magnitude = [float(m.group(1))] * 2
    if magnitude:
        rationale.append(f"magnitude: stated {magnitude[0]:g}-{magnitude[1]:g}%")

    return NoteFact(
        note_id=note_id, date=note_date.isoformat(), applies_to=applies_to, text=text,
        scope_kind=scope, corridor=corridor, window_start=start.isoformat(), window_end=end.isoformat(),
        window_kind=kind, effect=effect, magnitude_pct=magnitude, rationale=rationale,
    )


def parse_notes(notes: pd.DataFrame, level_shift_weeks: int = 8) -> list[NoteFact]:
    return [
        parse_note(r.note_id, r.date.date(), r.applies_to, r.note, level_shift_weeks)
        for r in notes.itertuples()
    ]
