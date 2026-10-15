import { S } from "../store.js";
import { esc, icon, md, niceDate, noteChip, reduceMotion, toast } from "../util.js";

export const title = "Ask the assistant";
const history = [];   // persists across page visits during the session
const GROUPS = [
  ["Explain a rise", ["Why did Chennai-Bangalore get pricier in March 2025?", "Why did Delhi-Jaipur cost more in November 2024?", "What's going on with Mumbai-Pune in Q4 2025?"]],
  ["Find alerts", ["Which routes are flagged?", "Which rises were justified by notes?", "Any unexplained rises on Medium routes in 2025?"]],
  ["Understand the rules", ["How do you decide a flag?", "What does N003 say?", "What does N009 say?"]],
  ["Compare", ["Compare routes by cost in 2025", "What is the cost trend for Delhi-Chennai?"]],
];

export function render(view, params, app) {
  view.innerHTML = `
    <div class="page-head reveal"><div><h1>Ask the assistant</h1>
      <p>Ask in plain English. Answers come <b>only</b> from this run's results and the context notes, with the route-weeks and note ids they rely on. If it doesn't know, it says so.</p></div>
      <button class="btn ghost" id="clear">${icon("refresh")} New conversation</button></div>
    <div class="chat">
      <div class="card chat-card reveal">
        <div class="chat-log" id="log"></div>
        <form class="chat-form" id="form"><input id="inp" autocomplete="off" placeholder="e.g. Why did Chennai-Bangalore get pricier in March 2025?" maxlength="500">
          <button class="btn" type="submit">${icon("chat")} Ask</button></form>
      </div>
      <div class="card reveal">
        <h2 style="margin-bottom:12px">Try asking</h2>
        ${GROUPS.map(([g, qs]) => `<div class="muted small" style="margin:10px 0 6px;text-transform:uppercase;letter-spacing:.06em">${g}</div>
          <div class="sugg-list">${qs.map((q) => `<button type="button">${esc(q)}</button>`).join("")}</div>`).join("")}
      </div>
    </div>`;

  const log = view.querySelector("#log"), inp = view.querySelector("#inp");
  const scroll = () => (log.scrollTop = log.scrollHeight);

  function bubble(who, html) {
    const d = document.createElement("div");
    d.className = "msg " + who;
    d.innerHTML = `<div class="avatar">${who === "bot" ? "Fe" : "You"}</div><div class="bubble">${html}</div>`;
    log.appendChild(d);
    scroll();
    return d.querySelector(".bubble");
  }
  function answerHtml(a) {
    const cites = (a.citations || []).slice(0, 14).map((c) =>
      `<span class="cite" data-k="${esc(c.route)}|${c.week_of}">${c.flagged === "Yes" ? "▲" : c.flagged === "No (justified)" ? "✓" : "·"} ${esc(c.route)} · ${niceDate(c.week_of)}</span>`).join("");
    return md(a.answer) +
      (cites ? `<div class="cites">${cites}</div>` : "") +
      `<div class="meta">${icon("shield")} ${a.source === "llm" ? "LLM wording, validated" : "Built from computed results"} · intent: ${esc(a.intent)} ${(a.note_ids || []).map(noteChip).join(" ")}
        <span class="spacer"></span><button class="icon-btn" data-copy title="Copy answer" style="width:26px;height:26px">${icon("copy")}</button></div>`;
  }
  function reveal(el, html) {
    el.innerHTML = html;
    if (reduceMotion()) return;
    const kids = [...el.children];
    kids.forEach((k, i) => { k.style.opacity = 0; k.style.transform = "translateY(6px)"; k.style.transition = "opacity .35s, transform .35s";
      setTimeout(() => { k.style.opacity = 1; k.style.transform = "none"; scroll(); }, 80 + i * 110); });
  }
  async function ask(q, record = true) {
    bubble("user", esc(q));
    const b = bubble("bot", `<span class="typing"><i></i><i></i><i></i></span>`);
    try {
      const [a] = await Promise.all([
        fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) }).then((r) => r.json()),
        new Promise((res) => setTimeout(res, reduceMotion() ? 0 : 450)),
      ]);
      if (a.error) throw new Error(a.error);
      reveal(b, answerHtml(a));
      b.dataset.text = a.answer;
      if (record) history.push({ q, a });
    } catch (e) {
      b.innerHTML = `<span style="color:var(--critical-ink)">Sorry, that failed: ${esc(e.message)}</span>`;
    }
  }

  if (!history.length) {
    bubble("bot", md(`Hi! I'm the Ferro assistant. I can explain **why** a route got pricier, list **flagged** or **justified** weeks, describe what a **note** says and how I read it, or **compare** routes. Pick a suggestion on the right or type your own question.`));
  } else {
    history.forEach(({ q, a }) => { bubble("user", esc(q)); const b = bubble("bot", answerHtml(a)); b.dataset.text = a.answer; });
  }

  view.querySelector("#form").onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); if (v) { inp.value = ""; ask(v); } };
  view.querySelectorAll(".sugg-list button").forEach((b) => b.addEventListener("click", () => ask(b.textContent)));
  view.querySelector("#clear").onclick = () => { history.length = 0; log.innerHTML = ""; bubble("bot", md("New conversation. Ask me anything about the findings.")); };
  log.addEventListener("click", (e) => {
    const c = e.target.closest(".cite");
    if (c) return app.openDrawer(S.byKey[c.dataset.k]);
    const cp = e.target.closest("[data-copy]");
    if (cp) navigator.clipboard?.writeText(cp.closest(".bubble").dataset.text || "").then(() => toast("Answer copied", "copy"));
  });
  if (params.query.q) ask(params.query.q);
  setTimeout(() => inp.focus(), 50);
}
