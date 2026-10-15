import { S } from "../store.js";
import { esc, pct, icon, badge, niceDate, debounce, countUp, term } from "../util.js";

export const title = "What-if lab";
const T = { own: null, peer: null };
const PRESETS = [["Strict", 10, 15], ["Balanced (current)", 15, 20], ["Relaxed", 20, 30], ["Spikes only", 15, 100]];

export function render(view, params, app) {
  const base = S.data.meta.thresholds;
  T.own ??= base.own_history_pct;
  T.peer ??= base.peer_pct;
  const fc0 = S.data.meta.flag_counts;
  view.innerHTML = `
    <div class="page-head reveal"><div><h1>What-if lab</h1>
      <p>Move the thresholds and Ferro re-runs the <b>real pipeline</b>, note checks included, then shows exactly which weeks would change. Use it to see how sensitive the alerts are, or to tune them for your team.</p></div></div>
    <div class="lab">
      <div class="card reveal">
        <h2 style="margin-bottom:16px">Thresholds</h2>
        <div class="slider-block"><div class="top"><span>${term("own", "Rise vs own 8-week average")}</span><span class="val" id="own-v"></span></div>
          <input type="range" id="own" min="5" max="50" step="0.5"><div class="ticks"><span>5%</span><span>← more alerts · fewer alerts →</span><span>50%</span></div></div>
        <div class="slider-block"><div class="top"><span>${term("peer", "Gap vs similar routes")}</span><span class="val" id="peer-v"></span></div>
          <input type="range" id="peer" min="5" max="100" step="0.5"><div class="ticks"><span>5%</span><span>← more alerts · fewer alerts →</span><span>off</span></div></div>
        <div class="field" style="margin-bottom:8px">Presets</div>
        <div class="chips" id="presets">${PRESETS.map(([l, o, p]) => `<button class="chip" data-o="${o}" data-p="${p}">${l}</button>`).join("")}</div>
        <div class="loading-bar" id="loading" style="margin-top:18px"></div>
        <p class="muted small" style="margin-top:12px">${icon("info")} Verdicts still require a note that passes all four checks. Changing thresholds only changes which weeks get checked.</p>
      </div>
      <div class="stack">
        <div class="card reveal">
          <div class="sim-kpis">
            <div class="sim-kpi"><div class="muted small">Unexplained</div><div class="v" id="k-yes">—</div><div class="d" id="d-yes"></div></div>
            <div class="sim-kpi"><div class="muted small">Justified by notes</div><div class="v" id="k-j">—</div><div class="d" id="d-j"></div></div>
            <div class="sim-kpi"><div class="muted small">Hand-labeled cases correct</div><div class="v" id="k-acc">—</div><div class="d muted" id="d-acc"></div></div>
          </div>
        </div>
        <div class="card reveal">
          <div class="card-head"><div><h2>What changes vs the current run</h2><p class="muted" id="chg-sub"></p></div></div>
          <div class="change-list" id="changes"></div>
        </div>
        <div class="card reveal">
          <div class="card-head"><div><h2>Flagged weeks by route under these settings</h2></div></div>
          <div id="by-route"></div>
        </div>
      </div>
    </div>`;

  const own = view.querySelector("#own"), peer = view.querySelector("#peer");
  const paint = () => {
    own.value = T.own; peer.value = T.peer;
    own.style.setProperty("--p", ((T.own - 5) / 45) * 100 + "%");
    peer.style.setProperty("--p", ((T.peer - 5) / 95) * 100 + "%");
    view.querySelector("#own-v").textContent = `+${(+T.own).toFixed(1)}%`;
    view.querySelector("#peer-v").textContent = T.peer >= 100 ? "off" : `+${(+T.peer).toFixed(1)}%`;
    view.querySelectorAll("#presets .chip").forEach((c) => c.classList.toggle("on", +c.dataset.o === +T.own && +c.dataset.p === +T.peer));
  };
  const delta = (el, now, was) => {
    const d = now - was;
    el.innerHTML = d === 0 ? `<span class="muted">same as now</span>` : `<span class="${d > 0 ? "delta-up" : "delta-down"}">${d > 0 ? "+" : ""}${d} vs now</span>`;
  };
  let seq = 0;
  const run = debounce(async () => {
    const my = ++seq;
    view.querySelector("#loading").classList.add("on");
    try {
      const r = await fetch(`/api/simulate?own=${T.own}&peer=${T.peer}`).then((x) => x.json());
      if (my !== seq) return;
      const fc = r.flag_counts;
      countUp(view.querySelector("#k-yes"), fc["Yes"], { duration: 450 });
      countUp(view.querySelector("#k-j"), fc["No (justified)"], { duration: 450 });
      delta(view.querySelector("#d-yes"), fc["Yes"], fc0["Yes"]);
      delta(view.querySelector("#d-j"), fc["No (justified)"], fc0["No (justified)"]);
      if (r.label_accuracy) {
        view.querySelector("#k-acc").textContent = `${r.label_accuracy.correct}/${r.label_accuracy.total}`;
        view.querySelector("#d-acc").textContent = r.label_accuracy.correct === r.label_accuracy.total ? "all hand labels still match" : "some hand labels no longer match";
      }
      view.querySelector("#chg-sub").textContent = r.changes.length ? `${r.changes.length} route-week${r.changes.length > 1 ? "s" : ""} would change verdict.` : "No verdict changes: same alerts as the current run.";
      view.querySelector("#changes").innerHTML = r.changes.length ? r.changes.map((c, i) => `
        <div class="change" data-k="${esc(c.route)}|${c.week_of}" style="animation-delay:${Math.min(i, 15) * 25}ms">
          <b style="min-width:150px">${esc(c.route)}</b><span class="muted" style="min-width:96px">${niceDate(c.week_of)}</span>
          ${badge(c.before)} <span class="muted">→</span> ${badge(c.after)}
          <span class="spacer"></span><span class="small muted tnum">${pct(c.own_pct)} own · ${pct(c.peer_pct)} peers</span></div>`).join("")
        : `<div class="muted" style="padding:16px;text-align:center">${icon("check")} Nothing changes.</div>`;
      const byRoute = {};
      r.flagged.forEach((f) => { (byRoute[f.route] ||= { y: 0, j: 0 }); f.flagged === "Yes" ? byRoute[f.route].y++ : byRoute[f.route].j++; });
      const max = Math.max(1, ...Object.values(byRoute).map((v) => v.y + v.j));
      view.querySelector("#by-route").innerHTML = S.routes.map((rt) => {
        const v = byRoute[rt] || { y: 0, j: 0 };
        return `<div class="row" style="margin-bottom:9px;flex-wrap:nowrap"><span style="width:170px;font-size:13px">${esc(rt)}</span>
          <div style="flex:1;display:flex;gap:2px;height:14px">${v.y ? `<i style="width:${(v.y / max) * 100}%;background:var(--critical);border-radius:4px 0 0 4px;transition:width .5s var(--ease)"></i>` : ""}
          ${v.j ? `<i style="width:${(v.j / max) * 100}%;background:var(--good);border-radius:0 4px 4px 0;${v.y ? "" : "border-radius:4px"}"></i>` : ""}</div>
          <span class="small tnum" style="width:120px;text-align:right">${v.y} <span class="muted">unexpl.</span> · ${v.j} <span class="muted">just.</span></span></div>`;
      }).join("");
    } finally {
      if (my === seq) view.querySelector("#loading").classList.remove("on");
    }
  }, 160);

  own.oninput = () => { T.own = +own.value; paint(); run(); };
  peer.oninput = () => { T.peer = +peer.value; paint(); run(); };
  view.querySelector("#presets").onclick = (e) => { const c = e.target.closest(".chip"); if (c) { T.own = +c.dataset.o; T.peer = +c.dataset.p; paint(); run(); } };
  view.querySelector("#changes").onclick = (e) => {
    const c = e.target.closest("[data-k]");
    if (c) app.openDrawer(S.byKey[c.dataset.k]);
  };
  paint();
  run();
}
