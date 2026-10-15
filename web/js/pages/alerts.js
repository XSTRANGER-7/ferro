import { S, flagged, review, REVIEW_STATES, resetReviews, nextStep, whatHappened } from "../store.js";
import { esc, pct, rupee, icon, badge, noteChip, niceDate, weekLabel, toast, downloadText, csvCell, term } from "../util.js";
import { bindReview } from "../detail.js";

export const title = "Review queue";
const F = { verdict: "Yes", status: "active", route: "", sort: "newest", open: new Set() };

function checkedSummary(r) {
  const ev = r.evaluations || [];
  if (r.flagged === "No (justified)") return `${ev.length} notes retrieved. <b>${r.matched_note_id}</b> passed all four checks (route, dates, cost effect, size).`;
  const lines = ev.slice(0, 3).map((e) => {
    const f = e.checks.find((c) => !c.passed);
    return `<li>${noteChip(e.note_id)} ${esc(f ? f.detail : "")}</li>`;
  }).join("");
  return `${ev.length} notes retrieved, none passed:<ul style="margin:6px 0 0;padding-left:16px">${lines}</ul>`;
}

export function render(view, params, app) {
  if (params.query.v === "just") F.verdict = "No (justified)";
  view.innerHTML = `
    <div class="page-head reveal"><div><h1>Review queue</h1>
      <p>Every cost rise that crossed a threshold, after the note check. Work through the ${term("unexplained", "unexplained")} ones: set a status and keep notes (saved in this browser). Export the log when you're done.</p></div>
      <div class="row"><button class="btn ghost" id="export">${icon("download")} Export review log</button>
        <button class="btn ghost" id="print">${icon("print")} Print</button></div></div>
    <div class="card reveal" id="progress-card"></div>
    <div class="toolbar reveal" style="margin-top:18px">
      <div class="seg" id="f-verdict"><button data-v="Yes">${icon("alert")} Unexplained</button><button data-v="No (justified)">${icon("check")} Justified</button><button data-v="all">All</button></div>
      <div class="seg" id="f-status"><button data-s="active">To do</button><button data-s="done">Closed</button><button data-s="any">Any status</button></div>
      <label class="field">Route<select id="f-route"><option value="">All routes</option>${S.routes.map((r) => `<option ${F.route === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></label>
      <label class="field">Sort<select id="f-sort"><option value="newest">Newest first</option><option value="biggest">Biggest rise first</option><option value="route">By route</option></select></label>
      <span class="spacer"></span><button class="btn ghost sm" id="expand">Expand all</button>
    </div>
    <div class="queue" id="queue"></div>`;

  const q = view.querySelector("#queue");
  const sync = () => {
    view.querySelectorAll("#f-verdict button").forEach((b) => b.classList.toggle("on", b.dataset.v === F.verdict));
    view.querySelectorAll("#f-status button").forEach((b) => b.classList.toggle("on", b.dataset.s === F.status));
    view.querySelector("#f-sort").value = F.sort;
  };

  function progress() {
    const yes = S.rows.filter((r) => r.flagged === "Yes");
    const c = Object.fromEntries(REVIEW_STATES.map(([k]) => [k, 0]));
    yes.forEach((r) => c[review(r).status]++);
    const colors = { open: "var(--critical)", investigating: "#c98500", resolved: "var(--good)", false_alarm: "var(--muted)" };
    const done = c.resolved + c.false_alarm;
    view.querySelector("#progress-card").innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:10px"><div><h2>${done} of ${yes.length} unexplained alerts closed</h2>
        <p class="muted">${c.open} open · ${c.investigating} investigating · ${c.resolved} resolved · ${c.false_alarm} false alarm</p></div>
        <button class="btn ghost sm" id="reset">${icon("refresh")} Reset statuses</button></div>
      <div class="progress">${REVIEW_STATES.map(([k]) => `<i style="width:${yes.length ? (c[k] / yes.length) * 100 : 0}%;background:${colors[k]}" title="${k}: ${c[k]}"></i>`).join("")}</div>`;
    view.querySelector("#reset").onclick = () => { if (confirm("Reset all review statuses and notes in this browser?")) { resetReviews(); toast("Review statuses reset", "refresh"); list(); } };
  }

  function rowsNow() {
    let rows = flagged().filter((r) => F.verdict === "all" || r.flagged === F.verdict);
    if (F.route) rows = rows.filter((r) => r.route === F.route);
    rows = rows.filter((r) => {
      const st = review(r).status;
      return F.status === "any" || (F.status === "active" ? ["open", "investigating"].includes(st) || r.flagged !== "Yes" : ["resolved", "false_alarm"].includes(st));
    });
    const mag = (r) => Math.max(r.own_pct ?? -1e9, r.peer_pct ?? -1e9);
    rows.sort(F.sort === "biggest" ? (a, b) => mag(b) - mag(a) : F.sort === "route" ? (a, b) => a.route.localeCompare(b.route) || a.week_of.localeCompare(b.week_of)
      : (a, b) => b.week_of.localeCompare(a.week_of) || a.route.localeCompare(b.route));
    return rows;
  }

  function list() {
    progress();
    const rows = rowsNow();
    q.innerHTML = rows.length ? rows.map((r, i) => {
      const k = r.route + "|" + r.week_of, rv = review(r), done = ["resolved", "false_alarm"].includes(rv.status) && r.flagged === "Yes";
      return `<div class="qcard ${r.flagged === "Yes" ? "" : "just"} ${F.open.has(k) ? "open" : ""} ${done ? "done" : ""}" data-k="${esc(k)}" style="--i:${Math.min(i, 12)}">
        <div class="qhead"><span class="stripe"></span>
          <div><div class="qtitle">${esc(r.route)} <span class="muted" style="font-weight:500">· week of ${niceDate(r.week_of)}</span> ${badge(r.flagged)} ${noteChip(r.matched_note_id)}
            ${r.flagged === "Yes" ? `<span class="spill ${rv.status}">${REVIEW_STATES.find(([s]) => s === rv.status)[1]}</span>` : ""}</div>
            <div class="qnums"><span>${rupee(r.cost_per_tonne_km)}/t-km</span><span>own history <b>${pct(r.own_pct)}</b></span>
              <span>similar routes <b>${pct(r.peer_pct)}</b></span><span class="muted">${term("trigger", "trigger")}: ${esc(r.trigger)}</span>${rv.note ? `<span class="muted">${icon("doc")} has notes</span>` : ""}</div></div>
          <span class="chev">${icon("chev")}</span></div>
        <div class="qbody">
          <div class="qgrid">
            <div class="qbox"><h3>What happened</h3>${esc(whatHappened(r))}</div>
            <div class="qbox"><h3>What we checked</h3>${checkedSummary(r)}</div>
            <div class="qbox"><h3>Suggested next step</h3>${esc(nextStep(r))}</div>
          </div>
          <div class="row" style="margin-top:14px"><button class="btn sm" data-detail="${esc(k)}">${icon("search")} Full evidence &amp; shipments</button>
            <a class="btn ghost sm" href="#/explorer/${encodeURIComponent(r.route)}/${r.week_of}">${icon("route")} Open in explorer</a></div>
          ${r.flagged === "Yes" ? `<div style="margin-top:14px"><div class="status-sel" data-review="${esc(k)}">${REVIEW_STATES.map(([s, l]) => `<button type="button" data-s="${s}" class="${rv.status === s ? "on" : ""}">${l}</button>`).join("")}</div>
            <textarea class="review-note" placeholder="Notes: who you contacted, what you found…" data-review-note="${esc(k)}">${esc(rv.note)}</textarea></div>` : ""}
        </div></div>`;
    }).join("") : `<div class="card" style="text-align:center;padding:40px"><div style="font-size:34px">🎉</div><h2 style="margin-top:6px">Nothing here</h2><p class="muted">No alerts match these filters.</p></div>`;
    bindReview(q, () => {
      progress();
      // keep each card's status pill in sync without re-rendering (which would steal focus from the notes box)
      q.querySelectorAll(".qcard").forEach((card) => {
        const pill = card.querySelector(".spill"), r = S.byKey[card.dataset.k];
        if (!pill || !r) return;
        const st = review(r).status;
        pill.className = `spill ${st}`;
        pill.textContent = REVIEW_STATES.find(([s]) => s === st)[1];
      });
    });
  }

  q.addEventListener("click", (e) => {
    const det = e.target.closest("[data-detail]");
    if (det) return app.openDrawer(S.byKey[det.dataset.detail]);
    const head = e.target.closest(".qhead");
    if (head && !e.target.closest(".note-chip")) {
      const card = head.parentElement, k = card.dataset.k;
      card.classList.toggle("open");
      card.classList.contains("open") ? F.open.add(k) : F.open.delete(k);
    }
  });
  view.querySelector("#f-verdict").onclick = (e) => { const b = e.target.closest("button"); if (b) { F.verdict = b.dataset.v; sync(); list(); } };
  view.querySelector("#f-status").onclick = (e) => { const b = e.target.closest("button"); if (b) { F.status = b.dataset.s; sync(); list(); } };
  view.querySelector("#f-route").onchange = (e) => { F.route = e.target.value; list(); };
  view.querySelector("#f-sort").onchange = (e) => { F.sort = e.target.value; list(); };
  view.querySelector("#expand").onclick = (e) => {
    const all = rowsNow().map((r) => r.route + "|" + r.week_of), allOpen = all.every((k) => F.open.has(k));
    all.forEach((k) => (allOpen ? F.open.delete(k) : F.open.add(k)));
    e.target.textContent = allOpen ? "Expand all" : "Collapse all";
    list();
  };
  view.querySelector("#print").onclick = () => window.print();
  view.querySelector("#export").onclick = () => {
    const head = ["route", "week_of", "cost_per_tonne_km", "vs_own_history", "vs_similar_routes", "flagged", "matched_note_id", "review_status", "review_note", "reviewed_at", "suggested_next_step", "reason"];
    const lines = [head.join(",")].concat(flagged().map((r) => {
      const rv = review(r);
      return [r.route, r.week_of, r.cost_per_tonne_km.toFixed(2), r.vs_own_history, r.vs_similar_routes, r.flagged, r.matched_note_id, rv.status, rv.note, rv.updated || "", nextStep(r), r.reason].map(csvCell).join(",");
    }));
    downloadText("ferro_review_log.csv", lines.join("\n"));
    toast("Review log exported", "download");
  };
  sync();
  list();
}
