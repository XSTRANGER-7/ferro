// Ferro landing page: live data from the running pipeline, scroll-driven animation.
import { icon, svg, css, countUp, reduceMotion, toast, niceDate, pct, MONTHS } from "./util.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ------------------------------------------------------------------ icons
const CUSTOM = {
  spike: '<svg class="ic" viewBox="0 0 24 24"><path d="M3 17h4l2-3 3 7 3-16 2 12h4"/></svg>',
  creep: '<svg class="ic" viewBox="0 0 24 24"><path d="M3 18c4 0 5-2 8-3s5-4 10-9"/><path d="M3 20c5 0 8-1 18-6" opacity=".45"/></svg>',
  story: '<svg class="ic" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v3M12 13.5h.01"/></svg>',
};
$$("[data-ic]").forEach((el) => (el.outerHTML = CUSTOM[el.dataset.ic] || icon(el.dataset.ic)));

// ------------------------------------------------------------------ theme + nav
$("#theme-btn").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("ferro-theme", document.documentElement.dataset.theme); } catch (e) { /* ignore */ }
  redrawAll();
});
const nav = $("#lnav");
const onScroll = () => nav.classList.toggle("scrolled", scrollY > 8);
addEventListener("scroll", onScroll, { passive: true });
onScroll();
const sections = $$("main section[id]");
const navObs = new IntersectionObserver((ents) => ents.forEach((e) => {
  if (e.isIntersecting) $$(".lnav-links a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id));
}), { rootMargin: "-45% 0px -50% 0px" });
sections.forEach((s) => navObs.observe(s));
$("#to-top").addEventListener("click", (e) => { e.preventDefault(); scrollTo({ top: 0, behavior: "smooth" }); });

// ------------------------------------------------------------------ scroll reveal
const onView = (el, fn, threshold = 0.25) => {
  if (!el) return;
  const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { fn(e.target); io.unobserve(e.target); } }), { threshold });
  io.observe(el);
};
$$(".sr").forEach((el) => onView(el, (t) => t.classList.add("in"), 0.12));

// feature card spotlight
$$(".feat").forEach((f) => f.addEventListener("mousemove", (e) => {
  const r = f.getBoundingClientRect();
  f.style.setProperty("--mx", `${e.clientX - r.left}px`);
  f.style.setProperty("--my", `${e.clientY - r.top}px`);
}));

// copy command
$("#copy-cmd").addEventListener("click", () => {
  navigator.clipboard?.writeText($("#cmd").textContent).then(() => toast("Command copied", "copy"), () => toast("Copy failed", "x"));
});

// hero mock tilt
const stage = $("#mock-stage");
stage.addEventListener("mousemove", (e) => {
  if (reduceMotion()) return;
  const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  $("#mock").style.transform = `rotateY(${x * 8 - 2}deg) rotateX(${-y * 6 + 1}deg)`;
});
stage.addEventListener("mouseleave", () => ($("#mock").style.transform = ""));

// flow dot travelling along the pipeline
(() => {
  const dot = $(".flow-dot");
  if (!dot || reduceMotion()) return;
  let t0 = null, running = false;
  const tick = (t) => {
    if (!running) return;
    t0 ??= t;
    const p = ((t - t0) / 4200) % 1;
    dot.setAttribute("cx", (p * 1000).toFixed(1));
    dot.style.opacity = p < .04 ? p / .04 : p > .96 ? (1 - p) / .04 : 1;
    requestAnimationFrame(tick);
  };
  new IntersectionObserver(([e]) => { running = e.isIntersecting; if (running) requestAnimationFrame(tick); }).observe($("#flow"));
})();

// ------------------------------------------------------------------ data-driven visuals
let DATA = null;
const scaleFn = (rows, keys, W, H, pad) => {
  const vals = rows.flatMap((r) => keys.map((k) => r[k])).filter((v) => v !== null && v !== undefined);
  const lo = Math.min(...vals), hi = Math.max(...vals), sp = (hi - lo) || 1;
  return {
    x: (i) => pad.l + (i / Math.max(1, rows.length - 1)) * (W - pad.l - pad.r),
    y: (v) => pad.t + (1 - (v - lo + sp * .08) / (sp * 1.16)) * (H - pad.t - pad.b),
  };
};
const pathOf = (rows, k, s) => rows.map((r, i) => (r[k] === null ? "" : `${i && rows[i - 1][k] !== null ? "L" : "M"}${s.x(i).toFixed(1)},${s.y(r[k]).toFixed(1)}`)).join("");

function drawMock() {
  const host = $("#mock-chart");
  if (!DATA) return;
  const byRoute = {};
  DATA.rows.forEach((r) => (byRoute[r.route] ||= []).push(r));
  const counts = {};
  DATA.rows.filter((r) => r.flagged === "Yes").forEach((r) => (counts[r.route] = (counts[r.route] || 0) + 1));
  const route = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || Object.keys(byRoute)[0];
  const rows = byRoute[route].slice(-44), last = rows[rows.length - 1];
  const worst = rows.filter((r) => r.flagged === "Yes").sort((a, b) => b.peer_pct - a.peer_pct)[0] || last;
  $("#mock-title").textContent = `${route} · cost per tonne-km`;
  $("#mk-cost").textContent = "₹" + last.cost_per_tonne_km.toFixed(2);
  $("#mk-own").textContent = pct(last.own_pct);
  $("#mk-peer").textContent = pct(last.peer_pct);
  $("#fc-alert-text").textContent = `${route} · ${pct(worst.peer_pct)} vs similar routes, no note explains it`;
  const just = DATA.rows.find((r) => r.flagged === "No (justified)");
  if (just) $("#fc-just").querySelector("b").textContent = `Justified · ${just.matched_note_id}`, $("#fc-just").querySelector("span").textContent = `${just.route}, week of ${niceDate(just.week_of)}`;

  const W = 520, H = 210, s = scaleFn(rows, ["cost_per_tonne_km", "own_baseline", "peer_baseline"], W, H, { l: 4, r: 8, t: 10, b: 10 });
  host.innerHTML = "";
  host.classList.remove("drawn");
  const defs = svg("defs", {}, host);
  const lg = svg("linearGradient", { id: "mockFill", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  svg("stop", { offset: "0", "stop-color": css("--s1"), "stop-opacity": .22 }, lg);
  svg("stop", { offset: "1", "stop-color": css("--s1"), "stop-opacity": 0 }, lg);
  const sg = svg("linearGradient", { id: "scanG", x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
  svg("stop", { offset: "0", "stop-color": css("--accent"), "stop-opacity": 0 }, sg);
  svg("stop", { offset: "1", "stop-color": css("--accent"), "stop-opacity": .35 }, sg);
  [0.25, 0.5, 0.75].forEach((f) => svg("line", { x1: 0, x2: W, y1: H * f, y2: H * f, stroke: css("--grid"), "stroke-width": 1 }, host));
  svg("path", { d: `M${s.x(0)},${H} ` + rows.map((r, i) => `L${s.x(i).toFixed(1)},${s.y(r.cost_per_tonne_km).toFixed(1)}`).join(" ") + ` L${s.x(rows.length - 1)},${H} Z`, fill: "url(#mockFill)" }, host);
  svg("path", { d: pathOf(rows, "peer_baseline", s), class: "draw later", pathLength: 1000, fill: "none", stroke: css("--s3"), "stroke-width": 2, "stroke-linejoin": "round" }, host);
  svg("path", { d: pathOf(rows, "own_baseline", s), class: "draw late", pathLength: 1000, fill: "none", stroke: css("--s2"), "stroke-width": 2, "stroke-linejoin": "round" }, host);
  svg("path", { d: pathOf(rows, "cost_per_tonne_km", s), class: "draw", pathLength: 1000, fill: "none", stroke: css("--s1"), "stroke-width": 2.6, "stroke-linejoin": "round", "stroke-linecap": "round" }, host);
  svg("rect", { class: "scan", x: -60, y: 0, width: 60, height: H, fill: "url(#scanG)", style: `--scan-w:${W + 60}px` }, host);
  rows.forEach((r, i) => {
    if (r.flagged === "No") return;
    svg("circle", { class: "pop", cx: s.x(i), cy: s.y(r.cost_per_tonne_km), r: 5, fill: r.flagged === "Yes" ? css("--critical") : css("--good"),
      stroke: css("--surface"), "stroke-width": 2, style: `animation-delay:${1.3 + (i / rows.length) * 1.4}s` }, host);
  });
  requestAnimationFrame(() => host.classList.add("drawn"));
}

function drawCreep(animate = true) {
  const host = $("#creep-chart");
  if (!DATA) return;
  const rows = DATA.rows.filter((r) => r.route === "Mumbai-Pune" && r.week_of >= "2025-04-01");
  if (!rows.length) return;
  const yes = rows.filter((r) => r.flagged === "Yes");
  if (yes.length) {
    const own = yes.map((r) => r.own_pct), peer = yes.map((r) => r.peer_pct);
    $("#creep-own").textContent = `+${Math.min(...own).toFixed(0)}–${Math.max(...own).toFixed(0)}%`;
    $("#creep-peer").textContent = `+${Math.min(...peer).toFixed(0)}–${Math.max(...peer).toFixed(0)}%`;
  }
  const W = 560, H = 260, pad = { l: 40, r: 120, t: 14, b: 26 };
  const s = scaleFn(rows, ["cost_per_tonne_km", "own_baseline", "peer_baseline"], W, H, pad);
  host.innerHTML = "";
  host.classList.remove("drawn");
  const vals = rows.flatMap((r) => [r.cost_per_tonne_km, r.peer_baseline]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  [lo, (lo + hi) / 2, hi].forEach((v) => {
    svg("line", { x1: pad.l, x2: W - pad.r, y1: s.y(v), y2: s.y(v), stroke: css("--grid") }, host);
    svg("text", { x: pad.l - 6, y: s.y(v) + 4, "text-anchor": "end" }, host).textContent = "₹" + v.toFixed(2);
  });
  rows.forEach((r, i) => {
    if (r.week_of.slice(8) <= "07" && i % 1 === 0) svg("text", { x: s.x(i), y: H - 6, "text-anchor": "middle" }, host).textContent = MONTHS[+r.week_of.slice(5, 7) - 1];
  });
  const lastI = rows.length - 1, last = rows[lastI];
  // gap highlight between route and peers at the end
  svg("path", { class: "pop", d: `M${s.x(lastI) + 8},${s.y(last.cost_per_tonne_km)} L${s.x(lastI) + 8},${s.y(last.peer_baseline)}`,
    stroke: css("--critical"), "stroke-width": 2.5, "stroke-dasharray": "3 3", style: "animation-delay:2.1s" }, host);
  svg("path", { d: pathOf(rows, "peer_baseline", s), class: "draw later", pathLength: 1000, fill: "none", stroke: css("--s3"), "stroke-width": 2.2 }, host);
  svg("path", { d: pathOf(rows, "own_baseline", s), class: "draw late", pathLength: 1000, fill: "none", stroke: css("--s2"), "stroke-width": 2.2 }, host);
  svg("path", { d: pathOf(rows, "cost_per_tonne_km", s), class: "draw", pathLength: 1000, fill: "none", stroke: css("--s1"), "stroke-width": 2.8, "stroke-linecap": "round", "stroke-linejoin": "round" }, host);
  rows.forEach((r, i) => {
    if (r.flagged !== "Yes") return;
    svg("circle", { class: "pop", cx: s.x(i), cy: s.y(r.cost_per_tonne_km), r: 4.5, fill: css("--critical"), stroke: css("--surface"), "stroke-width": 2, style: `animation-delay:${.9 + (i / rows.length) * 1.3}s` }, host);
  });
  const lab = (y, txt, color, d) => {
    const t = svg("text", { class: "pop", x: s.x(lastI) + 16, y, style: `font-size:12px;font-weight:700;fill:${color};animation-delay:${d}s` }, host);
    t.textContent = txt;
  };
  lab(s.y(last.own_baseline) + 4, `own avg ${pct(last.own_pct)}`, css("--s2"), 2.2);
  lab((s.y(last.cost_per_tonne_km) + s.y(last.peer_baseline)) / 2 + 4, `${pct(last.peer_pct)} vs peers`, css("--critical-ink"), 2.4);
  lab(s.y(last.peer_baseline) + 14, "similar routes", css("--s3"), 2.3);
  if (animate) onView(host, (h) => h.classList.add("drawn"), .35); else host.classList.add("drawn");
}

let trapTimer = null;
function drawTrap(animate = true) {
  const host = $("#trap-chart");
  if (!DATA) return;
  const rows = DATA.rows.filter((r) => r.route === "Chennai-Bangalore" && r.week_of >= "2025-01-27" && r.week_of <= "2025-04-07");
  const n1 = DATA.notes.find((n) => n.note_id === "N001"), n9 = DATA.notes.find((n) => n.note_id === "N009");
  if (!rows.length || !n1) return;
  const W = 560, H = 360, pad = { l: 12, r: 12, t: 74, b: 40 };
  const hi = Math.max(...rows.map((r) => r.cost_per_tonne_km)) * 1.08, lo = 0;
  const bw = (W - pad.l - pad.r) / rows.length;
  const x = (i) => pad.l + i * bw, y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const xd = (iso) => { const i = rows.findIndex((r) => r.week_of > iso); const base = i < 0 ? rows.length : i - 1; const r0 = rows[Math.max(0, base)]; const frac = (Date.parse(iso) - Date.parse(r0.week_of)) / (7 * 864e5); return x(Math.max(0, base)) + frac * bw; };
  host.innerHTML = "";
  // note windows
  const band = (n, ok, txt, lane = 0) => {
    const x0 = xd(n.window_start), x1 = xd(addOne(n.window_end));
    svg("rect", { x: x0, y: pad.t - 18, width: x1 - x0, height: H - pad.t - pad.b + 18, rx: 8, fill: ok ? css("--band") : css("--band-no"),
      stroke: ok ? css("--good") : css("--axis"), "stroke-dasharray": ok ? "" : "4 4" }, host);
    const t = svg("text", { x: x0 + 2, y: pad.t - 24 - lane * 15, style: `font-size:11.5px;font-weight:700;fill:${ok ? css("--good-ink") : css("--muted")}` }, host);
    t.textContent = txt;
  };
  band(n1, true, "N001 · flood window, Feb 24 – Mar 8", 1);
  if (n9) band(n9, false, "N009 · “returned to normal”", 0);
  // baseline (avg of the quiet weeks before)
  const quiet = rows.filter((r) => r.week_of < "2025-02-24");
  const base = quiet.reduce((a, r) => a + r.cost_per_tonne_km, 0) / quiet.length;
  svg("line", { x1: pad.l, x2: W - pad.r, y1: y(base), y2: y(base), stroke: css("--s2"), "stroke-width": 1.6, "stroke-dasharray": "5 4" }, host);
  svg("text", { x: W - pad.r, y: y(base) - 6, "text-anchor": "end", style: `fill:${css("--s2")};font-weight:600` }, host).textContent = `usual ≈ ₹${base.toFixed(2)}`;
  svg("line", { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), stroke: css("--axis") }, host);
  const order = ["2025-02-24", "2025-03-03", "2025-03-10", "2025-03-17"];
  const bars = rows.map((r, i) => {
    const b = svg("rect", { class: "bar", x: x(i) + bw * .18, width: bw * .64, rx: 5, y: y(0), height: 0, fill: css("--surface-3") }, host);
    svg("text", { x: x(i) + bw / 2, y: H - pad.b + 16, "text-anchor": "middle" }, host).textContent = `${+r.week_of.slice(8)} ${MONTHS[+r.week_of.slice(5, 7) - 1]}`;
    const k = order.indexOf(r.week_of);
    let label = null;
    if (k >= 0) {
      label = svg("text", { class: "vlabel", x: x(i) + bw / 2, y: y(r.cost_per_tonne_km) - 10, "text-anchor": "middle",
        style: `font-size:12px;font-weight:800;fill:${r.flagged === "Yes" ? css("--critical-ink") : css("--good-ink")}` }, host);
      label.textContent = r.flagged === "Yes" ? "▲" : "✓";
    }
    return { r, b, k, label };
  });

  const grow = () => bars.forEach(({ r, b }, i) => setTimeout(() => {
    b.setAttribute("y", y(r.cost_per_tonne_km)); b.setAttribute("height", y(0) - y(r.cost_per_tonne_km));
    b.setAttribute("fill", r.week_of >= "2025-02-24" && r.week_of <= "2025-03-17" ? css("--axis") : css("--s1"));
    b.setAttribute("opacity", r.week_of >= "2025-02-24" && r.week_of <= "2025-03-17" ? 1 : .55);
  }, animate ? i * 70 : 0));
  const reveal = (k) => {
    bars.filter((x) => x.k === k).forEach(({ r, b, label }) => { b.setAttribute("fill", r.flagged === "Yes" ? css("--critical") : css("--good")); label?.classList.add("on"); });
    $$("#trap-steps li").forEach((li) => li.classList.toggle("on", +li.dataset.k <= k));
  };
  const play = () => {
    clearTimeout(trapTimer);
    $$("#trap-steps li").forEach((li) => li.classList.remove("on"));
    bars.forEach(({ b, label }) => { label?.classList.remove("on"); });
    grow();
    let k = 0;
    const step = () => { reveal(k); k++; if (k < 4) trapTimer = setTimeout(step, 1100); };
    trapTimer = setTimeout(step, animate ? 1000 : 0);
  };
  host.style.cursor = "pointer";
  host.onclick = play;
  if (animate) onView(host, play, .4); else { grow(); [0, 1, 2, 3].forEach(reveal); }
}
const addOne = (iso) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

function redrawAll() { drawMock(); drawCreep(false); drawTrap(false); }

// ------------------------------------------------------------------ numbers
function setStats(meta, trust) {
  const stats = {
    route_weeks: meta?.route_weeks ?? 728, yes: meta?.flag_counts?.Yes ?? 16, justified: meta?.flag_counts?.["No (justified)"] ?? 3,
    fabricated: trust?.eval?.suites?.find((s) => s.suite === "hallucination_audit")?.fabricated ?? 0,
  };
  $$("[data-stat]").forEach((el) => countUp(el, stats[el.dataset.stat], { duration: 1400 }));
  if (trust?.eval) {
    trust.eval.suites.forEach((s) => {
      const n = $(`[data-num="${s.suite}"]`), d = $(`[data-den="${s.suite}"]`);
      if (n) n.textContent = s.passed;
      if (d) d.textContent = s.total;
    });
    const runs = trust.repro?.identical ? `${trust.repro.runs}×` : "3×";
    $('[data-plain="runs"]').textContent = runs;
    $('[data-plain="cost"]').textContent = "$" + (trust.token_log?.billable_api_calls?.cost_usd ?? 0).toFixed(trust.token_log?.billable_api_calls?.cost_usd ? 4 : 0);
  }
  $$(".num").forEach((card) => onView(card, () => {
    card.querySelectorAll("[data-num]").forEach((el) => countUp(el, +el.textContent, { duration: 1100 }));
  }, .5));
}

(async () => {
  let trust = null;
  try {
    DATA = await fetch("/api/bootstrap").then((r) => r.json());
    trust = await fetch("/api/trust").then((r) => r.json()).catch(() => null);
  } catch (e) {
    DATA = null;   // static fallback numbers stay in place
  }
  setStats(DATA?.meta, trust);
  drawMock();
  drawCreep(true);
  drawTrap(!reduceMotion());
})();
let rT;
addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { drawCreep(false); }, 200); });
