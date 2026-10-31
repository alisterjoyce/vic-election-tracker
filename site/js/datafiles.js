/* The /data/ index: every published data file with its credit and licence; field lists come
   from each file's own _schema, fetched when its "Fields" panel is opened.
   VEC election-night results (results_2026/) are deliberately not listed: the VEC media feed
   is covered by the VEC's terms of use. */
(function () {
  "use strict";
  const App = window.App;
  const { escapeHtml } = App;

  const OURS = "This site, CC BY 4.0.";
  const WIKI = '<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>';
  const VICMAP = 'Vicmap Admin, © State of Victoria (Department of Energy, Environment and Climate Action), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.';
  const FILES = [
    ["districts.json", "88 Legislative Assembly districts: region, sitting MP, notional margin, classification, retiring", "District list and regions: Victorian Electoral Commission. Margins and classifications: ABC election guide."],
    ["candidates.json", "Candidates for both houses: party, status, ballot or ticket position, source, website", `ABC election guide; Wikipedia (${WIKI}); party announcements.`],
    ["regions.json", "8 Legislative Council regions: current MLCs and 2026 tickets", "Victorian Electoral Commission (regions); party announcements and news reports (tickets)."],
    ["polls.json", "Statewide polls: primaries, 2PP, 3PP, preferred premier, approval, client, source link", `Wikipedia's poll tables (${WIKI}), compiled from each pollster's release (linked per poll).`],
    ["council_polls.json", "Upper-house primary vote by region", "Roy Morgan (linked in the file)."],
    ["seat_models.json", "MRP seat estimates", "YouGov for Common Threads."],
    ["seat_odds.json", "Sportsbet seat markets: every option and price, favourite", "Sportsbet, prices as at the date in the file."],
    ["seat_polls.json", "Single-seat polls", "Each pollster, as published."],
    ["htv.json", "How-to-vote cards registered with the VEC, and their preference orders", "Victorian Electoral Commission register; each card belongs to whoever registered it."],
    ["timeline.json", "Events of the 2022-2026 term and the election timetable", `${OURS} Each entry links its source.`],
    ["changelog.json", "What changed in the data at each daily refresh", OURS],
    ["news.json", "Headlines per seat and statewide: title, outlet, date, link", "Headlines belong to their publishers and aren't covered by this site's licence. Links only."],
    ["headshots.json", "Candidate photo records: files, source, credit, licence", "Photos belong to the parties, campaigns and outlets credited and aren't covered by this site's licence."],
    ["meta.json", "Refresh times, source status, key dates, 2022 baseline", OURS],
    ["localities.json", "Suburbs and postcodes to districts, with area shares", VICMAP],
    ["geo/districts.geojson", "District boundaries, simplified", VICMAP],
    ["geo/regions.geojson", "Region boundaries, simplified", VICMAP],
    ["results_2022/index.json", "2022 results by district (one file per district alongside it), by voting centre", `Victorian Electoral Commission 2022 results; swings from Wikipedia (${WIKI}).`],
  ];

  function fields(schema) {
    if (!schema) return '<p class="muted small">This file has no field list.</p>';
    const f = schema.fields || {};
    return `${schema.description ? `<p class="small">${escapeHtml(schema.description)}</p>` : ""}
      ${Object.keys(f).length ? `<dl class="schema">${Object.entries(f).map(([k, v]) =>
        `<dt><code>${escapeHtml(k)}</code></dt><dd>${escapeHtml(typeof v === "string" ? v : JSON.stringify(v))}</dd>`).join("")}</dl>` : ""}`;
  }

  function render() {
    const origin = App.ROOT.href;
    document.getElementById("attribution").textContent = `Vic Election 2026 tracker, ${origin}`;
    document.getElementById("data-files").innerHTML = FILES.map(([file, what, credit]) => {
      const json = file.endsWith(".json") && !file.startsWith("geo/");
      return `<tr>
        <td><a href="${escapeHtml(file)}" download><code>${escapeHtml(file)}</code></a></td>
        <td>${escapeHtml(what)}
          ${json ? `<details class="schema-details" data-file="${escapeHtml(file)}"><summary>Fields</summary><div class="schema-body"><p class="empty">Loading…</p></div></details>` : ""}</td>
        <td class="small">${credit}</td>
      </tr>`;
    }).join("");
    document.querySelectorAll(".schema-details").forEach((d) => d.addEventListener("toggle", async () => {
      if (!d.open || d.dataset.loaded) return;
      d.dataset.loaded = "1";
      const body = d.querySelector(".schema-body");
      try {
        const data = await App.loadJSON(d.dataset.file.replace(/\.json$/, ""));
        body.innerHTML = fields(data._schema);
      } catch (err) {
        body.innerHTML = `<p class="empty">Couldn't load ${escapeHtml(d.dataset.file)}.</p>`;
      }
    }));
  }

  document.addEventListener("DOMContentLoaded", render);
})();
