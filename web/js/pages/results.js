import { S } from "../store.js";
import { esc, pct, icon, badge, noteChip, niceDate, downloadText, csvCell, toast, term, debounce } from "../util.js";

export const title = "All results";
const F = { q: "", route: "", flag: "", sort: { k: "week_of", dir: -1 }, page: 0, size: 50 };

function pctCell(v, lim = 40) {
  if (v === null) return `<span class="muted">N/A</span>`;
  const w = Math.min(50, (Math.abs(v) / lim) * 50);
  const color = v > 0 ? "var(--div-pos)" : "var(--div-neg)";
  return `<span class="pct-cell"><span class="${v > 15 ? "delta-up" : ""}">${pct(v)}</span><span class="mini"><i style="${v >= 0 ? `left:50%` : `left:${50 - w}%`};width:${w}%;background:${color}"></i></span></span>`;
}

export function render(view, params, app) {
  if (params.query.flag) F.flag = params.query.flag;
  if (params.query.route) F.route = params.query.route;
  view.innerHTML = `
    <div class="page-head reveal"><div><h1>All results</h1>
      <p>Every route-week in the exact output format (<span class="mono">results.csv</span>). Search by route, date, note id or any word in the reason, then click a row for its full story.</p></div>
      <div class="row"><a class="btn" href="/download/results.csv">${icon("download")} results.csv</a>
        <a class="btn ghost" href="/download/flagged_results.csv">${icon("download")} flagged only</a>
        <button class="btn ghost" id="dl-view">${icon("download")} This view</button></div></div>
    <div class="toolbar reveal">
      <div class="search-box">${icon("search")}<input type="search" id="q" placeholder="Search: N001, 2025-03, flood, Mumbai…" value="${esc(F.q)}"></div>
      <label class="field">Route<select id="route"><option value="">All routes</option>${S.routes.map((r) => `<option ${r === F.route ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></label>
      <div class="seg" id="flag"><button data-f="">All</button><button data-f="Yes">Unexplained</button><button data-f="No (justified)">Justified</button><button data-f="No">Normal</button></div>
    </div>
    <div class="card table-card reveal">
      <div class="table-wrap"><table class="data-table"><thead><tr>
        <th data-k="route">Route<span class="arr">↕</span></th><th data-k="week_of">Week of<span class="arr">↕</span></th>
        <th data-k="cost_per_tonne_km" class="num">${term("cpt", "₹ / t-km")}<span class="arr">↕</span></th>
        <th data-k="own_pct" class="num">${term("own", "vs own history")}<span class="arr">↕</span></th>
        <th data-k="peer_pct" class="num">${term("peer", "vs similar routes")}<span class="arr">↕</span></th>
        <th data-k="flagged">Flagged<span class="arr">↕</span></th><th data-k="matched_note_id">Note<span class="arr">↕</span></th><th>Reason</th>
      </tr></thead><tbody id="tb"></tbody></table></div>
      <div class="table-foot"><span id="count"></span><div class="pager" id="pager"></div></div>
    </div>`;

  const tb = view.querySelector("#tb");
  const filtered = () => {
    const q = F.q.trim().toLowerCase(), { k, dir } = F.sort;
    return S.rows.filter((r) => (!F.route || r.route === F.route) && (!F.flag || r.flagged === F.flag) &&
      (!q || `${r.route} ${r.week_of} ${r.matched_note_id} ${r.reason} ${r.flagged}`.toLowerCase().includes(q)))
      .sort((a, b) => { const A = a[k] ?? -1e9, B = b[k] ?? -1e9; return (A > B ? 1 : A < B ? -1 : 0) * dir || a.route.localeCompare(b.route); });
  };
  function draw() {
    const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / F.size));
    F.page = Math.min(F.page, pages - 1);
    const slice = rows.slice(F.page * F.size, (F.page + 1) * F.size);
    tb.innerHTML = slice.map((r) => `<tr data-k="${esc(r.route)}|${r.week_of}">
      <td><b style="font-weight:600">${esc(r.route)}</b></td><td class="tnum">${niceDate(r.week_of)}</td><td class="num">${r.cost_per_tonne_km.toFixed(2)}</td>
      <td class="num">${pctCell(r.own_pct)}</td><td class="num">${pctCell(r.peer_pct)}</td><td>${badge(r.flagged)}</td><td>${noteChip(r.matched_note_id)}</td>
      <td class="reason"><div>${esc(r.reason)}</div></td></tr>`).join("") ||
      `<tr><td colspan="8" style="text-align:center;padding:40px" class="muted">No route-weeks match.</td></tr>`;
    view.querySelector("#count").textContent = `${rows.length.toLocaleString()} of ${S.rows.length} route-weeks · page ${F.page + 1} of ${pages}`;
    const pg = view.querySelector("#pager");
    pg.innerHTML = `<button class="icon-btn" data-p="${F.page - 1}" ${F.page ? "" : "disabled"}>${icon("left")}</button>` +
      Array.from({ length: pages }, (_, i) => i).filter((i) => pages <= 7 || Math.abs(i - F.page) <= 2 || i === 0 || i === pages - 1)
        .map((i, j, arr) => (j && i - arr[j - 1] > 1 ? `<span class="muted">…</span>` : "") +
          `<button class="btn ${i === F.page ? "" : "ghost"} sm" data-p="${i}">${i + 1}</button>`).join("") +
      `<button class="icon-btn" data-p="${F.page + 1}" ${F.page < pages - 1 ? "" : "disabled"}>${icon("right")}</button>`;
    view.querySelectorAll("th[data-k]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.k === F.sort.k);
      th.querySelector(".arr").textContent = th.dataset.k === F.sort.k ? (F.sort.dir > 0 ? "↑" : "↓") : "↕";
    });
    view.querySelectorAll("#flag button").forEach((b) => b.classList.toggle("on", b.dataset.f === F.flag));
  }
  view.querySelector("#q").addEventListener("input", debounce((e) => { F.q = e.target.value; F.page = 0; draw(); }, 120));
  view.querySelector("#route").onchange = (e) => { F.route = e.target.value; F.page = 0; draw(); };
  view.querySelector("#flag").onclick = (e) => { const b = e.target.closest("button"); if (b) { F.flag = b.dataset.f; F.page = 0; draw(); } };
  view.querySelector("#pager").onclick = (e) => { const b = e.target.closest("[data-p]"); if (b && !b.disabled) { F.page = +b.dataset.p; draw(); view.querySelector(".table-wrap").scrollTop = 0; } };
  view.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", (e) => {
    if (e.target.closest("[data-term]")) return;
    F.sort = { k: th.dataset.k, dir: F.sort.k === th.dataset.k ? -F.sort.dir : 1 }; draw();
  }));
  tb.addEventListener("click", (e) => { const tr = e.target.closest("tr[data-k]"); if (tr && !e.target.closest(".note-chip")) app.openDrawer(S.byKey[tr.dataset.k]); });
  view.querySelector("#dl-view").onclick = () => {
    const cols = ["route", "week_of", "cost_per_tonne_km", "vs_own_history", "vs_similar_routes", "flagged", "matched_note_id", "reason"];
    downloadText("ferro_view.csv", [cols.join(",")].concat(filtered().map((r) =>
      cols.map((c) => csvCell(c === "cost_per_tonne_km" ? r[c].toFixed(2) : r[c])).join(","))).join("\n"));
    toast("Filtered view downloaded", "download");
  };
  draw();
}
