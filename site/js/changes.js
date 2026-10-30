/* What changed (changes.html): data/changelog.json grouped by day or by week, then by kind of change. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, fmtDate } = App;

  const KINDS = [
    ["candidate_added", "New candidates"], ["candidate_superseded", "Replaced candidates"],
    ["candidate_withdrawn", "Withdrawn candidates"], ["retirement", "Retirements"], ["poll_added", "New polls"],
    ["odds_move", "Betting moves (0.5 or more)"], ["news", "News"],
  ];
  const SHOW = 8;   // entries listed per kind before "N more"

  let entries = [], names = {}, by = "day", active = new Set(KINDS.map(([k]) => k));
  const $ = (id) => document.getElementById(id);

  // Monday of the entry's week, as YYYY-MM-DD.
  function weekOf(date) {
    const d = App.parseDate(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function group(list) {
    const out = new Map();
    list.forEach((e) => {
      const k = by === "day" ? e.date : weekOf(e.date);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(e);
    });
    return out;
  }

  function kindBlock(kind, label, list) {
    const li = (e) => `<li>${App.describeChange(e, names)}</li>`;
    return `<div class="ch-kind">
        <h3>${escapeHtml(label)} <span class="muted small">${list.length}</span></h3>
        <ul class="ch-list">${list.slice(0, SHOW).map(li).join("")}</ul>
        ${list.length > SHOW ? `<details><summary>${list.length - SHOW} more</summary><ul class="ch-list">${list.slice(SHOW).map(li).join("")}</ul></details>` : ""}
      </div>`;
  }

  function render() {
    const list = entries.filter((e) => active.has(e.type));
    $("ch-count").textContent = `${list.length} change${list.length === 1 ? "" : "s"}`;
    if (!list.length) { $("changes").innerHTML = '<div class="card"><p class="empty">Nothing recorded for these filters.</p></div>'; return; }
    $("changes").innerHTML = [...group(list)].map(([key, items]) => `
      <section class="card ch-group">
        <div class="card-head"><h2>${by === "day" ? escapeHtml(fmtDate(key)) : `Week of ${escapeHtml(fmtDate(key))}`}</h2>
          <span class="muted small">${items.length}</span></div>
        ${KINDS.map(([k, label]) => { const its = items.filter((e) => e.type === k); return its.length ? kindBlock(k, label, its) : ""; }).join("")}
      </section>`).join("");
  }

  async function init() {
    try {
      const [cl, dd, rd] = await Promise.all([loadJSON("changelog"), loadJSON("districts"), loadJSON("regions")]);
      entries = (cl.entries || []).slice().sort((a, b) => b.at.localeCompare(a.at));
      dd.districts.forEach((d) => { names[d.id] = d.name; });
      rd.regions.forEach((r) => { names[r.id] = `${r.name} Region`; });
      const counts = {};
      entries.forEach((e) => { counts[e.type] = (counts[e.type] || 0) + 1; });
      $("ch-filters").innerHTML = KINDS.filter(([k]) => counts[k]).map(([k, label]) =>
        `<button type="button" class="chip" data-kind="${k}" aria-pressed="true">${escapeHtml(label)} <span class="muted">${counts[k]}</span></button>`).join("");
      $("ch-filters").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-kind]");
        if (!btn) return;
        const on = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", String(on));
        if (on) active.add(btn.dataset.kind); else active.delete(btn.dataset.kind);
        render();
      });
      document.querySelectorAll("[data-by]").forEach((b) => b.addEventListener("click", () => {
        by = b.dataset.by;
        document.querySelectorAll("[data-by]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        render();
      }));
      $("ch-updated").textContent = cl.updated ? `Last change recorded ${App.fmtDateTime(cl.updated)}` : "";
      render();
    } catch (err) {
      App.showError($("changes"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
