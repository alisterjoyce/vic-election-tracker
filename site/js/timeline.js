/* The 2022-2026 term and the election timetable (timeline.html), from data/timeline.json. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, fmtDate } = App;

  const TYPES = {
    election: "Election", "by-election": "By-election", leadership: "Leadership", retirement: "Retirement",
    defection: "Defection", "electoral-system": "Voting rules", timetable: "Timetable",
  };
  let entries = [], districts = {}, regions = {}, active = new Set(Object.keys(TYPES));
  const $ = (id) => document.getElementById(id);

  // "2026-07" -> "Jul 2026"; "2026-07-28" -> "28 Jul 2026".
  const when = (d) => (d.length === 7 ? App.fmtMonth(`${d}-01`) : fmtDate(d));

  function seatLinks(e) {
    const ds = (e.districts || []).filter((id) => districts[id]).map((id) => `<a href="lower.html#${escapeHtml(id)}">${escapeHtml(districts[id])}</a>`);
    const rs = (e.regions || []).filter((id) => regions[id]).map((id) => `<a href="upper.html#${escapeHtml(id)}">${escapeHtml(regions[id])}</a>`);
    return [...ds, ...rs].join(", ");
  }

  function render() {
    const today = App.melbourneToday ? App.melbourneToday() : new Date().toISOString().slice(0, 10);
    const list = entries.filter((e) => active.has(e.type));
    let year = null, nowDrawn = false;
    const html = [];
    list.forEach((e) => {
      if (!nowDrawn && e.date.slice(0, 10) > today) {
        html.push(`<li class="tl-now" id="tl-now"><span>Today, ${escapeHtml(fmtDate(today))}</span></li>`);
        nowDrawn = true;
      }
      const y = e.date.slice(0, 4);
      if (y !== year) { html.push(`<li class="tl-year"><h2>${y}</h2></li>`); year = y; }
      const links = seatLinks(e);
      html.push(`<li class="tl-item type-${escapeHtml(e.type)}${e.date.slice(0, 10) > today ? " upcoming" : ""}">
          <time datetime="${escapeHtml(e.date)}">${escapeHtml(when(e.date))}</time>
          <div class="tl-body">
            <span class="tl-type">${escapeHtml(TYPES[e.type] || e.type)}</span>
            <p>${escapeHtml(e.text)}</p>
            <p class="muted small">${links ? `${links} · ` : ""}<a href="${escapeHtml(e.source.url)}" target="_blank" rel="noopener">${escapeHtml(e.source.label)}</a></p>
          </div>
        </li>`);
    });
    if (!nowDrawn) html.push(`<li class="tl-now" id="tl-now"><span>Today, ${escapeHtml(fmtDate(today))}</span></li>`);
    $("timeline").innerHTML = html.join("");
    $("tl-count").textContent = `${list.length} of ${entries.length} events`;
  }

  async function init() {
    try {
      const [td, dd, rd] = await Promise.all([loadJSON("timeline"), loadJSON("districts"), loadJSON("regions")]);
      entries = td.entries.slice().sort((a, b) => a.date.localeCompare(b.date));
      dd.districts.forEach((d) => { districts[d.id] = d.name; });
      rd.regions.forEach((r) => { regions[r.id] = `${r.name} Region`; });
      const counts = {};
      entries.forEach((e) => { counts[e.type] = (counts[e.type] || 0) + 1; });
      $("tl-filters").innerHTML = Object.entries(TYPES).filter(([k]) => counts[k]).map(([k, label]) =>
        `<button type="button" class="chip tl-chip type-${k}" data-type="${k}" aria-pressed="true">${escapeHtml(label)} <span class="muted">${counts[k]}</span></button>`).join("");
      $("tl-filters").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-type]");
        if (!btn) return;
        const on = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", String(on));
        if (on) active.add(btn.dataset.type); else active.delete(btn.dataset.type);
        render();
      });
      $("tl-today").addEventListener("click", () => $("tl-now").scrollIntoView({ block: "center" }));
      render();
    } catch (err) {
      App.showError($("timeline"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
