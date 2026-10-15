import { S } from "../store.js";
import { esc, icon, niceDate, infoI } from "../util.js";
import { timeline } from "../charts.js";

export const title = "Notes & evidence";
let filter = "all";

function facts(n) {
  const scope = n.scope_kind === "all" ? "All routes" : n.scope_kind === "none" ? "None in this dataset" : n.corridor.join(" ↔ ");
  const f = [
    ["Route", scope, n.scope_kind !== "none"],
    ["Dates", `${niceDate(n.window_start)} → ${niceDate(n.window_end)}`, true],
    ["Cost effect", n.effect === "increase" ? "Increase" : n.effect === "none" ? "No cost impact" : "Unclear", n.effect === "increase"],
    ["Size", n.magnitude_pct ? `~${n.magnitude_pct[0]}–${n.magnitude_pct[1]}%` : "Not stated", true],
  ];
  return `<div class="facts">${f.map(([k, v, ok]) => `<div class="fact ${ok ? "" : "fail"}"><div class="k">${ok ? "" : "✗ "}${k}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>`;
}

export function render(view, params, app) {
  view.innerHTML = `
    <div class="page-head reveal"><div><h1>Notes &amp; evidence</h1>
      <p>Context notes are the only evidence allowed to justify a cost rise. Each note is read into four facts: <b>route</b>, <b>dates</b>, <b>cost effect</b> and <b>size</b>. Six of the ten are decoys: they say costs were <i>not</i> affected, or they mark the end of an event.</p></div></div>
    <div class="card reveal">
      <div class="card-head"><div><h2>Timeline: note windows vs flagged weeks</h2>
        <p class="muted">Green bands can justify a rise; grey dashed bands cannot. A red dot outside any green band stays unexplained. Hover or click anything.</p></div>
        <div class="seg" id="tl-filter"><button data-f="all">All notes</button><button data-f="justify">Can justify</button><button data-f="decoy">Decoys</button></div></div>
      <div class="timeline" id="timeline"></div>
      <div class="legend-row"><span><i class="key" style="background:var(--band);border:1px solid var(--good);height:12px;width:18px"></i>Note that can justify</span>
        <span><i class="key" style="background:var(--band-no);border:1px dashed var(--axis);height:12px;width:18px"></i>Decoy / no cost impact</span>
        <span><span class="dot" style="background:var(--critical)"></span>Unexplained week</span><span><span class="dot" style="background:var(--good)"></span>Justified week</span></div>
    </div>
    <div class="toolbar" style="margin-top:22px"><h2 style="margin-right:8px">The ${Object.keys(S.notes).length} notes</h2>
      <div class="seg" id="card-filter"><button data-f="all">All</button><button data-f="justify">Can justify</button><button data-f="decoy">Decoys</button></div>
      <span class="muted small">${infoI("gate")} How notes are checked</span></div>
    <div class="notes-grid" id="grid"></div>`;

  const grid = view.querySelector("#grid");
  function cards() {
    const list = Object.values(S.notes).filter((n) => filter === "all" || (filter === "justify" ? n.can_justify : !n.can_justify));
    grid.innerHTML = list.map((n, i) => {
      const used = S.rows.filter((r) => r.matched_note_id === n.note_id);
      const rejected = S.rows.filter((r) => (r.evaluations || []).some((e) => e.note_id === n.note_id && !e.passed));
      return `<div class="note-card" id="note-${esc(n.note_id)}" style="--i:${i}">
        <div class="note-head"><div><span class="note-id">${esc(n.note_id)}</span> <span class="muted">· ${niceDate(n.date)} · ${esc(n.applies_to)}</span></div>
          ${n.can_justify ? `<span class="badge just">${icon("check")}Can justify</span>` : `<span class="badge no">⊘ Decoy</span>`}</div>
        <div class="note-text">${esc(n.text)}</div>
        ${facts(n)}
        <details><summary>Why it was read this way</summary><ul class="rationale">${n.rationale.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>
        <div class="small">${used.length ? `<b style="color:var(--good-ink)">Justifies:</b> ${used.map((r) => `<a href="#/explorer/${encodeURIComponent(r.route)}/${r.week_of}">${esc(r.route)} · ${niceDate(r.week_of)}</a>`).join(", ")}` : `<span class="muted">Never used as a justification.</span>`}
          ${rejected.length ? `<div class="muted" style="margin-top:3px">Retrieved and rejected for ${rejected.length} flagged week${rejected.length > 1 ? "s" : ""}.</div>` : ""}</div>
      </div>`;
    }).join("");
    view.querySelectorAll("#card-filter button").forEach((b) => b.classList.toggle("on", b.dataset.f === filter));
  }
  const drawTl = () => timeline(view.querySelector("#timeline"), {
    filter,
    onNote: (id) => focusNote(id),
    onPick: (r) => app.openDrawer(r),
  });
  function focusNote(id) {
    if (filter !== "all" && !view.querySelector("#note-" + id)) { filter = "all"; cards(); }
    const c = view.querySelector("#note-" + id);
    if (!c) return;
    c.scrollIntoView({ behavior: "smooth", block: "center" });
    c.classList.add("flash");
    setTimeout(() => c.classList.remove("flash"), 1800);
  }
  const setF = (f) => {
    filter = f;
    view.querySelectorAll("#tl-filter button").forEach((b) => b.classList.toggle("on", b.dataset.f === f));
    cards(); drawTl();
  };
  view.querySelector("#tl-filter").onclick = (e) => { const b = e.target.closest("button"); if (b) setF(b.dataset.f); };
  view.querySelector("#card-filter").onclick = (e) => { const b = e.target.closest("button"); if (b) setF(b.dataset.f); };
  setF(filter);
  if (params.parts[0]) setTimeout(() => focusNote(params.parts[0]), 350);
  return { onResize: drawTl };
}
