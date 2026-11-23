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
  const VEC_CC = '<a href="https://www.vec.vic.gov.au/legal">© Victorian Electoral Commission</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>';
  const VICMAP = 'Vicmap Admin, © State of Victoria (Department of Energy, Environment and Climate Action), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.';
  const FILES = [
    ["districts.json", "88 Legislative Assembly districts: region, sitting MP, notional margin, classification, retiring", "District list and regions: Victorian Electoral Commission. Margins and classifications: ABC election guide."],
    ["candidates.json", "Candidates for both houses: party, status, ballot or ticket position, source, website", `Victorian Electoral Commission (the official list, from 9 Nov 2026); ABC election guide; Wikipedia (${WIKI}); party announcements.`],
    ["vec_nominations.json", "The VEC's official list of candidates: name as on the ballot, party, ballot position, Council group and place in it, and changes since nominations closed", '<a href="https://www.vec.vic.gov.au/voting/2026-state-election">Victorian Electoral Commission</a>, nominations pages and spreadsheet of candidates (names and parties only; no contact details are kept).'],
    ["regions.json", "8 Legislative Council regions: current MLCs and 2026 tickets", "Victorian Electoral Commission (regions); party announcements and news reports (tickets)."],
    ["polls.json", "Statewide polls: primaries, 2PP, 3PP, preferred premier, approval, client, source link", `Wikipedia's poll tables (${WIKI}), compiled from each pollster's release (linked per poll).`],
    ["poll_aggregates.json", "Other sites' statewide poll averages: primary vote by party, 2PP where published, the date each runs to, and links (the polls page's \"Aggregates compared\" table)",
      '<a href="https://www.pollbludger.net/vic2026/bludgertrack/">BludgerTrack (The Poll Bludger)</a> and <a href="https://acestrategies.au/victoria-election-2026/polls">Ace Strategies</a>, read once a day; their figures belong to them, so credit them when reusing. <a href="https://electiontracker.au/elections/vic/2026/polls">electiontracker.au</a> poll average, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, read at each refresh.'],
    ["pollbludger_margins.json", "The margin The Poll Bludger's election guide lists for each seat, and the seats where it differs from this site's (districts.json): another holder, another two-party contest, or a gap of more than 0.1 points",
      '<a href="https://pollbludger.net/vic2026/">The Poll Bludger</a> (William Bowe), Victorian election guide, read once a day; its figures belong to it, so credit it when reusing. Figures and links only.'],
    ["council_polls.json", "Upper-house primary vote by region", "Roy Morgan (linked in the file)."],
    ["seat_models.json", "Seat models: MRP calls, forecast win probabilities with first-preference ranges and 2CP scenarios per candidate, and a seat projection's totals",
      'YouGov for Common Threads (MRP). <a href="https://www.aeforecasts.com/forecast/2026vic/regular">Australian Election Forecasts (aeforecasts.com)</a>, refreshed four times a day; its numbers belong to that site, so credit it when reusing them. <a href="https://www.linkedin.com/posts/kosmos-samaras-80bb9978_what-the-latest-victorian-newspoll-numbers-activity-7520224020676386816-mTuv">RedBridge Group seat model</a> (26 Oct 2026, statewide totals).'],
    ["seat_odds.json", "Sportsbet seat markets: every option and price, favourite", "Sportsbet, prices as at the date in the file."],
    ["seat_history.json", "A daily snapshot of each seat's forecast win probabilities and Sportsbet prices (35 days), for the weekly briefing's biggest seat moves",
      'Australian Election Forecasts (aeforecasts.com) and Sportsbet, as in seat_models.json and seat_odds.json; credit them when reusing.'],
    ["../share/this-week.png", "The weekly briefing image (1200x630): poll average, seat projection, biggest seat moves in 7 days, next key date. Redrawn at each refresh, always at this address", `${OURS} Figures as credited on the files above.`],
    ["seat_polls.json", "Single-seat polls", "Each pollster, as published."],
    ["voting_centres/index.json", "Where to vote: every early and election-day voting centre per district, with position, address, wheelchair access and hours. One file per district alongside it (e.g. voting_centres/melton.json); the index has the standard hours and counts",
      `${VEC_CC}: the VEC's <a href="https://www.vec.vic.gov.au/voting/2026-state-election/voting-locations">venues spreadsheet</a> and <a href="https://maps.vec.vic.gov.au/elections">venue locator</a>, read once a day.`],
    ["early_votes.json", "Early votes and postal votes returned, statewide by day and by district where the VEC publishes them; enrolment per district at the close of roll; 2022's daily figures for comparison",
      `${VEC_CC}, read at each refresh (2022: the VEC's daily table, via the <a href="http://web.archive.org/web/20221227113148/https://www.vec.vic.gov.au/voting/electoral-statistics/state-election-statistics">Wayback Machine</a>). Nothing is estimated.`],
    ["htv.json", "How-to-vote cards registered with the VEC: who registered each, when, the districts and regions it covers, a link to the card, and the preference order it prints for each (read from the card's PDF; \"unreadable, see card\" where it couldn't be read reliably). The same per seat: htv/<district or region id>.json (e.g. htv/bendigo-east.json); counts in htv/index.json",
      `${VEC_CC} (the <a href="https://www.vec.vic.gov.au/voting/2026-state-election/how-to-vote-cards">register</a>). The cards themselves belong to whoever registered them; only facts from them are stored.`],
    ["timeline.json", "Events of the 2022-2026 term and the election timetable", `${OURS} Each entry links its source.`],
    ["news.json", "Headlines per seat and statewide: title, outlet, date, link", "Headlines belong to their publishers and aren't covered by this site's licence. Links only."],
    ["headshots.json", "Candidate photo records: files, source, credit, licence", "Photos belong to the parties, campaigns and outlets credited and aren't covered by this site's licence."],
    ["profiles.json", "Researched candidate profiles: summary, roles, past candidacies, priorities, links, and a source for every fact. The same profiles split by seat: profiles/<seat id>.json (e.g. profiles/bendigo-west.json), listed in profiles/index.json", `${OURS} Facts are drawn from the sources listed in each profile, including Wikipedia (${WIKI}) and the Parliament of Victoria.`],
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
      const [people, pd] = await Promise.all([App.loadPeople(), App.loadJSON("profiles/index")]);   // the ids only, not the 2.8 MB file
      const profiles = new Set(pd.ids || []);
      const active = people.filter((p) => p.contesting && !["withdrawn", "superseded", "not_standing"].includes(p.status));
      const row = (label, list) => {
        const n = list.filter((p) => profiles.has(p.id)).length;
        return `<tr><td>${label}</td><td class="num">${n.toLocaleString("en-AU")}</td><td class="num">${list.length.toLocaleString("en-AU")}</td><td class="num">${list.length ? Math.round((100 * n) / list.length) : 0}%</td></tr>`;
      };
      el.innerHTML = `<div class="table-scroll" tabindex="0" role="region" aria-label="Candidate profiles by house (scrolls sideways)"><table data-no-csv>
          <thead><tr><th>Candidates</th><th class="num">Profiled</th><th class="num">Active</th><th class="num">Complete</th></tr></thead>
          <tbody>${row("Legislative Assembly", active.filter((p) => p.house === "lower"))}${row("Legislative Council", active.filter((p) => p.house === "upper"))}${row("Both houses", active)}</tbody>
        </table></div>`;
    } catch (err) {
      el.innerHTML = '<p class="empty">Profile counts aren\'t available.</p>';
    }
  }

  // news.json's sources: how each outlet is read, whether it worked at the last refresh, and its headlines in the last 7 days.
  async function renderNewsSources() {
    const el = document.getElementById("news-sources-body");
    if (!el) return;
    try {
      const n = await App.loadJSON("news");
      const badge = { ok: ["vec_nominated", "OK"], error: ["withdrawn", "Failed"], skipped: ["neutral", "Skipped"] };
      const link = (href, text) => href ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>` : escapeHtml(text);
      const rows = Object.entries(n.sources || {}).map(([name, s]) => {
        const [cls, word] = badge[s.status] || ["neutral", s.status || "?"];
        const via = s.status === "skipped" ? "Not read" : s.via === "feed" ? "Own feed" : s.via === "sitemap" ? "Own news sitemap" : s.via === "feed and Bing News search" ? "Own feed and Bing News search" : (s.via || "");
        return `<tr><td>${link(s.page, name)}</td><td class="small">${s.url ? link(s.url, via || "Link") : escapeHtml(via)}</td>
          <td class="num">${s.status === "ok" ? (s.last_7_days || 0).toLocaleString("en-AU") : "–"}</td>
          <td class="news-src-status"><span class="badge ${cls}">${escapeHtml(word)}</span>${s.message ? `<div class="muted small">${escapeHtml(s.message)}</div>` : ""}</td></tr>`;
      }).join("");
      document.getElementById("news-sources-updated").textContent = n.updated ? `Checked ${App.fmtDateTime(n.updated)}` : "";
      el.innerHTML = `<div class="table-scroll"><table data-no-csv>
          <thead><tr><th>Source</th><th>Read through</th><th class="num">Last 7 days</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody></table></div>`;
    } catch (err) {
      el.innerHTML = "<p class=\"empty\">The news source list isn't available.</p>";
    }
  }

  // How-to-vote card coverage (htv/index.json): cards per party, districts and regions covered, candidates with no card.
  async function renderHtvCoverage() {
    const el = document.getElementById("htv-coverage-body");
    if (!el || !App.Htv) return;
    try {
      el.innerHTML = App.Htv.coverage(await App.loadJSON("htv/index"));
    } catch (err) {
      el.innerHTML = "<p class=\"empty\">The how-to-vote card counts aren't available.</p>";
    }
  }

  // Seats where The Poll Bludger's guide lists a different margin from ours (pollbludger_margins.json).
  async function renderMarginDiffs() {
    const el = document.getElementById("margin-diffs-body");
    if (!el) return;
    try {
      const [pb, dd] = await Promise.all([App.loadJSON("pollbludger_margins"), App.loadJSON("districts")]);
      const names = Object.fromEntries(dd.districts.map((d) => [d.id, d.name]));
      const m = (x) => `${escapeHtml(App.partyShort(x.party))} ${Number(x.pct).toFixed(1)}%${x.vs ? ` vs ${escapeHtml(App.partyShort(x.vs))}` : ""}`;
      const why = { holder: "Different party holds the margin", pair: "Different two-party contest", margin: "Same contest, different figure" };
      const diffs = (pb.differences || []).slice().sort((a, b) => (names[a.district] || "").localeCompare(names[b.district] || ""));
      const rows = diffs.map((x) => `<tr><td><a href="../lower.html#${escapeHtml(x.district)}">${escapeHtml(names[x.district] || x.district)}</a></td>
          <td>${m(x.ours)}</td>
          <td><a href="${escapeHtml(x.theirs.url)}">${m(x.theirs)}</a> <span class="muted small">(${escapeHtml(x.theirs.basis || "")}${x.theirs.asterisk ? ", marked *" : ""})</span></td>
          <td class="small">${x.reasons.map((r) => escapeHtml(why[r] || r)).join("; ")}${x.gap != null ? ` (${x.gap > 0 ? "+" : ""}${Number(x.gap).toFixed(1)})` : ""}</td></tr>`).join("");
      document.getElementById("margin-diffs-updated").textContent = pb.checked ? `Guide read ${App.fmtDate(pb.checked)}` : "";
      el.innerHTML = diffs.length ? `<div class="table-scroll"><table>
          <thead><tr><th>District</th><th>This site (ABC)</th><th>The Poll Bludger</th><th>Difference</th></tr></thead>
          <tbody>${rows}</tbody></table></div>` : '<p class="empty">No differences: the guide lists the same margin as this site for every seat.</p>';
    } catch (err) {
      el.innerHTML = "<p class=\"empty\">The margin comparison isn't available.</p>";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    render();
    // The sections fill in after loading. The links #news-sources and #margin-diffs deliberately aren't the cards' ids
    // (#news-sources-card, #margin-diffs-card), so the browser doesn't jump there before the sections above have filled
    // (which would shift the page); it scrolls once they have, a frame and 100 ms later, so the scroll doesn't land in
    // the frame they fill in or before common.js adds the tables' "Download CSV" bars (50 ms after a change).
    Promise.all([renderProfileCount(), renderHtvCoverage(), renderNewsSources(), renderMarginDiffs()]).then(() => {
      const hash = decodeURIComponent(location.hash.slice(1));
      const target = hash && document.getElementById(hash + "-card");
      if (target) requestAnimationFrame(() => setTimeout(() => target.scrollIntoView(), 100));
    });
  });
})();
