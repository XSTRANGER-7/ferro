import { S, routeStatus } from "../store.js";
import { esc, pct, rupee, icon, niceDate, infoI } from "../util.js";
import { lineChart } from "../charts.js";
import { renderDetail } from "../detail.js";

export const title = "Route explorer";

export function render(view, params, app) {
  const E = S.explorer;
  if (params.parts[0] && S.byRoute[params.parts[0]]) E.route = params.parts[0];
  E.week = params.parts[1] && S.byKey[E.route + "|" + params.parts[1]] ? params.parts[1] : (E.week && S.byKey[E.route + "|" + E.week] ? E.week : null);
  if (E.week && E.range !== "all" && E.range !== "26" && !E.week.startsWith(E.range)) E.range = "all";
  if (!E.week) {
    const f = S.byRoute[E.route].filter((r) => r.flagged !== "No");
    E.week = (f[f.length - 1] || S.byRoute[E.route][S.byRoute[E.route].length - 1]).week_of;
  }

  view.innerHTML = `
    <div class="page-head reveal"><div><h1>Route explorer</h1>
      <p>Pick a route to see its weekly cost per tonne-km against its own 8-week average and similar routes. Shaded bands are context-note windows. Click any week for the full evidence trail.</p></div></div>
    <div class="route-pills reveal" id="pills">${S.routes.map((r) => {
      const st = routeStatus(r);
      return `<button class="route-pill ${r === E.route ? "on" : ""}" data-r="${esc(r)}"><span class="dot" style="background:${st === "review" ? "var(--critical)" : st === "explained" ? "var(--good)" : "var(--axis)"}"></span>${esc(r)}</button>`;
    }).join("")}</div>
    <div class="card reveal" style="margin-top:16px">
      <div class="card-head"><div><h2 id="c-title"></h2><p class="muted" id="c-sub"></p></div>
        <div class="row">
          <div class="seg" id="range"><button data-r="all">All</button><button data-r="2025">2025</button><button data-r="2024">2024</button><button data-r="26">Last 26 wks</button></div>
          <button class="btn ghost sm" id="notes-toggle">${icon("doc")} Note windows: ${E.showNotes ? "on" : "off"}</button>
        </div></div>
      <div class="row" id="stats" style="gap:22px;margin-bottom:6px"></div>
      <div class="legend" style="margin:6px 0 4px">
        <span><i class="key" style="background:var(--s1)"></i>This route</span><span><i class="key" style="background:var(--s2)"></i>Own 8-week average ${infoI("own")}</span>
        <span><i class="key" style="background:var(--s3)"></i>Similar-route average ${infoI("peer")}</span>
        <span><span class="dot" style="background:var(--critical)"></span>Unexplained</span><span><span class="dot" style="background:var(--good)"></span>Justified</span>
        <span><i class="key" style="background:var(--band);height:10px;width:14px"></i>Note window (⊘ = no cost impact)</span></div>
      <div class="chart-wrap line-chart" id="chart"></div>
    </div>
    <div class="card" id="detail-card">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <div class="week-nav">
          <button class="icon-btn" id="prev-w" title="Previous week (←)">${icon("left")}</button>
          <button class="icon-btn" id="next-w" title="Next week (→)">${icon("right")}</button>
          <button class="btn ghost sm" id="prev-f">${icon("left")} Prev flag</button>
          <button class="btn ghost sm" id="next-f">Next flag ${icon("right")}</button>
          <span class="muted small">Tip: use ← → keys to step through weeks</span>
        </div>
        <button class="btn ghost sm" id="share">${icon("copy")} Copy link</button>
      </div>
      <div id="detail"></div>
    </div>`;

  const visible = () => {
    const all = S.byRoute[E.route];
    if (E.range === "26") return all.slice(-26);
    return E.range === "all" ? all : all.filter((r) => r.week_of.startsWith(E.range));
  };
  let animate = true;
  function draw() {
    const rows = visible(), all = S.byRoute[E.route];
    view.querySelector("#c-title").textContent = `${E.route} · ${all[0].route_type} route`;
    view.querySelector("#c-sub").textContent = `Weekly cost per tonne-km · similar routes: ${(all[0].peer_routes || []).join(", ") || "none"}`;
    view.querySelectorAll("#range button").forEach((b) => b.classList.toggle("on", b.dataset.r === E.range));
    const avg = rows.reduce((a, r) => a + r.cost_per_tonne_km, 0) / rows.length;
    const hi = rows.reduce((a, r) => (r.cost_per_tonne_km > a.cost_per_tonne_km ? r : a));
    const nY = rows.filter((r) => r.flagged === "Yes").length, nJ = rows.filter((r) => r.flagged === "No (justified)").length;
    const chg = (rows[rows.length - 1].cost_per_tonne_km / rows[0].cost_per_tonne_km - 1) * 100;
    view.querySelector("#stats").innerHTML = `
      <div><div class="muted small">Average</div><b class="tnum">${rupee(avg)}</b></div>
      <div><div class="muted small">Peak</div><b class="tnum">${rupee(hi.cost_per_tonne_km)}</b> <span class="muted small">${niceDate(hi.week_of)}</span></div>
      <div><div class="muted small">First → last</div><b class="${chg > 5 ? "delta-up" : chg < -5 ? "delta-down" : ""}">${pct(chg)}</b></div>
      <div><div class="muted small">Flags</div><b style="color:var(--critical-ink)">${nY}</b> unexplained · <b style="color:var(--good-ink)">${nJ}</b> justified</div>`;
    lineChart(view.querySelector("#chart"), rows, { selected: E.week, showNotes: E.showNotes, animate,
      onSelect: (r) => select(r.week_of, true) });
    animate = false;
  }
  function select(week, scroll) {
    E.week = week;
    history.replaceState(null, "", `#/explorer/${encodeURIComponent(E.route)}/${week}`);
    app.setCrumb([["Route explorer", "#/explorer"], [E.route, null], [niceDate(week), null]]);
    draw();
    renderDetail(view.querySelector("#detail"), S.byKey[E.route + "|" + week]);
    if (scroll) view.querySelector("#detail-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const step = (dir, onlyFlags) => {
    const rows = S.byRoute[E.route];
    let i = rows.findIndex((r) => r.week_of === E.week);
    do { i += dir; } while (onlyFlags && i >= 0 && i < rows.length && rows[i].flagged === "No");
    if (i >= 0 && i < rows.length) {
      if (E.range !== "all" && !visible().includes(rows[i])) E.range = "all";
      select(rows[i].week_of, false);
    }
  };

  view.querySelector("#pills").onclick = (e) => {
    const b = e.target.closest("[data-r]");
    if (!b) return;
    E.route = b.dataset.r;
    view.querySelectorAll(".route-pill").forEach((x) => x.classList.toggle("on", x === b));
    const f = S.byRoute[E.route].filter((r) => r.flagged !== "No");
    animate = true;
    select((f[f.length - 1] || S.byRoute[E.route][S.byRoute[E.route].length - 1]).week_of, false);
  };
  view.querySelector("#range").onclick = (e) => { const b = e.target.closest("button"); if (b) { E.range = b.dataset.r; animate = true; draw(); } };
  view.querySelector("#notes-toggle").onclick = (e) => { E.showNotes = !E.showNotes; e.currentTarget.innerHTML = `${icon("doc")} Note windows: ${E.showNotes ? "on" : "off"}`; draw(); };
  view.querySelector("#prev-w").onclick = () => step(-1, false);
  view.querySelector("#next-w").onclick = () => step(1, false);
  view.querySelector("#prev-f").onclick = () => step(-1, true);
  view.querySelector("#next-f").onclick = () => step(1, true);
  view.querySelector("#share").onclick = () => {
    navigator.clipboard?.writeText(location.href).then(() => app.toast("Link copied"), () => app.toast("Copy failed", "x"));
  };
  const onKey = (e) => {
    if (e.target.closest("input,textarea,select") || document.querySelector(".drawer.on,.palette.on")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1, e.shiftKey); }
    if (e.key === "ArrowRight") { e.preventDefault(); step(1, e.shiftKey); }
  };
  addEventListener("keydown", onKey);
  select(E.week, false);
  return { onResize: () => draw(), destroy: () => removeEventListener("keydown", onKey) };
}
