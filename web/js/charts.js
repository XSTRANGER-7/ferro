// Hand-rolled SVG charts. Data colours: --s1 cost, --s2 own baseline, --s3 peer average;
// status colours (critical/good) for verdicts, always paired with an icon or label.
import { S, notesForRoute } from "./store.js";
import { svg, css, esc, pct, rupee, MONTHS, addDays, niceTicks, diverging, drawPath, showTip, hideTip, badge, reduceMotion, niceDate } from "./util.js";

// ------------------------------------------------------------------ sparkline (string)
export function sparkline(rows, { w = 240, h = 46, key = "cost_per_tonne_km", base = "own_baseline", flags = true } = {}) {
  const vals = rows.flatMap((r) => [r[key], r[base]]).filter((v) => v !== null);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.12 || 0.1;
  const x = (i) => (rows.length < 2 ? w / 2 : 3 + (i / (rows.length - 1)) * (w - 6));
  const y = (v) => h - 3 - ((v - lo + pad) / (hi - lo + 2 * pad)) * (h - 6);
  const path = (k) => rows.map((r, i) => (r[k] === null ? "" : `${i && rows[i - 1][k] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`)).join("");
  const area = `M${x(0)},${h} ` + rows.map((r, i) => `L${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(" ") + ` L${x(rows.length - 1)},${h} Z`;
  const dots = flags ? rows.map((r, i) => r.flagged === "No" ? "" :
    `<circle cx="${x(i)}" cy="${y(r[key])}" r="3" fill="var(--${r.flagged === "Yes" ? "critical" : "good"})" stroke="var(--surface)" stroke-width="1.5"/>`).join("") : "";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="var(--s1)" opacity=".08"/>
    <path d="${path(base)}" fill="none" stroke="var(--s2)" stroke-width="1.5" opacity=".9" vector-effect="non-scaling-stroke"/>
    <path d="${path(key)}" fill="none" stroke="var(--s1)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    ${dots}</svg>`;
}

// Monthly bars for KPI tiles: counts per month.
export function monthBars(counts, color) {
  const w = 220, h = 30, n = counts.length, bw = w / n;
  const max = Math.max(1, ...counts.map((c) => c.v));
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${counts.map((c, i) => {
    const bh = c.v ? Math.max(3, (c.v / max) * (h - 2)) : 1.5;
    return `<rect x="${i * bw + 1}" y="${h - bh}" width="${Math.max(1, bw - 2)}" height="${bh}" rx="1.5" fill="${c.v ? color : "var(--surface-3)"}"><title>${c.label}: ${c.v}</title></rect>`;
  }).join("")}</svg>`;
}

// ------------------------------------------------------------------ ring
export function ring(value, total, color = "var(--good)") {
  const r = 30, c = 2 * Math.PI * r, f = total ? value / total : 0;
  return `<svg viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="7"/>
    <circle class="ring-arc" cx="38" cy="38" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - f)}" transform="rotate(-90 38 38)"/>
    <text x="38" y="43" text-anchor="middle" font-size="15" font-weight="700" fill="var(--ink)">${Math.round(f * 100)}%</text></svg>`;
}
export function animateRings(root) {
  requestAnimationFrame(() => root.querySelectorAll(".ring-arc").forEach((a) => (a.style.strokeDashoffset = a.dataset.target)));
}

// ------------------------------------------------------------------ heatmap
export function heatmap(host, { metric = "own_pct", onPick, animate = true } = {}) {
  if (!host || !host.isConnected) return;
  const weeks = S.weeks, routes = S.routes;
  const labelW = 168, top = 24, rowH = 32, gap = 2;
  const avail = Math.max(640, host.clientWidth - 4);
  const cw = Math.max(5, Math.floor((avail - labelW) / weeks.length));
  const W = labelW + cw * weeks.length, H = top + routes.length * rowH + 4;
  host.innerHTML = "";
  const s = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Heatmap of weekly cost change by route" }, host);
  weeks.forEach((wk, i) => {
    if (+wk.slice(8) <= 7 && ["01", "04", "07", "10"].includes(wk.slice(5, 7))) {
      svg("line", { x1: labelW + i * cw, x2: labelW + i * cw, y1: top - 6, y2: H, stroke: css("--grid") }, s);
      const t = svg("text", { x: labelW + i * cw + 3, y: 13 }, s);
      t.textContent = MONTHS[+wk.slice(5, 7) - 1] + (wk.slice(5, 7) === "01" ? " " + wk.slice(0, 4) : "");
    }
  });
  const cells = svg("g", { class: "cells" + (animate && !reduceMotion() ? " anim" : "") }, s);
  routes.forEach((route, ri) => {
    const y = top + ri * rowH;
    const rs = S.byRoute[route];
    const lab = svg("text", { x: 0, y: y + rowH / 2 + 2, style: "font-weight:600;fill:var(--ink)" }, s);
    lab.textContent = route;
    const tl = svg("text", { x: labelW - 12, y: y + rowH / 2 + 2, "text-anchor": "end", style: "fill:var(--muted);font-size:10.5px" }, s);
    tl.textContent = rs[0].route_type;
    const byWeek = Object.fromEntries(rs.map((r) => [r.week_of, r]));
    weeks.forEach((wk, i) => {
      const r = byWeek[wk];
      const x = labelW + i * cw;
      const rect = svg("rect", { class: "cell", x, y: y + gap, width: cw - gap, height: rowH - gap * 3, rx: 2,
        fill: diverging(r ? r[metric] : null), style: `--c:${i}` }, cells);
      if (!r) return;
      if (r.flagged !== "No") {
        svg("circle", { cx: x + (cw - gap) / 2, cy: y + rowH / 2 - gap / 2, r: Math.min(3.6, cw / 2 - .5),
          fill: r.flagged === "Yes" ? "#fff" : css("--good"), stroke: r.flagged === "Yes" ? "#0b0b0b" : "#fff",
          "stroke-width": 1.2, "pointer-events": "none" }, s);
      }
      rect.style.cursor = "pointer";
      rect.addEventListener("mousemove", (e) => showTip(`<div class="t-title">${esc(route)} · week of ${niceDate(wk)}</div>
        <div class="t-row">Cost / tonne-km<span class="v">${rupee(r.cost_per_tonne_km)}</span></div>
        <div class="t-row">vs own history<span class="v">${pct(r.own_pct)}</span></div>
        <div class="t-row">vs similar routes<span class="v">${pct(r.peer_pct)}</span></div>
        <div style="margin-top:7px">${badge(r.flagged)} ${r.matched_note_id ? `<span class="muted">· ${r.matched_note_id}</span>` : ""}</div>`, e));
      rect.addEventListener("mouseleave", hideTip);
      rect.addEventListener("click", () => { hideTip(); onPick && onPick(r); });
    });
  });
}

// ------------------------------------------------------------------ line chart
export function lineChart(host, rows, { selected, onSelect, showNotes = true, animate = true } = {}) {
  if (!host || !rows.length) return;
  const W = Math.max(640, host.clientWidth), H = 400, m = { l: 52, r: 20, t: 44, b: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = rows.flatMap((r) => [r.cost_per_tonne_km, r.own_baseline, r.peer_baseline]).filter((v) => v !== null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const padY = (hi - lo) * 0.08 || 0.1; lo -= padY; hi += padY;
  const step = rows.length > 1 ? iw / (rows.length - 1) : iw;
  const x = (i) => m.l + (rows.length === 1 ? iw / 2 : i * step);
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  host.innerHTML = "";
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Weekly cost per tonne-km for ${rows[0].route}` }, host);

  // note windows
  const lanes = [];
  if (showNotes) {
    const first = rows[0].week_of, last = addDays(rows[rows.length - 1].week_of, 6);
    notesForRoute(rows[0].route).forEach((n) => {
      if (n.scope_kind === "none" || n.window_end < first || n.window_start > last) return;
      const i0 = rows.findIndex((r) => addDays(r.week_of, 6) >= n.window_start);
      const rev = [...rows].reverse().findIndex((r) => r.week_of <= n.window_end);
      const i1 = rows.length - 1 - rev;
      if (i0 < 0 || rev < 0 || i1 < i0) return;
      const bx = Math.max(m.l, x(i0) - step / 2), bw = Math.min(x(i1) + step / 2, W - m.r) - bx;
      const band = svg("rect", { x: bx, y: m.t, width: bw, height: ih, fill: n.can_justify ? css("--band") : css("--band-no"), class: "bandrect", "data-note": n.note_id }, s);
      band.style.cursor = "pointer";
      const label = n.note_id + (n.can_justify ? "" : " ⊘");
      const li = (() => { const k = lanes.findIndex((end) => bx > end + 6); return k < 0 ? lanes.length : k; })();
      lanes[li] = bx + label.length * 6.4 + 4;
      const t = svg("text", { x: bx + 3, y: m.t - 8 - li * 14, style: "font-size:11px;font-weight:600;cursor:pointer;fill:" + (n.can_justify ? "var(--good-ink)" : "var(--muted)"), "data-note": n.note_id }, s);
      t.textContent = label;
      svg("title", {}, t).textContent = `${n.note_id}: ${n.text}`;
    });
  }

  // grid / axes
  const g = svg("g", { class: "axis" }, s);
  niceTicks(lo, hi, 5).forEach((tv) => {
    svg("line", { x1: m.l, x2: W - m.r, y1: y(tv), y2: y(tv), stroke: css("--grid"), "stroke-width": 1 }, g);
    svg("text", { x: m.l - 10, y: y(tv) + 4, "text-anchor": "end" }, g).textContent = "₹" + tv.toFixed(2);
  });
  svg("line", { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, stroke: css("--axis") }, g);
  let lastLabel = -1e9;
  rows.forEach((r, i) => {
    if (+r.week_of.slice(8) <= 7 && x(i) - lastLabel > 46) {
      const t = svg("text", { x: x(i), y: H - 10, "text-anchor": "middle" }, g);
      t.textContent = MONTHS[+r.week_of.slice(5, 7) - 1] + (r.week_of.slice(5, 7) === "01" || lastLabel < 0 ? " ’" + r.week_of.slice(2, 4) : "");
      lastLabel = x(i);
    }
  });

  // selected week band
  const selIdx = rows.findIndex((r) => r.week_of === selected);
  if (selIdx >= 0) svg("rect", { x: x(selIdx) - step / 2, y: m.t, width: Math.max(step, 3), height: ih, fill: css("--accent"), opacity: .10 }, s);

  // series
  const series = [["peer_baseline", "--s3", 1.75], ["own_baseline", "--s2", 1.75], ["cost_per_tonne_km", "--s1", 2.25]];
  series.forEach(([key, c, sw], si) => {
    let d = "", pen = false;
    rows.forEach((r, i) => {
      if (r[key] === null) { pen = false; return; }
      d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(r[key]).toFixed(1); pen = true;
    });
    const p = svg("path", { d, class: "series", fill: "none", stroke: css(c), "stroke-width": sw, "stroke-linejoin": "round", "stroke-linecap": "round" }, s);
    if (animate) drawPath(p, si * 120);
  });
  // area under the route line
  const area = `M${x(0)},${m.t + ih} ` + rows.map((r, i) => `L${x(i).toFixed(1)},${y(r.cost_per_tonne_km).toFixed(1)}`).join(" ") + ` L${x(rows.length - 1)},${m.t + ih} Z`;
  svg("path", { d: area, fill: css("--s1"), opacity: .06, "pointer-events": "none" }, s);

  // crosshair + hover dots
  const cross = svg("line", { y1: m.t, y2: m.t + ih, stroke: css("--axis"), "stroke-width": 1, visibility: "hidden" }, s);
  const dots = ["--s1", "--s2", "--s3"].map((v) => svg("circle", { r: 4.5, fill: css(v), stroke: css("--surface"), "stroke-width": 2, visibility: "hidden", "pointer-events": "none" }, s));
  const hit = svg("rect", { x: m.l - step / 2, y: m.t, width: iw + step, height: ih, fill: "transparent" }, s);
  hit.style.cursor = "crosshair";

  // flagged markers (above the hit area so they get their own clicks)
  rows.forEach((r, i) => {
    if (r.flagged === "No") return;
    const c = svg("circle", { class: "flag", cx: x(i), cy: y(r.cost_per_tonne_km), r: 6, fill: r.flagged === "Yes" ? css("--critical") : css("--good"),
      stroke: css("--surface"), "stroke-width": 2.5, style: `animation-delay:${animate ? 700 + i * 4 : 0}ms` }, s);
    c.addEventListener("click", () => onSelect && onSelect(r));
    c.addEventListener("mousemove", (e) => tipFor(r, e));
    c.addEventListener("mouseleave", hideTip);
  });
  if (selIdx >= 0) {
    svg("circle", { cx: x(selIdx), cy: y(rows[selIdx].cost_per_tonne_km), r: 10.5, fill: "none", stroke: css("--ink"), "stroke-width": 1.6, "pointer-events": "none" }, s);
  }

  function tipFor(r, e) {
    showTip(`<div class="t-title">Week of ${niceDate(r.week_of)}</div>
      <div class="t-row"><i class="key" style="background:var(--s1)"></i>This route<span class="v">${rupee(r.cost_per_tonne_km)}</span></div>
      <div class="t-row"><i class="key" style="background:var(--s2)"></i>Own 8-wk avg<span class="v">${rupee(r.own_baseline)} · ${pct(r.own_pct)}</span></div>
      <div class="t-row"><i class="key" style="background:var(--s3)"></i>Similar routes<span class="v">${rupee(r.peer_baseline)} · ${pct(r.peer_pct)}</span></div>
      <div style="margin-top:7px">${badge(r.flagged)} <span class="muted">${r.shipments} shipments · click for evidence</span></div>`, e);
  }
  const idxAt = (e) => {
    const pt = s.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(s.getScreenCTM().inverse());
    return Math.max(0, Math.min(rows.length - 1, Math.round((p.x - m.l) / step)));
  };
  hit.addEventListener("mousemove", (e) => {
    const i = idxAt(e), r = rows[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    ["cost_per_tonne_km", "own_baseline", "peer_baseline"].forEach((k, j) => {
      if (r[k] === null) return dots[j].setAttribute("visibility", "hidden");
      dots[j].setAttribute("cx", x(i)); dots[j].setAttribute("cy", y(r[k])); dots[j].setAttribute("visibility", "visible");
    });
    tipFor(r, e);
  });
  hit.addEventListener("mouseleave", () => { hideTip(); cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); });
  hit.addEventListener("click", (e) => onSelect && onSelect(rows[idxAt(e)]));
}

// ------------------------------------------------------------------ timeline: routes × time, note windows + verdicts
export function timeline(host, { onNote, onPick, filter = "all" } = {}) {
  if (!host || !host.isConnected) return;
  const weeks = S.weeks, start = weeks[0], end = addDays(weeks[weeks.length - 1], 6);
  const t0 = Date.parse(start), t1 = Date.parse(end);
  const labelW = 168, top = 30, rowH = 40;
  const W = Math.max(720, host.clientWidth - 4), iw = W - labelW - 10;
  const H = top + S.routes.length * rowH + 8;
  const xd = (iso) => labelW + ((Date.parse(iso) - t0) / (t1 - t0)) * iw;
  host.innerHTML = "";
  const s = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Timeline of note windows and flagged weeks per route" }, host);
  weeks.forEach((wk) => {
    if (+wk.slice(8) <= 7 && ["01", "04", "07", "10"].includes(wk.slice(5, 7))) {
      svg("line", { x1: xd(wk), x2: xd(wk), y1: top - 8, y2: H, stroke: css("--grid") }, s);
      svg("text", { x: xd(wk) + 3, y: 14 }, s).textContent = MONTHS[+wk.slice(5, 7) - 1] + " " + wk.slice(0, 4);
    }
  });
  S.routes.forEach((route, ri) => {
    const y = top + ri * rowH;
    svg("rect", { x: labelW, y: y + rowH / 2 - 1, width: iw, height: 2, fill: css("--surface-3") }, s);
    svg("text", { x: 0, y: y + rowH / 2 + 4, style: "font-weight:600;fill:var(--ink)" }, s).textContent = route;
    notesForRoute(route).forEach((n, k) => {
      if (n.scope_kind === "none") return;
      if (filter === "justify" && !n.can_justify) return;
      if (filter === "decoy" && n.can_justify) return;
      const bx = xd(n.window_start), bw = Math.max(5, xd(addDays(n.window_end, 1)) - bx);
      const r = svg("rect", { class: "bandrect", x: bx, y: y + 7, width: bw, height: rowH - 14, rx: 5,
        fill: n.can_justify ? css("--band") : css("--band-no"), stroke: n.can_justify ? css("--good") : css("--axis"),
        "stroke-width": 1, "stroke-dasharray": n.can_justify ? "" : "3 3", style: `animation-delay:${ri * 60 + k * 30}ms` }, s);
      r.style.cursor = "pointer";
      r.addEventListener("mousemove", (e) => showTip(`<div class="t-title">${n.note_id} · ${esc(n.applies_to)}</div>
        <div class="muted" style="margin-bottom:5px">${niceDate(n.window_start)} → ${niceDate(n.window_end)}</div>
        <div>${esc(n.text)}</div><div style="margin-top:6px">${n.can_justify ? '<span class="badge just">Can justify</span>' : '<span class="badge no">No cost impact</span>'}</div>`, e));
      r.addEventListener("mouseleave", hideTip);
      r.addEventListener("click", () => { hideTip(); onNote && onNote(n.note_id); });
      if (bw > 26) {
        const t = svg("text", { x: bx + 4, y: y + rowH / 2 + 4, style: `font-size:10.5px;font-weight:700;pointer-events:none;fill:${n.can_justify ? "var(--good-ink)" : "var(--muted)"}` }, s);
        t.textContent = n.note_id;
      }
    });
    S.byRoute[route].filter((r) => r.flagged !== "No").forEach((r) => {
      const c = svg("circle", { cx: xd(addDays(r.week_of, 3)), cy: y + rowH / 2, r: 5.5, fill: r.flagged === "Yes" ? css("--critical") : css("--good"), stroke: css("--surface"), "stroke-width": 2, class: "flag-dot" }, s);
      c.style.cursor = "pointer";
      c.addEventListener("mousemove", (e) => showTip(`<div class="t-title">${esc(route)} · ${niceDate(r.week_of)}</div>${badge(r.flagged)} ${r.matched_note_id ? "· " + r.matched_note_id : ""}<div class="muted" style="margin-top:5px">${pct(r.own_pct)} own · ${pct(r.peer_pct)} peers</div>`, e));
      c.addEventListener("mouseleave", hideTip);
      c.addEventListener("click", () => { hideTip(); onPick && onPick(r); });
    });
  });
}
