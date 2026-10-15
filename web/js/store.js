// Shared app state, loaded once from /api/bootstrap.
import { pct, rupee, niceDate } from "./util.js";

export const S = {
  data: null, rows: [], routes: [], notes: {}, byRoute: {}, byKey: {}, weeks: [],
  explorer: { route: null, week: null, range: "all", showNotes: true },
  trust: null,
};

export async function load() {
  const d = await fetch("/api/bootstrap").then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  S.data = d;
  S.rows = d.rows;
  d.notes.forEach((n) => (S.notes[n.note_id] = n));
  const order = ["Short", "Medium", "Long"];
  S.rows.forEach((r) => {
    (S.byRoute[r.route] ||= []).push(r);
    S.byKey[r.route + "|" + r.week_of] = r;
  });
  S.routes = Object.keys(S.byRoute).sort((a, b) =>
    order.indexOf(S.byRoute[a][0].route_type) - order.indexOf(S.byRoute[b][0].route_type) || a.localeCompare(b));
  S.weeks = [...new Set(S.rows.map((r) => r.week_of))].sort();
  S.explorer.route = S.rows.find((r) => r.flagged === "Yes")?.route || S.routes[0];
  return S;
}

export const flagged = () => S.rows.filter((r) => r.flagged !== "No");
export const unexplained = () => S.rows.filter((r) => r.flagged === "Yes");
export const justified = () => S.rows.filter((r) => r.flagged === "No (justified)");

export function routeStatus(route) {
  const rs = S.byRoute[route];
  if (rs.some((r) => r.flagged === "Yes")) return "review";
  if (rs.some((r) => r.flagged === "No (justified)")) return "explained";
  return "healthy";
}
export const STATUS_LABEL = { review: "Needs review", explained: "Explained", healthy: "Healthy" };

export function notesForRoute(route) {
  const parts = route.toLowerCase().split("-").sort().join();
  return Object.values(S.notes).filter((n) => n.scope_kind === "all" ||
    (n.scope_kind === "corridor" && n.corridor.map((c) => c.toLowerCase()).sort().join() === parts));
}

// ------------------------------------------------------------------ review queue (per-viewer, browser storage)
const KEY = "ferro-review-v1";
let reviews = {};
try { reviews = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { reviews = {}; }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(reviews)); } catch (e) { /* storage blocked */ } };
export const REVIEW_STATES = [
  ["open", "Open"], ["investigating", "Investigating"], ["resolved", "Resolved"], ["false_alarm", "False alarm"],
];
export function review(row) {
  const k = row.route + "|" + row.week_of;
  return reviews[k] || { status: row.flagged === "Yes" ? "open" : "resolved", note: "", updated: null, auto: row.flagged !== "Yes" };
}
export function setReview(row, patch) {
  const k = row.route + "|" + row.week_of;
  reviews[k] = { ...review(row), ...patch, auto: false, updated: new Date().toISOString().slice(0, 16).replace("T", " ") };
  persist();
}
export function resetReviews() { reviews = {}; persist(); }

// ------------------------------------------------------------------ plain-English guidance
export function nextStep(r) {
  if (r.flagged === "No (justified)") {
    const n = S.notes[r.matched_note_id];
    return `No action needed: ${r.matched_note_id} explains it. Check that costs return to normal after ${niceDate(n.window_end)}, when the note's window ends.`;
  }
  if (r.flagged !== "Yes") return "Nothing to do. This week is within the normal range.";
  if (r.trigger === "peer") {
    return `Benchmark ${r.route}'s rate against ${(r.peer_routes || []).join(", ")}: it is ${pct(r.peer_pct)} above them. ` +
      `If no reason emerges, renegotiate or re-tender the lane.`;
  }
  return `Ask the transporters on ${r.route} for this week's invoices and the reason for the ${pct(r.own_pct)} jump, and compare with the rate card. ` +
    `If a genuine cause turns up (fuel, toll, weather), add it as a context note so it is justified next time.`;
}

export function whatHappened(r) {
  const base = r.own_baseline === null ? "" : ` vs its 8-week average of ${rupee(r.own_baseline)}`;
  return `${r.route} cost ${rupee(r.cost_per_tonne_km)} per tonne-km in the week of ${niceDate(r.week_of)}: ` +
    `${pct(r.own_pct)}${base}, and ${pct(r.peer_pct)} vs similar routes (${rupee(r.peer_baseline)}).`;
}
