// Week detail: the full story of one route-week, shared by the explorer, the drawer and the review queue.
import { S, nextStep, review, setReview, REVIEW_STATES } from "./store.js";
import { esc, pct, rupee, int, icon, badge, noteChip, niceDate, weekLabel, term, infoI, toast } from "./util.js";

const t = () => S.data.meta.thresholds;

export function storySteps(r) {
  const th = t();
  const ownBad = r.own_pct !== null && r.own_pct > th.own_history_pct;
  const peerBad = r.peer_pct !== null && r.peer_pct > th.peer_pct && r.own_pct > 0;
  const evals = r.evaluations || [];
  const verdictCls = r.flagged === "Yes" ? "bad" : r.flagged === "No (justified)" ? "ok" : "";
  const notesText = !r.trigger ? "Not needed (no alarm)" :
    r.flagged === "No (justified)" ? `${r.matched_note_id} passes all 4 checks` : `${evals.length} checked · none passes`;
  return `<div class="story">
    <div class="story-step" style="--i:0"><div class="k">${icon("ruler")} 1 · Measure</div>
      <div class="v">${rupee(r.cost_per_tonne_km)}</div><div class="d">${term("cpt", "per tonne-km")} · ${r.shipments} shipments</div></div>
    <div class="story-step ${ownBad ? "bad" : ""}" style="--i:1"><div class="k">${icon("clock")} 2 · ${term("own", "Own history")}</div>
      <div class="v">${pct(r.own_pct)}</div><div class="d">${r.own_baseline === null ? "No prior weeks" : `vs ${rupee(r.own_baseline)} (${r.own_weeks_used}-wk avg)`} · limit +${th.own_history_pct}%</div></div>
    <div class="story-step ${peerBad ? "bad" : ""}" style="--i:2"><div class="k">${icon("scale")} 3 · ${term("peer", "Similar routes")}</div>
      <div class="v">${pct(r.peer_pct)}</div><div class="d">vs ${rupee(r.peer_baseline)} · ${esc((r.peer_routes || []).join(", ") || "no peers")}</div></div>
    <div class="story-step ${verdictCls}" style="--i:3"><div class="k">${icon("doc")} 4 · ${term("gate", "Note check")}</div>
      <div class="v" style="font-size:16px;margin-top:7px">${r.flagged === "Yes" ? "Unexplained" : r.flagged === "No (justified)" ? "Justified" : "Normal"}</div>
      <div class="d">${notesText}</div></div>
  </div>`;
}

export function verdictBox(r) {
  const cls = r.flagged === "Yes" ? "yes" : r.flagged === "No (justified)" ? "just" : "no";
  const title = r.flagged === "Yes" ? "Unexplained rise: needs a human review" :
    r.flagged === "No (justified)" ? `Justified by note ${r.matched_note_id}` : "Within the normal range";
  const ic = r.flagged === "Yes" ? "alert" : r.flagged === "No (justified)" ? "check" : "info";
  return `<div class="verdict-box ${cls}"><div class="vb-ic">${icon(ic)}</div><div>
      <div style="font-weight:650">${title}</div>
      <div style="margin-top:4px;color:var(--ink-2)">${esc(r.reason)} <span class="muted small">(${esc(r.reason_source)})</span></div>
      <div style="margin-top:9px;font-size:13px"><b>Suggested next step:</b> ${esc(nextStep(r))}</div>
    </div></div>`;
}

function evidenceTable(r) {
  const ev = r.evaluations || [];
  if (!ev.length) return "";
  const retrieved = Object.fromEntries((r.retrieved || []).map((h) => [h.note_id, h]));
  const cell = (e, name) => {
    const c = e.checks.find((c) => c.name === name);
    return `<td><span class="ck ${c.passed ? "ok" : "fail"}"><span class="m">${c.passed ? "✓" : "✗"}</span><span class="t">${esc(c.detail)}</span></span></td>`;
  };
  const maxScore = Math.max(...Object.values(retrieved).map((h) => h.score), 0.001);
  return `<div class="section-title"><h3>Evidence trail</h3>${infoI("gate")}</div>
    <p class="muted" style="margin-bottom:8px">The top ${ev.length} notes from hybrid retrieval (text similarity + same route + close in time). Each one goes through the four checks, and only a note that passes all four may justify the rise.</p>
    <div style="overflow-x:auto"><table class="trace"><thead><tr><th>Note</th><th>Relevance</th><th>Route</th><th>Dates</th><th>Cost effect</th><th>Size</th><th>Result</th></tr></thead><tbody>
    ${ev.map((e, i) => {
      const h = retrieved[e.note_id] || {};
      return `<tr style="--i:${i}"><td>${noteChip(e.note_id)}</td>
        <td><span class="mono">${(h.score ?? 0).toFixed(2)}</span><div class="score-bar"><i style="width:${((h.score ?? 0) / maxScore) * 100}%"></i></div></td>
        ${cell(e, "scope")}${cell(e, "window")}${cell(e, "effect")}${cell(e, "magnitude")}
        <td>${e.passed ? '<span class="badge just">✓ Justifies</span>' : '<span class="badge no">✗ Rejected</span>'}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function reviewControls(r) {
  if (r.flagged !== "Yes") return "";
  const rv = review(r);
  return `<div class="section-title"><h3>Your review</h3><span class="muted small">${rv.updated ? "updated " + esc(rv.updated) : "saved in this browser"}</span></div>
    <div class="status-sel" data-review="${esc(r.route)}|${r.week_of}">${REVIEW_STATES.map(([k, l]) =>
      `<button type="button" data-s="${k}" class="${rv.status === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <textarea class="review-note" placeholder="Notes for this alert (who you contacted, what you found)…" data-review-note="${esc(r.route)}|${r.week_of}">${esc(rv.note)}</textarea>`;
}

export function bindReview(root, onChange) {
  root.querySelectorAll("[data-review]").forEach((g) => g.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-s]");
    if (!b) return;
    const r = S.byKey[g.dataset.review];
    setReview(r, { status: b.dataset.s });
    g.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    toast(`${r.route} · ${niceDate(r.week_of)} marked “${b.textContent}”`);
    onChange && onChange();
  }));
  root.querySelectorAll("[data-review-note]").forEach((ta) => {
    let tmo;
    ta.addEventListener("input", () => {
      clearTimeout(tmo);
      tmo = setTimeout(() => { setReview(S.byKey[ta.dataset.reviewNote], { note: ta.value }); onChange && onChange(); }, 400);
    });
  });
}

async function shipmentsBlock(host, r) {
  try {
    const d = await fetch(`/api/week?route=${encodeURIComponent(r.route)}&week=${r.week_of}`).then((x) => x.json());
    if (d.error) throw new Error(d.error);
    const maxC = Math.max(...d.shipments.map((s) => s.cost_per_tonne_km), d.baseline || 0) * 1.08;
    const minC = Math.min(...d.shipments.map((s) => s.cost_per_tonne_km), d.baseline || 99) * 0.92;
    const pos = (v) => ((v - minC) / (maxC - minC)) * 100;
    host.innerHTML = `
      <div class="section-title"><h3>Shipments this week</h3><span class="muted small">which carriers drove the cost?</span></div>
      <div class="insight">${icon("bulb")}<div>${esc(d.insight)}</div></div>
      <div style="overflow-x:auto;margin-top:10px"><table class="trace"><thead><tr><th>Shipment</th><th>Date</th><th>Transporter</th><th>Material</th><th class="num">Tonnes × km</th><th class="num">Cost</th><th>₹ / t-km vs baseline</th></tr></thead><tbody>
      ${d.shipments.map((s, i) => `<tr style="--i:${i}"><td class="mono">${esc(s.shipment_id)}</td><td>${niceDate(s.date)}</td><td>${esc(s.transporter)}</td><td>${esc(s.material)}</td>
        <td class="num">${s.tonnes} × ${s.km}</td><td class="num">₹${int(s.cost)}</td>
        <td><div class="row" style="gap:8px;flex-wrap:nowrap"><b class="tnum" style="min-width:44px">${s.cost_per_tonne_km.toFixed(2)}</b>
          <div class="ship-bar" style="flex:1"><i style="left:0;width:${pos(s.cost_per_tonne_km)}%;background:${s.clearly_above ? "var(--critical)" : "var(--s1)"};opacity:.75"></i>
          ${d.baseline ? `<span class="base" style="left:${pos(d.baseline)}%" title="8-week average ${d.baseline.toFixed(2)}"></span>` : ""}</div>
          <span class="small ${s.pct_vs_baseline > 10 ? "delta-up" : "muted"}" style="min-width:52px;text-align:right">${pct(s.pct_vs_baseline)}</span></div></td></tr>`).join("")}
      </tbody></table></div>
      ${d.transporters.length ? `<div class="chips" style="margin-top:10px">${d.transporters.map((t) =>
        `<span class="chip" style="cursor:default">${icon("truck")}${esc(t.transporter)} · ${t.shipments}× · ${t.cost_per_tonne_km.toFixed(2)}${t.change_pct !== null ? ` <span class="${t.change_pct > 10 ? "delta-up" : "muted"}">${pct(t.change_pct)} vs its last 8 wks</span>` : ""}</span>`).join("")}</div>` : ""}`;
  } catch (e) {
    host.innerHTML = `<p class="muted">Shipment detail unavailable (${esc(e.message)}).</p>`;
  }
}

export function renderDetail(host, r, { header = true, onReview } = {}) {
  host.innerHTML = `
    ${header ? `<div class="card-head" style="margin-bottom:4px"><div>
      <h2>${esc(r.route)} <span class="muted" style="font-weight:500">· ${r.route_type}</span></h2>
      <p class="muted">Week ${weekLabel(r.week_of)} · ₹${int(r.total_cost)} over ${int(r.total_tkm)} tonne-km</p></div>
      <div class="row">${noteChip(r.matched_note_id)}${badge(r.flagged)}</div></div>` : ""}
    ${storySteps(r)}
    ${verdictBox(r)}
    <div class="ship-host"><div class="skel" style="height:120px;margin-top:18px"></div></div>
    ${evidenceTable(r)}
    ${reviewControls(r)}`;
  shipmentsBlock(host.querySelector(".ship-host"), r);
  bindReview(host, onReview);
}
