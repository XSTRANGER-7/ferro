// Shared helpers: DOM, formatting, icons, SVG, animation, tooltip.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function pct(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return "N/A";
  const r = +x.toFixed(digits);
  return (r === 0 ? "+0.0" : (r > 0 ? "+" : "") + r.toFixed(digits)) + "%";
}
export const rupee = (x, d = 2) => (x === null || x === undefined ? "—" : "₹" + x.toFixed(d));
export const int = (x) => Math.round(x).toLocaleString("en-IN");
export function niceDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
}
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekLabel(iso) { return `${niceDate(iso)} – ${niceDate(addDays(iso, 6))}`; }
export function niceTicks(lo, hi, n) {
  const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ------------------------------------------------------------------ icons (stroke, 24px grid)
const P = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  alert: '<path d="M12 3l9.5 16.5h-19z"/><path d="M12 10v4M12 17h.01"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10"/>',
  notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  flask: '<path d="M9 3h6M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  scale: '<path d="M12 4v16M5 20h14M5 8h14"/><path d="M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
  gavel: '<path d="M14 4l6 6M11 7l6 6M8.5 9.5l6 6M4 20l6-6"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
export const icon = (name, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;

// ------------------------------------------------------------------ verdict UI
export function badge(flag) {
  if (flag === "Yes") return `<span class="badge yes">${icon("alert")}Unexplained</span>`;
  if (flag === "No (justified)") return `<span class="badge just">${icon("check")}Justified</span>`;
  return `<span class="badge no">Normal</span>`;
}
export const noteChip = (id) => (id ? `<span class="note-chip" data-note="${esc(id)}" title="Open note ${esc(id)}">${esc(id)}</span>` : "");

// ------------------------------------------------------------------ svg
const NS = "http://www.w3.org/2000/svg";
export function svg(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
function hexToRgb(h) {
  if (h.startsWith("rgb")) return h.match(/\d+/g).slice(0, 3).map(Number);
  h = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return "rgb(" + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",") + ")";
}
export function diverging(v, lim = 30) {
  if (v === null || v === undefined) return css("--surface-2");
  const t = Math.max(-1, Math.min(1, v / lim));
  return t < 0 ? mix(css("--div-mid"), css("--div-neg"), -t) : mix(css("--div-mid"), css("--div-pos"), t);
}

// ------------------------------------------------------------------ animation
export function countUp(el, to, { decimals = 0, prefix = "", suffix = "", duration = 900 } = {}) {
  if (!el) return;
  const fmt = (v) => prefix + v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  if (reduceMotion()) { el.textContent = fmt(to); return; }
  const from = 0, t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / duration), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
export function drawPath(path, delay = 0) {
  if (reduceMotion()) return;
  const len = path.getTotalLength();
  path.style.strokeDasharray = len;
  path.style.strokeDashoffset = len;
  path.getBoundingClientRect();
  setTimeout(() => (path.style.strokeDashoffset = 0), delay);
  setTimeout(() => { path.style.strokeDasharray = ""; path.style.strokeDashoffset = ""; }, delay + 1400);
}

// ------------------------------------------------------------------ tooltip
const tip = () => document.getElementById("tooltip");
export function showTip(html, ev) {
  const t = tip();
  t.innerHTML = html;
  t.classList.add("show");
  const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
  t.style.left = x + "px";
  t.style.top = y + "px";
}
export const hideTip = () => tip().classList.remove("show");

// Plain-language glossary, shown on hover for any element with data-term="key".
export const GLOSSARY = {
  cpt: "Cost per tonne-km: the week's total freight bill divided by total tonnes × km moved. Lets short and long, light and heavy trips be compared fairly.",
  own: "vs own history: how this week compares with the average of the same route's previous 8 weeks (only weeks before this one, never after).",
  peer: "vs similar routes: how this week compares with the average of the other routes of the same length type (Short / Medium / Long) in the same week.",
  unexplained: "Unexplained: the cost rose past a threshold and no context note genuinely explains it. A person should review it.",
  justified: "Justified: the cost rose, but a context note covers this route and week and describes a real cost increase. The note id is cited.",
  trigger: "Trigger: which comparison raised the alarm. 'own' = sharp rise vs its own past; 'peer' = out of line with similar routes; 'both' = both.",
  gate: "Four checks a note must pass to justify a rise: right route (scope), right dates (window), actually describes a cost increase (effect), and big enough or relevant enough (magnitude).",
  creep: "Gradual creep: when cost rises slowly, its own 8-week average rises with it and hides the change. Comparing with similar routes exposes it.",
};
export function bindGlossary(root = document) {
  root.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-term]");
    if (t && GLOSSARY[t.dataset.term]) showTip(`<div style="max-width:300px">${esc(GLOSSARY[t.dataset.term])}</div>`, e);
  });
  root.addEventListener("mousemove", (e) => {
    const t = e.target.closest("[data-term]");
    if (t && GLOSSARY[t.dataset.term]) showTip(`<div style="max-width:300px">${esc(GLOSSARY[t.dataset.term])}</div>`, e);
  });
  root.addEventListener("mouseout", (e) => { if (e.target.closest("[data-term]")) hideTip(); });
}
export const term = (key, text) => `<span class="term" data-term="${key}">${text}</span>`;
export const infoI = (key) => `<i class="info-i" data-term="${key}">i</i>`;

// ------------------------------------------------------------------ markdown-lite
export function md(text) {
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split("\n");
  let html = "", list = null;
  for (const l of lines) {
    const ul = l.match(/^\s*- (.*)/), ol = l.match(/^\s*\d+\. (.*)/);
    const want = ul ? "ul" : ol ? "ol" : null;
    if (list && want !== list) { html += `</${list}>`; list = null; }
    if (want && !list) { html += `<${want}>`; list = want; }
    html += want ? `<li>${(ul || ol)[1]}</li>` : l.trim() ? `<p>${l}</p>` : "";
  }
  return html + (list ? `</${list}>` : "");
}

// ------------------------------------------------------------------ toast
export function toast(msg, ic = "check") {
  const host = document.getElementById("toasts");
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = icon(ic) + `<span>${esc(msg)}</span>`;
  host.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, 2600);
}

export function downloadText(name, text, type = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
