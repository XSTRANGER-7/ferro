import { S } from "../store.js";
import { esc, icon } from "../util.js";
import { ring, animateRings } from "../charts.js";

export const title = "Trust & evaluation";
const NAMES = {
  official_sample: ["Official sample rows", "Our numbers equal the graders' own example rows"],
  labeled_cases: ["Hand-labeled cases", "Every planted anomaly, flood-window edge, decoy week and first week"],
  note_parsing: ["Note reading", "Parser output vs an independently written reading of each note"],
  guardrails: ["Guardrail probes", "Adversarial attempts to make a wrong note justify a rise"],
  retrieval: ["Retrieval recall", "The right note is found whenever one should match"],
  hallucination_audit: ["Hallucination audit", "Every justified row re-checked: right route, dates, effect"],
  contract: ["Output contract", "Columns, order and formats match the sample file exactly"],
};

export async function render(view, params, app) {
  view.innerHTML = `<div class="page-head"><div><h1>Trust &amp; evaluation</h1><p>Loading the evaluation…</p></div></div>
    <div class="rings">${Array(7).fill('<div class="skel" style="height:150px"></div>').join("")}</div>`;
  if (!S.trust) S.trust = await fetch("/api/trust").then((r) => r.json());
  const { eval: ev, repro: rp, token_log: tl, data_quality: dq } = S.trust;
  const th = S.data.meta.thresholds;
  const allOk = ev.all_passed;
  const totalCases = ev.suites.reduce((a, s) => a + s.total, 0), passed = ev.suites.reduce((a, s) => a + s.passed, 0);
  const b = tl.billable_api_calls, p = tl.projected_if_llm_enabled;

  view.innerHTML = `
    <div class="page-head reveal"><div><h1>Trust &amp; evaluation</h1>
      <p>A working demo isn't the bar. This page shows why the output can be trusted: checks against known answers, adversarial probes, an audit of every justification, identical repeat runs, and an honest cost log.</p></div></div>
    <div class="big-check ${allOk ? "" : "bad"} reveal">${icon(allOk ? "shield" : "alert")}
      ${allOk ? `All ${ev.suites.length} evaluation suites pass: ${passed}/${totalCases} checks, 0 fabricated justifications.` : "Some evaluation checks fail. See below."}
      <span class="spacer"></span><span class="small" style="font-weight:500">run <span class="mono">python -m ferro eval</span> to reproduce</span></div>

    <div class="rings reveal" style="margin-top:18px">${ev.suites.map((s) => `
      <div class="ring-card" data-suite="${s.suite}">${ring(s.passed, s.total, s.ok ? "var(--good)" : "var(--critical)")}
        <div class="rv">${s.passed}/${s.total}</div><div class="rl"><b>${NAMES[s.suite]?.[0] || s.suite}</b><br><span class="muted">${NAMES[s.suite]?.[1] || ""}</span></div></div>`).join("")}</div>

    <div class="grid g-3" style="margin-top:18px">
      <div class="card reveal"><h2>${icon("refresh")} Same input, same output</h2><p class="muted" style="margin:4px 0 14px">3 untouched runs in fresh processes</p>
        ${rp ? `<div class="big-check ${rp.identical ? "" : "bad"}" style="margin-bottom:12px">${icon(rp.identical ? "check" : "x")} ${rp.identical ? "Byte-identical" : "Different"} · ${rp.graded_field_diffs} graded diffs</div>
          <dl class="kv">${rp.per_run.map((x) => `<dt>${x.run}</dt><dd><span class="hash">${x.results_sha256.slice(0, 16)}…</span> ${x.flag_counts.Yes} / ${x.flag_counts["No (justified)"]}</dd>`).join("")}</dl>`
        : `<p class="muted">Run <span class="mono">python -m ferro repro</span> to generate the report.</p>`}
        <p class="muted small" style="margin-top:12px">Verdicts come from deterministic code. The optional LLM (temperature 0, seed 7, cached) only rewords text, and a validator rejects any rewrite that changes a note, number or verdict.</p></div>

      <div class="card reveal"><h2>${icon("spark")} Cost of running it</h2><p class="muted" style="margin:4px 0 14px">One full run over ${dq.rows_used.toLocaleString()} shipments</p>
        <dl class="kv"><dt>Mode</dt><dd>${tl.llm_enabled ? esc(tl.model) : "LLM off · grounded templates"}</dd>
          <dt>API calls</dt><dd>${b.calls}</dd><dt>Tokens in / out</dt><dd>${b.input_tokens.toLocaleString()} / ${b.output_tokens.toLocaleString()}</dd>
          <dt>Cost</dt><dd><b>$${b.cost_usd.toFixed(6)}</b></dd><dt>Cache hits</dt><dd>${tl.served_from_cache.calls}</dd>
          ${p ? `<dt>With LLM on</dt><dd>${p.calls} calls · ~${p.input_tokens.toLocaleString()} in / ~${p.output_tokens.toLocaleString()} out · ≈ $${p.cost_usd.toFixed(5)}</dd>` : ""}
          <dt>Price</dt><dd>$${tl.pricing_usd_per_1m.input} / $${tl.pricing_usd_per_1m.output} per 1M tokens</dd></dl>
        <p class="muted small" style="margin-top:12px">One LLM call per flagged week only. The ${S.data.meta.flag_counts.No} normal weeks never touch it.</p></div>

      <div class="card reveal"><h2>${icon("table")} Data quality &amp; rules</h2><p class="muted" style="margin:4px 0 14px">What went in, and the rules applied</p>
        <dl class="kv"><dt>Rows read / used</dt><dd>${dq.rows_read} / ${dq.rows_used}</dd><dt>Quarantined</dt><dd>${dq.rows_quarantined}</dd>
          <dt>Warnings</dt><dd>${dq.warnings.length ? dq.warnings.map(esc).join("<br>") : "none"}</dd>
          <dt>Weekly cost</dt><dd>Σ cost ÷ Σ tonne-km, Mon–Sun</dd><dt>Own history</dt><dd>previous ${th.history_weeks} weeks only</dd>
          <dt>Flag</dt><dd>own &gt; +${th.own_history_pct}% or peers &gt; +${th.peer_pct}% while rising</dd>
          <dt>Justified</dt><dd>a note passes route, dates, effect &amp; size</dd></dl></div>
    </div>

    <div class="card reveal" id="cases"><div class="card-head"><div><h2>Inspect the checks</h2><p class="muted">Every case, with what was expected and what the system did.</p></div>
      <div class="seg" id="suite-sel">${ev.suites.map((s, i) => `<button data-s="${s.suite}" class="${i === 3 ? "on" : ""}">${NAMES[s.suite]?.[0] || s.suite}</button>`).join("")}</div></div>
      <div id="case-table" style="overflow-x:auto"></div></div>`;

  animateRings(view);
  const table = (name) => {
    const s = ev.suites.find((x) => x.suite === name);
    view.querySelectorAll("#suite-sel button").forEach((b) => b.classList.toggle("on", b.dataset.s === name));
    view.querySelector("#case-table").innerHTML = `<table class="trace"><thead><tr><th></th><th>Case</th><th>Detail</th><th>Expected</th><th>Got</th></tr></thead><tbody>
      ${s.cases.map((c, i) => `<tr style="--i:${Math.min(i, 20)}"><td><span class="ck ${c.pass ? "ok" : "fail"}"><span class="m">${c.pass ? "✓" : "✗"}</span></span></td>
        <td class="mono">${esc(c.id)}</td><td>${esc(c.attack || c.why || c.detail || (c.top_k ? "top-k: " + c.top_k.join(", ") : ""))}</td>
        <td class="mono">${esc(c.expected ?? (c.rank ? "rank ≤ 4" : ""))}</td><td class="mono">${esc(c.got ?? (c.rank ? "rank " + c.rank : ""))}</td></tr>`).join("")}</tbody></table>`;
  };
  view.querySelector("#suite-sel").onclick = (e) => { const b = e.target.closest("button"); if (b) table(b.dataset.s); };
  view.querySelectorAll(".ring-card").forEach((c) => c.addEventListener("click", () => {
    table(c.dataset.suite);
    view.querySelector("#cases").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  table("guardrails");
}
