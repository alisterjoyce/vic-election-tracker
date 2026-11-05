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
    ["seat_models.json", "Seat models: MRP calls, forecast win probabilities with first-preference ranges and 2CP scenarios per candidate, and a seat projection's totals",
      'YouGov for Common Threads (MRP). <a href="https://www.aeforecasts.com/forecast/2026vic/regular">Australian Election Forecasts (aeforecasts.com)</a>, refreshed four times a day; its numbers belong to that site, so credit it when reusing them. <a href="https://www.linkedin.com/posts/kosmos-samaras-80bb9978_what-the-latest-victorian-newspoll-numbers-activity-7520224020676386816-mTuv">RedBridge Group seat model</a> (26 Oct 2026, statewide totals).'],
    ["seat_odds.json", "Sportsbet seat markets: every option and price, favourite", "Sportsbet, prices as at the date in the file."],
    ["seat_polls.json", "Single-seat polls", "Each pollster, as published."],
    ["htv.json", "How-to-vote cards registered with the VEC, and their preference orders", "Victorian Electoral Commission register; each card belongs to whoever registered it."],
    ["timeline.json", "Events of the 2022-2026 term and the election timetable", `${OURS} Each entry links its source.`],
    ["news.json", "Headlines per seat and statewide: title, outlet, date, link", "Headlines belong to their publishers and aren't covered by this site's licence. Links only."],
    ["headshots.json", "Candidate photo records: files, source, credit, licence", "Photos belong to the parties, campaigns and outlets credited and aren't covered by this site's licence."],
    ["profiles.json", "Researched candidate profiles: summary, roles, past candidacies, priorities, links, and a source for every fact", `${OURS} Facts are drawn from the sources listed in each profile, including Wikipedia (${WIKI}) and the Parliament of Victoria.`],
    ["policies.json", "Party policy ledger: each major party's published position on 15 issues, with a source for every claim",
      '<a href="https://electiontracker.au/elections/vic/2026/data">Australian Election Tracker (OZE), electiontracker.au</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, copied at each refresh. A ledger of published claims, not a rating; keep its caveat with any reuse. Cite as: Australian Election Tracker (OZE), Victorian state election 2026 candidate ledger, electiontracker.au, accessed (date).'],
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

  // How many active candidates (both houses) have a researched profile.
  async function renderProfileCount() {
    const el = document.getElementById("profile-count");
    if (!el) return;
    try {
      const [people, pd] = await Promise.all([App.loadPeople(), App.loadJSON("profiles")]);
      const profiles = pd.profiles || {};
      const active = people.filter((p) => p.contesting && !["withdrawn", "superseded", "not_standing"].includes(p.status));
      const row = (label, list) => {
        const n = list.filter((p) => profiles[p.id]).length;
        return `<tr><td>${label}</td><td class="num">${n.toLocaleString("en-AU")}</td><td class="num">${list.length.toLocaleString("en-AU")}</td><td class="num">${list.length ? Math.round((100 * n) / list.length) : 0}%</td></tr>`;
      };
      el.innerHTML = `<div class="table-scroll"><table data-no-csv>
          <thead><tr><th>Candidates</th><th class="num">Profiled</th><th class="num">Active</th><th class="num">Complete</th></tr></thead>
          <tbody>${row("Legislative Assembly", active.filter((p) => p.house === "lower"))}${row("Legislative Council", active.filter((p) => p.house === "upper"))}${row("Both houses", active)}</tbody>
        </table></div>`;
    } catch (err) {
      el.innerHTML = '<p class="empty">Profile counts aren\'t available.</p>';
    }
  }

  document.addEventListener("DOMContentLoaded", () => { render(); renderProfileCount(); });
})();
