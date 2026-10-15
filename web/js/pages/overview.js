import { S, unexplained, justified, routeStatus, STATUS_LABEL, review } from "../store.js";
import { esc, pct, rupee, icon, countUp, niceDate, MONTHS, term, infoI } from "../util.js";
import { sparkline, monthBars, heatmap } from "../charts.js";

export const title = "Overview";
let metric = "own_pct";

function heroArt() {
  // The most-flagged route, drawn as an animated trace against its peers.
  const counts = {};
  unexplained().forEach((r) => (counts[r.route] = (counts[r.route] || 0) + 1));
  const route = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || S.routes[0];
  const rows = S.byRoute[route];
  const W = 560, H = 220, vals = rows.flatMap((r) => [r.cost_per_tonne_km, r.peer_baseline]).filter((v) => v !== null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i) => 20 + (i / (rows.length - 1)) * (W - 40), y = (v) => H - 30 - ((v - lo) / (hi - lo)) * (H - 70);
  const path = (k) => rows.map((r, i) => (r[k] === null ? "" : `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`)).join("");
  const dots = rows.map((r, i) => r.flagged === "No" ? "" :
    `<circle cx="${x(i)}" cy="${y(r.cost_per_tonne_km)}" r="4.5" fill="var(--${r.flagged === "Yes" ? "critical" : "good"})" stroke="var(--surface)" stroke-width="2" style="animation-delay:${2000 + i * 6}ms"/>`).join("");
  return { route, svg: `<svg class="hero-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMaxYMid meet" aria-hidden="true">
      <path class="ghost trace" pathLength="1000" d="${path("peer_baseline")}" stroke="var(--s3)"/>
      <path class="trace" pathLength="1000" d="${path("cost_per_tonne_km")}" stroke="var(--s1)"/>${dots}
      <text x="${W - 20}" y="${H - 8}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(route)} vs similar routes</text></svg>` };
}

function headline() {
  const yes = unexplained(), routes = [...new Set(yes.map((r) => r.route))];
  const open = yes.filter((r) => ["open", "investigating"].includes(review(r).status)).length;
  const worst = yes.slice().sort((a, b) => Math.max(b.own_pct, b.peer_pct) - Math.max(a.own_pct, a.peer_pct))[0];
  const counts = {};
  yes.forEach((r) => (counts[r.route] = (counts[r.route] || 0) + 1));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const topRows = top ? S.byRoute[top[0]].filter((r) => r.flagged === "Yes") : [];
  return {
    h1: open ? `<span class="hl">${open} cost ${open === 1 ? "rise needs" : "rises need"}</span> your review on ${routes.length} route${routes.length === 1 ? "" : "s"}`
      : `All ${yes.length} unexplained rises have been reviewed`,
    lead: `I checked ${S.data.meta.route_weeks} route-weeks (${niceDate(S.data.meta.first_week)} – ${niceDate(S.data.meta.last_week)}). ` +
      `${justified().length} rises are explained by context notes. ${yes.length} are not. ` +
      (top ? `The biggest concern is <b>${esc(top[0])}</b>: ${top[1]} unexplained weeks since ${niceDate(topRows[0].week_of)}, up to ${pct(Math.max(...topRows.map((r) => r.peer_pct)))} above similar routes.` : ""),
    worst,
  };
}

function monthly(flag) {
  const months = [...new Set(S.weeks.map((w) => w.slice(0, 7)))];
  return months.map((m) => ({ label: `${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`, v: S.rows.filter((r) => r.flagged === flag && r.week_of.startsWith(m)).length }));
}

export function render(view, params, app) {
  const fc = S.data.meta.flag_counts;
  const yes = unexplained();
  const reviewed = yes.filter((r) => ["resolved", "false_alarm"].includes(review(r).status)).length;
  const hd = headline(), art = heroArt();
  const tl = S.data.token_log;

  view.innerHTML = `
  <section class="hero reveal">
    ${art.svg}
    <div class="row" style="margin:0 0 10px"><span class="badge info">${icon("spark")} Latest run · ${S.routes.length} routes · ${S.weeks.length} weeks</span></div>
    <h1>${hd.h1}</h1>
    <p class="lead">${hd.lead}</p>
    <div class="row">
      <a class="btn" href="#/alerts">${icon("alert")} Start reviewing</a>
      <a class="btn ghost" href="#/explorer/${encodeURIComponent(art.route)}">${icon("route")} Explore ${esc(art.route)}</a>
      <a class="btn ghost" href="#/ask">${icon("chat")} Ask a question</a>
    </div>
  </section>

  <div class="kpis reveal">
    <div class="kpi click" data-go="#/alerts"><div class="label"><span class="dot pulse" style="background:var(--critical);color:var(--critical)"></span>${term("unexplained", "Unexplained rises")}</div>
      <div class="value" data-count="${fc["Yes"]}">0</div><div class="sub">route-weeks needing review</div>
      <div class="spark">${monthBars(monthly("Yes"), "var(--critical)")}</div></div>
    <div class="kpi click" data-go="#/alerts?v=just"><div class="label"><span class="dot" style="background:var(--good)"></span>${term("justified", "Justified by a note")}</div>
      <div class="value" data-count="${fc["No (justified)"]}">0</div><div class="sub">each cites the exact note</div>
      <div class="spark">${monthBars(monthly("No (justified)"), "var(--good)")}</div></div>
    <div class="kpi click" data-go="#/alerts"><div class="label">${icon("check")} Review progress</div>
      <div class="value"><span data-count="${reviewed}">0</span><span style="font-size:18px;color:var(--muted)"> / ${yes.length}</span></div>
      <div class="sub">closed in this browser</div>
      <div class="progress" style="margin-top:14px"><i style="width:${yes.length ? (reviewed / yes.length) * 100 : 0}%;background:var(--good)"></i></div></div>
    <div class="kpi click" data-go="#/results"><div class="label">${icon("table")} Route-weeks analysed</div>
      <div class="value" data-count="${S.data.meta.route_weeks}">0</div><div class="sub">${S.data.data_quality.rows_used.toLocaleString()} shipments · ${S.data.data_quality.rows_quarantined} rejected</div></div>
    <div class="kpi click" data-go="${hd.worst ? `#/explorer/${encodeURIComponent(hd.worst.route)}/${hd.worst.week_of}` : "#/alerts"}"><div class="label">${icon("up")} Largest unexplained rise</div>
      <div class="value">${hd.worst ? pct(Math.max(hd.worst.own_pct, hd.worst.peer_pct)) : "—"}</div>
      <div class="sub">${hd.worst ? `${esc(hd.worst.route)} · ${niceDate(hd.worst.week_of)}` : ""}</div></div>
    <div class="kpi click" data-go="#/trust"><div class="label">${icon("shield")} LLM spend this run</div>
      <div class="value">$${tl.billable_api_calls.cost_usd.toFixed(4)}</div>
      <div class="sub">${tl.billable_api_calls.calls} API calls · ${tl.llm_enabled ? esc(tl.model) : "grounded templates"}</div></div>
  </div>

  <div class="card reveal" id="how">
    <div class="card-head"><div><h2>How Ferro decides</h2><p class="muted">The same four steps run for every route, every week. You can follow them for any alert.</p></div>
      <a class="btn ghost sm" href="#/whatif">${icon("flask")} Try other thresholds</a></div>
    <div class="steps">
      <div class="step"><div class="step-num">${icon("ruler")}</div><h3>1 · Measure</h3><p>Each Monday–Sunday week: total freight cost ÷ total tonne-km per route.</p></div>
      <div class="step"><div class="step-num">${icon("scale")}</div><h3>2 · Compare</h3><p>vs the route's own previous 8 weeks, and vs similar-length routes that same week.</p></div>
      <div class="step"><div class="step-num">${icon("alert")}</div><h3>3 · Flag</h3><p>More than <b>+${S.data.meta.thresholds.own_history_pct}%</b> above its own past, or <b>+${S.data.meta.thresholds.peer_pct}%</b> above similar routes while rising.</p></div>
      <div class="step"><div class="step-num">${icon("doc")}</div><h3>4 · Check notes</h3><p>A note justifies a rise only if the route, the dates, the cost effect and the size all match. Otherwise it stays flagged.</p></div>
    </div>
  </div>

  <div class="card reveal">
    <div class="card-head"><div><h2>Route health</h2><p class="muted">Last 26 weeks per route: cost (blue) against its own 8-week average (orange). Click a route to explore it.</p></div>
      <div class="legend"><span><i class="key" style="background:var(--s1)"></i>Cost / t-km</span><span><i class="key" style="background:var(--s2)"></i>8-wk average</span>
        <span><span class="dot" style="background:var(--critical)"></span>Unexplained</span><span><span class="dot" style="background:var(--good)"></span>Justified</span></div></div>
    <div class="health">${S.routes.map((route, i) => {
      const rs = S.byRoute[route], last = rs[rs.length - 1], st = routeStatus(route);
      const nYes = rs.filter((r) => r.flagged === "Yes").length, nJ = rs.filter((r) => r.flagged === "No (justified)").length;
      const yr = rs.slice(-52), chg = (last.cost_per_tonne_km / yr[0].cost_per_tonne_km - 1) * 100;
      return `<div class="hcard st-${st}" data-go="#/explorer/${encodeURIComponent(route)}" style="animation:rise .45s var(--ease) both;animation-delay:${i * 50}ms">
        <div class="hcard-top"><div><div class="rname">${esc(route)}</div><div class="rtype">${rs[0].route_type} haul</div></div>
          <span class="badge ${st === "review" ? "yes" : st === "explained" ? "just" : "no"}">${st === "review" ? icon("alert") : st === "explained" ? icon("check") : ""}${STATUS_LABEL[st]}</span></div>
        <div class="big">${rupee(last.cost_per_tonne_km)} <small>/ t-km latest</small></div>
        ${sparkline(rs.slice(-26))}
        <div class="meta"><span>12-mo <span class="${chg > 5 ? "delta-up" : chg < -5 ? "delta-down" : ""}">${pct(chg)}</span></span>
          <span>${nYes ? `<b style="color:var(--critical-ink)">${nYes}</b> unexplained` : ""}${nYes && nJ ? " · " : ""}${nJ ? `<b style="color:var(--good-ink)">${nJ}</b> justified` : ""}${!nYes && !nJ ? "no flags" : ""}</span></div>
      </div>`;
    }).join("")}</div>
  </div>

  <div class="card reveal">
    <div class="card-head"><div><h2 id="heat-title">Every week at a glance</h2>
      <p class="muted">Each cell is one route-week. Red means pricier than the comparison, blue cheaper. Dots mark flags. Hover for numbers, click to open the evidence.</p></div>
      <div class="seg" id="heat-metric"><button data-m="own_pct" class="${metric === "own_pct" ? "on" : ""}">vs own history</button><button data-m="peer_pct" class="${metric === "peer_pct" ? "on" : ""}">vs similar routes</button></div></div>
    <div id="heatmap" class="heatmap"></div>
    <div class="legend-row"><span>−30%</span><span class="grad"></span><span>+30% <span id="heat-unit">${metric === "own_pct" ? "vs own 8-week average" : "vs similar-route average"}</span></span>
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.2" fill="#fff" stroke="#0b0b0b"/></svg>Unexplained</span>
      <span><span class="dot" style="background:var(--good)"></span>Justified</span>
      <span class="muted">${infoI("creep")} Switch to “vs similar routes” to see the slow Mumbai-Pune creep.</span></div>
  </div>`;

  view.querySelectorAll("[data-count]").forEach((el) => countUp(el, +el.dataset.count));
  view.querySelectorAll("[data-go]").forEach((el) => el.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = el.dataset.go; }));
  const draw = (anim = true) => heatmap(view.querySelector("#heatmap"), { metric, animate: anim, onPick: (r) => app.openDrawer(r) });
  view.querySelectorAll("#heat-metric button").forEach((b) => b.addEventListener("click", () => {
    metric = b.dataset.m;
    view.querySelectorAll("#heat-metric button").forEach((x) => x.classList.toggle("on", x === b));
    view.querySelector("#heat-unit").textContent = metric === "own_pct" ? "vs own 8-week average" : "vs similar-route average";
    draw(true);
  }));
  requestAnimationFrame(() => draw(true));
  return { onResize: () => draw(false) };
}
