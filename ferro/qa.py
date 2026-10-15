"""Ask the assistant about its own findings, e.g. "why did Chennai-Bangalore get pricier in March?"

Pipeline: question -> entities (route, period, route type, note id) + intent -> select rows from
the run's own results -> compose an answer that cites route-weeks and note ids. Every sentence
is built from computed rows or note text. An optional LLM may rephrase the answer; the rewrite
must pass the same grounding validator as explanations, otherwise the rule-based answer is used.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from statistics import mean

from .config import FLAG_JUSTIFIED, FLAG_NO, FLAG_YES
from .explain import fmt_pct
from .llm import LLMClient
from .notes import NoteFact

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
CITY_ALIASES = {"bengaluru": "bangalore", "bombay": "mumbai", "madras": "chennai", "calcutta": "kolkata",
                "delhi ncr": "delhi", "new delhi": "delhi"}


@dataclass
class Query:
    text: str
    routes: list[str] = field(default_factory=list)
    months: list[int] = field(default_factory=list)
    years: list[int] = field(default_factory=list)
    week: str | None = None
    route_type: str | None = None
    note_ids: list[str] = field(default_factory=list)
    intent: str = "general"


@dataclass
class Answer:
    answer: str
    intent: str
    citations: list[dict] = field(default_factory=list)
    note_ids: list[str] = field(default_factory=list)
    source: str = "rules"
    parsed: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return self.__dict__


class Assistant:
    def __init__(self, rows: list[dict], notes: list[NoteFact], thresholds, llm: LLMClient | None = None) -> None:
        self.rows = rows
        self.notes = {n.note_id: n for n in notes}
        self.t = thresholds
        self.llm = llm
        self.routes = sorted({r["route"] for r in rows})
        self.years = sorted({int(r["week_of"][:4]) for r in rows})

    # ------------------------------------------------------------ parsing
    def parse(self, text: str) -> Query:
        q = Query(text=text)
        low = text.lower()
        for alias, canon in CITY_ALIASES.items():
            low = re.sub(rf"\b{alias}\b", canon, low)
        # routes: exact "A-B" / "A to B" first, else any route whose both cities are mentioned,
        # else routes touching a single mentioned city.
        city_hits = {c for r in self.routes for c in r.lower().split("-") if re.search(rf"\b{c}\b", low)}
        both = [r for r in self.routes if all(c in city_hits for c in r.lower().split("-"))]
        if both:
            # prefer routes whose cities appear in the stated order
            ordered = [r for r in both if low.find(r.lower().split("-")[0]) <= low.find(r.lower().split("-")[1])]
            q.routes = ordered or both
        elif city_hits:
            q.routes = [r for r in self.routes if any(c in city_hits for c in r.lower().split("-"))]
        for i, m in enumerate(MONTHS, start=1):
            if re.search(rf"\b({m}|{m[:3]})\b", low):
                q.months.append(i)
        q.years = sorted({int(y) for y in re.findall(r"\b(20\d\d)\b", low)})
        d = re.search(r"\b(20\d\d-\d\d-\d\d)\b", low)
        if d:
            from datetime import date, timedelta
            dt = date.fromisoformat(d.group(1))
            q.week = (dt - timedelta(days=dt.weekday())).isoformat()
        qm = re.search(r"\bq([1-4])\b", low)
        if qm:
            k = int(qm.group(1))
            q.months = sorted(set(q.months) | set(range(3 * k - 2, 3 * k + 1)))
        for rt in ("short", "medium", "long"):
            if re.search(rf"\b{rt}\b(?:[- ]haul|[- ]distance| routes?)", low):
                q.route_type = rt.title()
        q.note_ids = sorted(set(re.findall(r"\bn\d{3}\b", low)), key=str)
        q.note_ids = [n.upper() for n in q.note_ids]

        if q.note_ids:
            q.intent = "note"
        elif re.search(r"\b(how|what).*(flag|threshold|rule|decide|work|baseline|method)", low) and not q.routes:
            q.intent = "method"
        elif re.search(r"\b(why|reason|explain|cause|pricier|expensive|costlier|spike|jump|rise|rose|increase)\b", low) and (q.routes or q.week):
            q.intent = "why"
        elif re.search(r"\b(justified|explained by|notes? (?:explain|justif))", low):
            q.intent = "justified"
        elif re.search(r"\b(flag|alert|anomal|unexplained|suspicious|review|worry|concern)", low):
            q.intent = "flags"
        elif re.search(r"\b(cheap|expensive|compare|rank|highest|lowest|most|least)\b", low):
            q.intent = "compare"
        elif re.search(r"\b(trend|average|cost|price|rate)\b", low) and q.routes:
            q.intent = "trend"
        elif q.routes:
            q.intent = "why"
        return q

    # ------------------------------------------------------------ selection
    def _in_period(self, r: dict, q: Query) -> bool:
        if q.week:
            return r["week_of"] == q.week
        y, m = int(r["week_of"][:4]), int(r["week_of"][5:7])
        if q.years and y not in q.years:
            return False
        if q.months and m not in q.months:
            return False
        return True

    def _select(self, q: Query) -> list[dict]:
        rows = [r for r in self.rows if self._in_period(r, q)]
        if q.routes:
            rows = [r for r in rows if r["route"] in q.routes]
        if q.route_type:
            rows = [r for r in rows if r["route_type"] == q.route_type]
        return rows

    @staticmethod
    def _cite(r: dict) -> dict:
        return {"route": r["route"], "week_of": r["week_of"], "flagged": r["flagged"],
                "matched_note_id": r["matched_note_id"], "cost_per_tonne_km": round(r["cost_per_tonne_km"], 2)}

    def _period_label(self, q: Query) -> str:
        if q.week:
            return f"the week of {q.week}"
        parts = []
        if q.months:
            parts.append(", ".join(MONTHS[m - 1].title() for m in q.months))
        if q.years:
            parts.append(", ".join(map(str, q.years)))
        return " ".join(parts) if parts else "the full period"

    # ------------------------------------------------------------ answering
    def ask(self, text: str) -> Answer:
        q = self.parse(text)
        handler = getattr(self, f"_answer_{q.intent}", self._answer_general)
        ans = handler(q)
        ans.parsed = {"routes": q.routes, "months": q.months, "years": q.years, "week": q.week,
                      "route_type": q.route_type, "note_ids": q.note_ids, "intent": q.intent}
        return self._maybe_rephrase(text, ans)

    def _answer_why(self, q: Query) -> Answer:
        rows = self._select(q)
        if not rows:
            return Answer(f"I have no shipment weeks for {', '.join(q.routes) or 'that query'} in "
                          f"{self._period_label(q)}.", "why")
        hits = [r for r in rows if r["flagged"] != FLAG_NO]
        if not hits:
            top = max((r for r in rows if r["own_pct"] is not None), key=lambda r: r["own_pct"], default=None)
            msg = (f"Nothing was flagged for {', '.join(q.routes) or 'those routes'} in {self._period_label(q)}. ")
            if top:
                msg += (f"The largest weekly move was {fmt_pct(top['own_pct'])} vs its own past average "
                        f"({top['route']}, week of {top['week_of']}), within the +{self.t.own_history_pct:g}% / "
                        f"+{self.t.peer_pct:g}% thresholds.")
            return Answer(msg, "why", [self._cite(top)] if top else [])
        if len(q.years) == 0 and len({r["week_of"][:4] for r in hits}) > 1 and q.months:
            lead = (f"{self._period_label(q)} appears in more than one year; showing all of them. ")
        else:
            lead = ""
        lines = []
        for r in hits[:8]:
            tag = "justified" if r["flagged"] == FLAG_JUSTIFIED else "UNEXPLAINED"
            lines.append(f"- **{r['route']}, week of {r['week_of']}** ({r['cost_per_tonne_km']:.2f} INR/t-km, "
                         f"{r['vs_own_history'].split(' vs')[0]} vs own history, "
                         f"{r['vs_similar_routes'].split(' vs')[0]} vs peers) — {tag}: {r['reason']}")
        more = f"\n…and {len(hits) - 8} more flagged weeks." if len(hits) > 8 else ""
        n_j = sum(r["flagged"] == FLAG_JUSTIFIED for r in hits)
        head = (f"{lead}{len(hits)} week(s) rose past a threshold in {self._period_label(q)}: "
                f"{n_j} explained by a note, {len(hits) - n_j} unexplained.\n")
        notes = sorted({r["matched_note_id"] for r in hits if r["matched_note_id"]})
        return Answer(head + "\n".join(lines) + more, "why", [self._cite(r) for r in hits], notes)

    def _answer_flags(self, q: Query) -> Answer:
        rows = [r for r in self._select(q) if r["flagged"] == FLAG_YES]
        if not rows:
            return Answer(f"No unexplained cost rises in {self._period_label(q)}"
                          + (f" for {', '.join(q.routes)}" if q.routes else "") + ".", "flags")
        by_route = defaultdict(list)
        for r in rows:
            by_route[r["route"]].append(r)
        lines = [f"- **{route}**: {len(rs)} week(s) — " + ", ".join(
            f"{r['week_of']} ({r['vs_own_history'].split(' vs')[0]} own / {r['vs_similar_routes'].split(' vs')[0]} peers)"
            for r in rs[:6]) + (" …" if len(rs) > 6 else "") for route, rs in sorted(by_route.items())]
        return Answer(f"{len(rows)} unexplained rise(s) flagged for review in {self._period_label(q)}:\n" + "\n".join(lines),
                      "flags", [self._cite(r) for r in rows])

    def _answer_justified(self, q: Query) -> Answer:
        rows = [r for r in self._select(q) if r["flagged"] == FLAG_JUSTIFIED]
        if not rows:
            return Answer(f"No cost rise in {self._period_label(q)} was justified by a note.", "justified")
        lines = [f"- **{r['route']}, week of {r['week_of']}** → {r['matched_note_id']}: "
                 f"{self.notes[r['matched_note_id']].text}" for r in rows]
        return Answer(f"{len(rows)} rise(s) were explained by a context note:\n" + "\n".join(lines), "justified",
                      [self._cite(r) for r in rows], sorted({r["matched_note_id"] for r in rows}))

    def _answer_trend(self, q: Query) -> Answer:
        rows = self._select(q)
        if not rows:
            return Answer(f"No data for that route in {self._period_label(q)}.", "trend")
        lines = []
        for route in sorted({r["route"] for r in rows}):
            rs = [r for r in rows if r["route"] == route]
            avg = mean(r["cost_per_tonne_km"] for r in rs)
            lo, hi = min(rs, key=lambda r: r["cost_per_tonne_km"]), max(rs, key=lambda r: r["cost_per_tonne_km"])
            first, last = rs[0]["cost_per_tonne_km"], rs[-1]["cost_per_tonne_km"]
            lines.append(f"- **{route}** ({rs[0]['route_type']}): avg {avg:.2f} INR/t-km over {len(rs)} weeks; "
                         f"low {lo['cost_per_tonne_km']:.2f} ({lo['week_of']}), high {hi['cost_per_tonne_km']:.2f} "
                         f"({hi['week_of']}); first→last {fmt_pct((last / first - 1) * 100)}; "
                         f"{sum(r['flagged'] == FLAG_YES for r in rs)} unexplained flag(s).")
        return Answer(f"Cost per tonne-km in {self._period_label(q)}:\n" + "\n".join(lines), "trend",
                      [self._cite(r) for r in rows if r["flagged"] != FLAG_NO])

    def _answer_compare(self, q: Query) -> Answer:
        rows = self._select(q)
        stats = []
        for route in sorted({r["route"] for r in rows}):
            rs = [r for r in rows if r["route"] == route]
            stats.append((mean(r["cost_per_tonne_km"] for r in rs), route, rs[0]["route_type"],
                          sum(r["flagged"] == FLAG_YES for r in rs)))
        stats.sort()
        lines = [f"{i}. **{route}** ({rt}) — avg {avg:.2f} INR/t-km, {fl} unexplained flag(s)"
                 for i, (avg, route, rt, fl) in enumerate(stats, 1)]
        return Answer(f"Routes ranked by average cost per tonne-km, cheapest first ({self._period_label(q)}). "
                      f"Compare within a route type: longer hauls are naturally cheaper per t-km.\n" + "\n".join(lines),
                      "compare")

    def _answer_note(self, q: Query) -> Answer:
        parts = []
        for nid in q.note_ids:
            n = self.notes.get(nid)
            if not n:
                parts.append(f"- {nid}: no such note.")
                continue
            used = [r for r in self.rows if r["matched_note_id"] == nid]
            verdict = (f"used to justify {len(used)} week(s): " + ", ".join(f"{r['route']} {r['week_of']}" for r in used)
                       if used else ("never used as a justification — " +
                                     ("it does not describe a cost increase" if n.effect != "increase"
                                      else "its scope is outside this dataset" if n.scope_kind == "none"
                                      else "no flagged week fell inside its scope and window")))
            parts.append(f"- **{nid}** ({n.date}, {n.applies_to}): \"{n.text}\"\n  Read as: scope={n.scope_kind}, "
                         f"window {n.window_start}..{n.window_end}, effect={n.effect}"
                         + (f", magnitude {n.magnitude_pct[0]:g}-{n.magnitude_pct[1]:g}%" if n.magnitude_pct else "")
                         + f". {verdict}.")
        return Answer("\n".join(parts), "note", note_ids=q.note_ids)

    def _answer_method(self, q: Query) -> Answer:
        t = self.t
        return Answer(
            f"Each route's weekly cost per tonne-km (Σ cost ÷ Σ tonne-km, Monday-Sunday weeks) is compared with "
            f"(1) its own average over the previous {t.history_weeks} weeks and (2) the average of other routes of the "
            f"same type that week. A week is flagged when it is more than +{t.own_history_pct:g}% above its own history, "
            f"or more than +{t.peer_pct:g}% above peers while still above its own history. Flagged weeks are checked "
            f"against the context notes: a note counts only if it covers the route, its date window covers the week, "
            f"it actually describes a cost increase, and (for market-wide notes) its stated size fits the rise. "
            f"Otherwise the week stays flagged as unexplained.", "method")

    def _answer_general(self, q: Query) -> Answer:
        if q.routes or q.months or q.years:
            return self._answer_why(q)
        total = {k: sum(r["flagged"] == k for r in self.rows) for k in (FLAG_YES, FLAG_JUSTIFIED)}
        return Answer(
            f"I watch {len(self.routes)} routes over {len({r['week_of'] for r in self.rows})} weeks. "
            f"{total[FLAG_YES]} weeks are flagged as unexplained and {total[FLAG_JUSTIFIED]} rises are justified by notes. "
            f"Try: \"why did Chennai-Bangalore get pricier in March 2025?\", \"which routes are flagged?\", "
            f"\"what does N003 say?\", or \"how do you decide a flag?\"", "general")

    # ------------------------------------------------------------ optional LLM phrasing
    def _maybe_rephrase(self, question: str, ans: Answer) -> Answer:
        if not self.llm or not self.llm.enabled or ans.intent in ("method", "note"):
            return ans
        from .explain import validate_explanation  # same grounding guardrail
        msgs = [
            {"role": "system", "content": "Answer the user's question in under 120 words using ONLY the findings "
                                          "given. Keep every route, date, number and note id exactly as written; add none."},
            {"role": "user", "content": f"QUESTION: {question}\nFINDINGS:\n{ans.answer}"},
        ]
        text = self.llm.complete(msgs, purpose="qa")
        if text:
            ok, _ = validate_explanation(text, ans.answer, FLAG_NO, None,
                                         sorted(set(re.findall(r"\bN\d{3}\b", ans.answer))))
            if ok:
                return Answer(text, ans.intent, ans.citations, ans.note_ids, "llm")
        return ans
