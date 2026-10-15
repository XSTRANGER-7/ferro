// Ferro app shell: router, navigation, drawer, command palette, shortcuts, theme.
import { S, load, review, unexplained } from "./store.js";
import { $, $$, esc, icon, niceDate, toast, bindGlossary, hideTip, pct, debounce, weekLabel, badge } from "./util.js";
import { renderDetail } from "./detail.js";
import * as overview from "./pages/overview.js";
import * as alerts from "./pages/alerts.js";
import * as explorer from "./pages/explorer.js";
import * as results from "./pages/results.js";
import * as notes from "./pages/notes.js";
import * as whatif from "./pages/whatif.js";
import * as ask from "./pages/ask.js";
import * as trust from "./pages/trust.js";

const PAGES = {
  overview: { mod: overview, label: "Overview", ic: "home", group: "Monitor" },
  alerts: { mod: alerts, label: "Review queue", ic: "alert", group: "Monitor" },
  explorer: { mod: explorer, label: "Route explorer", ic: "route", group: "Monitor" },
  results: { mod: results, label: "All results", ic: "table", group: "Monitor" },
  notes: { mod: notes, label: "Notes & evidence", ic: "notes", group: "Understand" },
  whatif: { mod: whatif, label: "What-if lab", ic: "flask", group: "Understand" },
  ask: { mod: ask, label: "Ask the assistant", ic: "chat", group: "Understand" },
  trust: { mod: trust, label: "Trust & eval", ic: "shield", group: "Verify" },
};
let current = null, currentName = null;

// ------------------------------------------------------------------ app api for pages
const app = {
  openDrawer, toast,
  setCrumb(items) {
    $("#crumbs").innerHTML = items.map(([t, href], i) =>
      (i ? `<span>/</span>` : "") + (href && i < items.length - 1 ? `<a href="${href}">${esc(t)}</a>` : i === items.length - 1 ? `<b>${esc(t)}</b>` : esc(t))).join("");
  },
};

// ------------------------------------------------------------------ nav
function renderNav() {
  const open = unexplained().filter((r) => ["open", "investigating"].includes(review(r).status)).length;
  let group = "";
  $("#nav").innerHTML = Object.entries(PAGES).map(([k, p]) => {
    const head = p.group !== group ? `<div class="nav-label">${(group = p.group)}</div>` : "";
    const count = k === "alerts" && open ? `<span class="count">${open}</span>` : k === "notes" ? `<span class="count soft">${Object.keys(S.notes).length}</span>` : "";
    return `${head}<a href="#/${k}" data-page="${k}" class="${k === currentName ? "active" : ""}">${icon(p.ic)}<span>${p.label}</span>${count}</a>`;
  }).join("");
}

// ------------------------------------------------------------------ router
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs = ""] = raw.split("?");
  const segs = path.split("/").filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(qs));
  const name = PAGES[segs[0]] ? segs[0] : "overview";
  return { name, parts: segs.slice(1), query };
}
async function route() {
  const { name, parts, query } = parseHash();
  hideTip();
  closeDrawer();
  $("#sidebar").classList.remove("on");
  if (current?.destroy) current.destroy();
  currentName = name;
  renderNav();
  app.setCrumb([["Ferro", "#/overview"], [PAGES[name].label, null]]);
  document.title = `${PAGES[name].label} · Ferro`;
  const view = $("#view");
  view.classList.remove("enter");
  void view.offsetWidth;
  view.classList.add("enter");
  window.scrollTo({ top: 0 });
  current = (await PAGES[name].mod.render(view, { parts, query }, app)) || {};
}

// ------------------------------------------------------------------ drawer
function openDrawer(r) {
  if (!r) return;
  $("#drawer-title").innerHTML = `<div class="row" style="gap:8px"><b style="font-size:15px">${esc(r.route)}</b>
    <span class="muted">${weekLabel(r.week_of)}</span>${badge(r.flagged)}
    <span class="spacer"></span><a class="btn ghost sm" href="#/explorer/${encodeURIComponent(r.route)}/${r.week_of}">${icon("route")} Open in explorer</a></div>`;
  renderDetail($("#drawer-body"), r, { header: false, onReview: renderNav });
  $("#drawer").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("on");
  $("#drawer-body").scrollTop = 0;
}
function closeDrawer() {
  $("#drawer").classList.remove("on");
  $("#drawer").setAttribute("aria-hidden", "true");
  if (!$("#palette").classList.contains("on")) $("#scrim").classList.remove("on");
}
function openHelp() {
  $("#drawer-title").innerHTML = `<b style="font-size:15px">Help &amp; shortcuts</b>`;
  $("#drawer-body").innerHTML = `
    <div class="card"><h2 style="margin-bottom:12px">Keyboard shortcuts</h2><div class="help-grid">
      <span><kbd>Ctrl</kbd> <kbd>K</kbd> or <kbd>/</kbd></span><span>Search pages, routes, flagged weeks and notes</span>
      <span><kbd>←</kbd> <kbd>→</kbd></span><span>Previous / next week in the route explorer (hold <kbd>Shift</kbd> to jump between flags)</span>
      <span><kbd>Esc</kbd></span><span>Close drawer or search</span>
      <span><kbd>?</kbd></span><span>This help</span>
      <span><kbd>g</kbd> then <kbd>o</kbd>/<kbd>r</kbd>/<kbd>e</kbd>/<kbd>a</kbd>/<kbd>n</kbd>/<kbd>w</kbd>/<kbd>t</kbd></span><span>Go to Overview, Review, Explorer, Results, Notes, What-if, Trust</span></div></div>
    <div class="card"><h2 style="margin-bottom:10px">Reading the dashboard</h2>
      <p style="margin-bottom:8px"><span class="badge yes">${icon("alert")}Unexplained</span> The cost rose past a threshold and no note genuinely explains it. Review it.</p>
      <p style="margin-bottom:8px"><span class="badge just">${icon("check")}Justified</span> The cost rose, but a note covers that route and week and describes a real cost increase.</p>
      <p style="margin-bottom:8px"><span class="badge no">Normal</span> Within normal range. Nothing to do.</p>
      <p class="muted">Dashed underlines are glossary terms: hover them for a plain-English definition.</p></div>`;
  $("#drawer").classList.add("on");
  $("#scrim").classList.add("on");
}

// ------------------------------------------------------------------ command palette
let pItems = [], pSel = 0;
function paletteItems() {
  const items = [];
  Object.entries(PAGES).forEach(([k, p]) => items.push({ g: "Pages", ic: p.ic, label: p.label, sub: "Go", run: () => (location.hash = "#/" + k) }));
  S.routes.forEach((r) => items.push({ g: "Routes", ic: "route", label: r, sub: S.byRoute[r][0].route_type, run: () => (location.hash = "#/explorer/" + encodeURIComponent(r)) }));
  S.rows.filter((r) => r.flagged !== "No").forEach((r) => items.push({ g: "Flagged weeks", ic: r.flagged === "Yes" ? "alert" : "check",
    label: `${r.route} · ${niceDate(r.week_of)}`, sub: `${r.flagged === "Yes" ? "Unexplained" : "Justified " + r.matched_note_id} · ${pct(Math.max(r.own_pct, r.peer_pct ?? -1e9))}`,
    extra: `${r.week_of} ${r.matched_note_id} ${r.flagged}`, run: () => openDrawer(r) }));
  Object.values(S.notes).forEach((n) => items.push({ g: "Notes", ic: "doc", label: `${n.note_id} · ${n.applies_to}`, sub: n.can_justify ? "Can justify" : "Decoy",
    extra: n.text, run: () => (location.hash = "#/notes/" + n.note_id) }));
  items.push({ g: "Actions", ic: "download", label: "Download results.csv", sub: "Action", run: () => (location.href = "/download/results.csv") });
  items.push({ g: "Actions", ic: "spark", label: "Toggle dark / light theme", sub: "Action", run: () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark") });
  items.push({ g: "Actions", ic: "info", label: "Keyboard shortcuts & help", sub: "Action", run: openHelp });
  return items;
}
function drawPalette() {
  const q = $("#palette-input").value.trim().toLowerCase(), toks = q.split(/\s+/).filter(Boolean);
  pItems = paletteItems().filter((it) => toks.every((t) => `${it.label} ${it.sub} ${it.g} ${it.extra || ""}`.toLowerCase().includes(t)));
  if (q) pItems.push({ g: "Ask", ic: "chat", label: `Ask: “${$("#palette-input").value.trim()}”`, sub: "Assistant", run: () => (location.hash = "#/ask?q=" + encodeURIComponent($("#palette-input").value.trim())) });
  pItems = pItems.slice(0, 60);
  pSel = Math.min(pSel, pItems.length - 1);
  let g = "";
  $("#palette-list").innerHTML = pItems.map((it, i) => (it.g !== g ? `<div class="p-group">${(g = it.g)}</div>` : "") +
    `<div class="p-item ${i === pSel ? "sel" : ""}" data-i="${i}">${icon(it.ic)}<span>${esc(it.label)}</span><span class="sub">${esc(it.sub)}</span></div>`).join("") ||
    `<div class="muted" style="padding:20px;text-align:center">No matches</div>`;
  $(".p-item.sel")?.scrollIntoView({ block: "nearest" });
}
function openPalette() {
  $("#palette").classList.add("on");
  $("#scrim").classList.add("on");
  $("#palette-input").value = "";
  pSel = 0;
  drawPalette();
  setTimeout(() => $("#palette-input").focus(), 30);
}
function closePalette() {
  $("#palette").classList.remove("on");
  if (!$("#drawer").classList.contains("on")) $("#scrim").classList.remove("on");
}
function runPalette(i) {
  const it = pItems[i];
  if (!it) return;
  closePalette();
  it.run();
}

// ------------------------------------------------------------------ theme
function setTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { t === "auto" ? localStorage.removeItem("ferro-theme") : localStorage.setItem("ferro-theme", t); } catch (e) { /* ignore */ }
  $$("#theme-switch button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  current?.onResize?.();
}

// ------------------------------------------------------------------ boot
function bindChrome() {
  $("#theme-switch").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setTheme(b.dataset.t); });
  const t = document.documentElement.dataset.theme || "auto";
  $$("#theme-switch button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  $("#open-palette").onclick = openPalette;
  $("#help-btn").onclick = openHelp;
  $("#menu-btn").onclick = () => $("#sidebar").classList.toggle("on");
  $("#drawer-close").onclick = closeDrawer;
  $("#scrim").onclick = () => { closeDrawer(); closePalette(); };
  $("#palette-input").addEventListener("input", () => { pSel = 0; drawPalette(); });
  $("#palette-list").addEventListener("click", (e) => { const it = e.target.closest(".p-item"); if (it) runPalette(+it.dataset.i); });
  $("#palette-list").addEventListener("mousemove", (e) => {
    const it = e.target.closest(".p-item");
    if (it && +it.dataset.i !== pSel) { pSel = +it.dataset.i; $$(".p-item").forEach((x) => x.classList.toggle("sel", +x.dataset.i === pSel)); }
  });
  // global: note chips open the note
  document.addEventListener("click", (e) => {
    const n = e.target.closest("[data-note]");
    if (n && !e.target.closest(".palette")) { e.preventDefault(); location.hash = "#/notes/" + n.dataset.note; }
  });
  let gPending = false;
  addEventListener("keydown", (e) => {
    const typing = e.target.closest("input,textarea,select");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); return $("#palette").classList.contains("on") ? closePalette() : openPalette(); }
    if ($("#palette").classList.contains("on")) {
      if (e.key === "Escape") return closePalette();
      if (e.key === "ArrowDown") { e.preventDefault(); pSel = Math.min(pItems.length - 1, pSel + 1); drawPalette(); }
      if (e.key === "ArrowUp") { e.preventDefault(); pSel = Math.max(0, pSel - 1); drawPalette(); }
      if (e.key === "Enter") { e.preventDefault(); runPalette(pSel); }
      return;
    }
    if (e.key === "Escape") return closeDrawer();
    if (typing) return;
    if (e.key === "/") { e.preventDefault(); return openPalette(); }
    if (e.key === "?") return openHelp();
    if (e.key === "g") { gPending = true; setTimeout(() => (gPending = false), 900); return; }
    if (gPending) {
      const map = { o: "overview", r: "alerts", e: "explorer", a: "results", n: "notes", w: "whatif", t: "trust", q: "ask" };
      if (map[e.key]) location.hash = "#/" + map[e.key];
      gPending = false;
    }
  });
  addEventListener("resize", debounce(() => current?.onResize?.(), 150));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!document.documentElement.dataset.theme) current?.onResize?.(); });
  bindGlossary(document);
}

async function boot() {
  bindChrome();
  try {
    await load();
  } catch (e) {
    $("#view").innerHTML = `<div class="card" style="text-align:center;padding:48px"><h2>Couldn't load the run</h2><p class="muted" style="margin-top:6px">${esc(e.message)}. Is <span class="mono">python -m ferro serve</span> running?</p></div>`;
    return;
  }
  const m = S.data.meta, tl = S.data.token_log;
  $("#run-meta").innerHTML = `${niceDate(m.first_week)} → ${niceDate(m.last_week)}<br>input <span class="mono">${m.input_fingerprint.slice(0, 12)}</span>`;
  $("#llm-badge").innerHTML = tl.llm_enabled ? `${icon("spark")} LLM: ${esc(tl.model)} · T=0` : `${icon("shield")} Grounded templates · no LLM`;
  // legacy links (#explorer/...) → new router form
  if (location.hash && !location.hash.startsWith("#/")) location.replace("#/" + location.hash.slice(1));
  addEventListener("hashchange", route);
  addEventListener("storage", renderNav);
  document.addEventListener("click", (e) => { if (e.target.closest("[data-review] button")) setTimeout(renderNav, 0); });
  route();
}
boot();
