/* Upper house page: pick one of the 8 regions (via #region-id), show MLCs and tickets. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyName, partyVar, partyBadge, statusBadge, hashId, copyLink, fmtDate } = App;

  let regions = [];
  let districts = [];
  let councilCandidates = [];
  let shots = {};   // candidate id -> headshot (data/headshots.json)
  const htvDocs = {};       // data/htv/<region>.json (how-to-vote cards), loaded per region
  let councilPolls = [];   // regional upper-house polls (data/council_polls.json), newest first
  let resultsLc = null;    // data/results_lc.json: the 2026 count by region (scripts/results.py), null if missing
  let vec = null;          // data/vec_nominations.json: the VEC's official list (ballot paper), null if missing

  function ticketSort(a, b) {
    const wa = a.status === "withdrawn", wb = b.status === "withdrawn";
    if (wa !== wb) return wa ? 1 : -1;
    if (!!a.ungrouped !== !!b.ungrouped) return a.ungrouped ? 1 : -1;   // ungrouped candidates come last on the ballot
    // Drawn groups (A, B, ... AA) first in ballot order, then undrawn by party.
    if (a.group && b.group) return a.group.length - b.group.length || a.group.localeCompare(b.group);
    if (a.group || b.group) return a.group ? -1 : 1;
    return App.partyOrder(a.party, b.party);
  }

  // A ticket's heading: the party, or for a group without a registered party (and ungrouped candidates) the
  // name the VEC prints.
  const ticketLabel = (t) => ((t.party === "OTH" || t.ungrouped) && t.label ? t.label : partyName(t.party));

  function renderChips(current) {
    document.getElementById("region-chips").innerHTML = regions.map((r) =>
      `<button type="button" class="chip" data-id="${escapeHtml(r.id)}" aria-pressed="${r.id === current}">${escapeHtml(r.name)}</button>`
    ).join("");
  }

  // Council candidates added to candidates.json (e.g. from Wikipedia) that
  // aren't on a ticket in regions.json, grouped by party in ticket order.
  function renderExtraCandidates(r) {
    const onTicket = new Set((r.tickets || []).flatMap((t) => (t.candidates || []).map((n) => App.candidateId(r.id, n))));
    const rows = councilCandidates.filter((c) => c.region === r.id && !["superseded", "not_standing", "withdrawn"].includes(c.status) &&
      !onTicket.has(App.candidateId(r.id, c.name)));
    if (!rows.length) return "";
    const byParty = {};
    rows.forEach((c) => { (byParty[c.party] = byParty[c.party] || []).push(c); });
    const parties = Object.keys(byParty).sort(App.partyOrder);
    return `
      <div class="card">
        <div class="card-head"><h2>Other announced candidates</h2><span class="muted small">${rows.length} name${rows.length === 1 ? "" : "s"}</span></div>
        <p class="muted small" style="margin-top:0">Names reported elsewhere (mostly Wikipedia) that aren't on the tickets above yet. Numbers are the reported ticket positions.</p>
        <div class="tickets">
          ${parties.map((p) => `
            <div class="ticket" style="--party-color: var(${partyVar(p)})">
              <div class="ticket-head"><strong>${escapeHtml(partyName(p))}</strong></div>
              <ul class="people">
                ${byParty[p].sort((a, b) => (a.ticket_position || 99) - (b.ticket_position || 99) || App.candidateOrder(a, b)).map((c) => `
                  <li>
                    ${c.ticket_position ? `<span class="pos" title="Reported ticket position">${c.ticket_position}</span>` : ""}
                    ${App.avatar(shots, r.id, c.name, c.party, { size: 32 })}
                    <span class="name">${App.profileLink(r.id, c.name)}</span>
                    ${statusBadge(c.status)}
                    ${c.notes ? `<span class="note muted small">${escapeHtml(c.notes)}</span>` : ""}
                  </li>`).join("")}
              </ul>
            </div>`).join("")}
        </div>
        ${App.photoCredits(shots, rows.map((c) => [r.id, c.name]))}
      </div>`;
  }

  // The 2026 count for the region (results_lc.json): quotas filled per group on first preferences, credited to the VEC.
  function regionCount(r) {
    const c = resultsLc && resultsLc.regions && resultsLc.regions[r.id];
    if (!resultsLc) return "";
    if (!c || !c.total) {
      return `<p class="r26-wait small"><strong>2026 count:</strong> counting begins 6 pm Sat 28 Nov. Figures from the
        <a href="https://www.vec.vic.gov.au/results" rel="noopener" target="_blank">Victorian Electoral Commission</a> will appear here.</p>`;
    }
    const groups = c.groups.filter((g) => g.quotas >= 0.05);
    return `<section class="region-count" aria-labelledby="rc-h">
      <h3 id="rc-h">2026 count: quotas filled</h3>
      <p class="muted small" style="margin-top:0">${c.counted_pct.toFixed(1)}% of enrolment counted · ${c.formal.toLocaleString("en-AU")} formal votes ·
        quota ${c.quota.toLocaleString("en-AU")} (${c.quota_source === "vec" ? "as published by the VEC" : "formal votes ÷ 6, plus 1"})${c.elected.length
        ? ` · elected: ${c.elected.map((n) => escapeHtml(n)).join(", ")}` : ""}</p>
      ${App.quotaBars(groups)}
      <p class="muted small">A group with a full quota (the first tick) wins a seat on its own; the rest are decided by preferences. First preferences only, before the distribution.
        Source: <a href="${escapeHtml(c.url)}" rel="noopener" target="_blank">Victorian Electoral Commission</a>${c.vec_updated ? `, updated ${escapeHtml(c.vec_updated)}` : ""}.</p>
    </section>`;
  }

  /* ---------- Regional polling (council_polls.json) and the contest for the last seat ---------- */
  const QUOTA_PCT = 100 / 6;   // the 2026 Droop quota: one-sixth of the formal vote (plus one vote)
  const regionPolls = (r) => councilPolls.filter((p) => p.regions && p.regions[r.id]);

  // One poll's figures for the region, largest first (OTH is the pollster's combined others, never one party).
  function pollBlock(p, r) {
    const figs = Object.entries(p.regions[r.id]).sort(App.byValue(([, v]) => v, ([k]) => k));
    const max = Math.max(...figs.map(([, v]) => v));
    return `<article class="rp-poll">
      <h3><a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">${escapeHtml(p.pollster)}</a>
        <span class="muted small">${escapeHtml(p.fieldwork_label || "")}${p.published ? `, published ${escapeHtml(fmtDate(p.published))}` : ""}${p.client ? ` for ${escapeHtml(p.client)}` : ""}</span></h3>
      <ul class="vote-bars">${figs.map(([k, v]) => `<li><span class="vb-name">${escapeHtml(k === "OTH" ? "Others (several parties)" : partyName(k))}</span>
        <span class="vb-track"><span class="vb-fill" style="display:block;width:${(100 * v) / max}%;background:var(${partyVar(k)})"></span></span>
        <span class="vb-num">${v.toFixed(1)}%</span></li>`).join("")}</ul>
      ${p.notes ? `<p class="muted small">${escapeHtml(p.notes)}</p>` : ""}
    </article>`;
  }

  // The contest for the last seat on the latest poll, on first preferences: each party's vote in quotas; whole
  // quotas elect members, and the seats left go to the largest remainders. Parties whose remainder is within half
  // a quota of the remainder that takes the last seat are in the contest, largest first. No preference flows: the
  // quota calculator models those.
  function lastSeat(p, r) {
    const fig = p.regions[r.id];
    const total = Object.values(fig).reduce((s, v) => s + v, 0);
    const parties = Object.entries(fig).filter(([k]) => k !== "OTH").map(([k, v]) => {
      const q = ((100 * v) / total) / QUOTA_PCT;
      return { k, v: (100 * v) / total, q, whole: Math.floor(q), rem: q - Math.floor(q) };
    });
    const wholeSeats = parties.reduce((s, x) => s + x.whole, 0);
    const left = 5 - wholeSeats;
    if (left <= 0) return '<p class="muted">On this poll every seat is filled by whole quotas, so there is no contest for the last seat.</p>';
    const byRem = parties.slice().sort(App.byValue((x) => x.rem, (x) => x.k));
    const winner = byRem[left - 1];
    const contest = byRem.filter((x) => Math.abs(x.rem - winner.rem) <= 0.5);
    const seatsOf = (x) => x.whole + (byRem.indexOf(x) < left ? 1 : 0);
    return `<p class="small">On ${escapeHtml(p.pollster)}'s ${escapeHtml(p.fieldwork_label || "")} figures, whole quotas fill ${wholeSeats} of the 5 seats
      (${parties.filter((x) => x.whole).sort(App.byValue((x) => x.whole, (x) => x.k)).map((x) => `${escapeHtml(partyName(x.k))} ${x.whole}`).join(", ") || "none"}).
      The ${left === 1 ? "last seat goes" : `last ${left} seats go`} to the largest part-quotas. ${contest.length > 1 ? `These parties are within half a quota of the one that ${left === 1 ? "takes it" : "takes the last"}, largest part-quota first:` : `${escapeHtml(partyName(winner.k))} takes the last seat, and no other party is within half a quota of it:`}</p>
      <div class="table-scroll"><table class="last-seat">
        <thead><tr><th>Party</th><th class="num">Vote</th><th class="num">Quotas</th><th class="num">Part-quota left</th><th class="num">Gap to the last seat</th><th class="num">Seats on these figures</th></tr></thead>
        <tbody>${contest.map((x) => `<tr${x === winner ? ' class="ls-winner"' : ""}><td style="--party-color: var(${partyVar(x.k)})" class="ls-party">${escapeHtml(partyName(x.k))}${x === winner ? ' <span class="muted small">takes the last seat</span>' : ""}</td>
          <td class="num">${x.v.toFixed(1)}%</td><td class="num">${x.q.toFixed(2)}</td><td class="num">${x.rem.toFixed(2)}</td>
          <td class="num" data-csv="${(x.rem - winner.rem).toFixed(2)}">${x === winner ? "–" : `${x.rem > winner.rem ? "+" : "−"}${Math.abs(x.rem - winner.rem).toFixed(2)} quota`}</td><td class="num">${seatsOf(x)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted small">First preferences only: a quota is one-sixth of the formal vote (16.7%). Preferences decide who really takes the seat, and with optional preferences many votes exhaust; the <a href="#${escapeHtml(r.id)}/quota" data-tab-go="quota">quota calculator</a> models flows and exhaustion. Regional samples are small (see the poll's note), so a gap under a few points is within the poll's error.</p>`;
  }

  function pollsPanel(r) {
    const ps = regionPolls(r);
    if (!ps.length) return '<p class="empty">No published poll gives this region\'s upper-house vote yet.</p>';
    return `<h3 class="rp-h">Contest for the last seat</h3>${lastSeat(ps[0], r)}
      <h3 class="rp-h">Latest regional polling</h3>${ps.map((p) => pollBlock(p, r)).join("")}`;
  }

  const REGION_TABS = ["overview", "groups", "how-to-vote", "polls", "quota"];
  let showTab = null;

  function renderDetail(r, tab = "overview") {
    const el = document.getElementById("region-detail");
    if (!r) {
      el.innerHTML = '<div class="card"><p class="empty">Choose a region above.</p></div>';
      document.title = "Upper House Regions · Vic Election 2026";
      return;
    }
    document.title = `${r.name} Region · Vic Election 2026`;
    const inRegion = districts.filter((d) => d.region === r.id).sort((a, b) => a.name.localeCompare(b.name));
    // Withdrawn tickets stay in regions.json for the record but aren't shown.
    const tickets = (r.tickets || []).filter((t) => t.status !== "withdrawn").sort(ticketSort);
    const TABS = [["overview", "Overview"], ["groups", "Groups and candidates"], ["how-to-vote", "How-to-vote"], ["polls", "Polls"], ["quota", "Quota calculator"]];
    const P = (key, html) => App.tabPanel(key, tab, "region", html);

    el.innerHTML = `
      <div class="card" data-region="${escapeHtml(r.id)}">
        <div class="card-head">
          <h2>${escapeHtml(r.name)}</h2>
          <button class="icon-btn" type="button" id="copy-link">Copy link</button>
        </div>
        <p class="muted small" style="margin-top:0">${r.area === "regional" ? "Country" : "Metropolitan"} region · 5 members</p>
        ${App.tabBar(TABS, tab, "region", `${r.name}: sections`)}
        ${P("overview", `
        ${regionCount(r)}
        <h3>Current MLCs</h3>
        ${(r.mlcs || []).length ? `
          <ul class="people">
            ${r.mlcs.map((m) => `
              <li>
                ${App.avatar(shots, r.id, m.name, m.party)}
                <span class="name">${App.profileLink(r.id, m.name)}${m.retiring ? ' <span class="badge neutral">Retiring</span>' : ""}</span>
                ${partyBadge(m.party)}
                ${m.notes ? `<span class="note muted small">${escapeHtml(m.notes)}</span>` : ""}
              </li>`).join("")}
          </ul>
          ${App.photoCredits(shots, r.mlcs.map((m) => [r.id, m.name]))}` : '<p class="empty">No members recorded.</p>'}
        <div class="card-head"><h3>2026 tickets</h3><span class="muted small">${tickets.length} group${tickets.length === 1 ? "" : "s"}</span></div>
        ${tickets.length ? `
          <div class="tickets">
            ${tickets.map((t) => `
              <div class="ticket${t.status === "withdrawn" ? " is-withdrawn" : ""}" style="--party-color: var(${partyVar(t.party)})">
                <div class="ticket-head">
                  <strong>${t.group ? `Group ${escapeHtml(t.group)} · ` : t.ungrouped ? "Ungrouped · " : ""}${escapeHtml(ticketLabel(t))}</strong>
                  ${statusBadge(t.status)}
                </div>
                ${(t.candidates || []).length
                  ? `<ol class="ticket-people">${t.candidates.map((c, i) => `<li><span class="tp-pos">${i + 1}.</span>${App.isPlaceholder(c) ? `<span>${escapeHtml(c)}</span>` : `${App.avatar(shots, r.id, c, t.party, { size: 28 })}<span>${App.profileLink(r.id, c)}</span>`}</li>`).join("")}</ol>`
                  : '<p class="empty small" style="margin:0">No names confirmed.</p>'}
                ${t.notes ? `<p class="note muted small">${escapeHtml(t.notes)}</p>` : ""}
              </div>`).join("")}
          </div>
          ${App.photoCredits(shots, tickets.flatMap((t) => (t.candidates || []).map((c) => [r.id, c])))}` : '<p class="empty">No tickets recorded yet.</p>'}
        ${tickets.some((t) => t.order_official === false) ? `<p class="muted small">From the VEC's list of nominations. The VEC drew the
          groups' letters and order at 4 pm on Mon 9 Nov and hasn't published them yet: until it does, each party's names are in the order
          reported before nominations closed, then the other nominees in the order they nominated.</p>` : ""}
        ${r.notes ? `<p class="muted small">${escapeHtml(r.notes)}</p>` : ""}
        <h3>Districts in this region</h3>
        ${inRegion.length ? `<div class="chips">${inRegion.map((d) =>
          `<a class="chip" href="lower.html#${escapeHtml(d.id)}" style="text-decoration:none">${escapeHtml(d.name)}</a>`).join("")}</div>`
          : '<p class="empty">No districts in the dataset for this region yet.</p>'}`)}
        ${P("groups", `
        ${vec && vec.regions && vec.regions[r.id] ? `<section id="ballot-order" aria-labelledby="ballot-h">
          <h3 id="ballot-h">Ballot paper: groups and candidates in ballot order</h3>
          ${App.ballotPaper(vec.regions[r.id], "upper")}
        </section>` : '<p class="empty">The VEC\'s list of groups and candidates isn\'t loaded yet.</p>'}
        ${renderExtraCandidates(r)}`)}
        ${P("how-to-vote", `<section id="region-htv" style="min-height:${htvDocs[r.id] ? 0 : App.Htv.reserve(((vec && vec.regions && vec.regions[r.id] && vec.regions[r.id].groups) || []).length + 2)}px">${htvDocs[r.id] ? App.Htv.section(htvDocs[r.id], { h: "h3" }) : ""}</section>`)}
        ${P("polls", pollsPanel(r))}
        ${P("quota", `<section class="quota" id="quota-card" aria-label="Quota calculator"></section>`)}
      </div>`;
    document.getElementById("copy-link").addEventListener("click", (e) => copyLink(e.currentTarget));
    if (!htvDocs[r.id]) {   // fill the reserved space once the region's cards arrive
      App.Htv.load(r.id).then((doc) => { htvDocs[r.id] = doc; }).catch(() => null).then(() => {
        const box = document.getElementById("region-htv");
        if (!box || hashId().split("/")[0] !== r.id) return;
        box.innerHTML = App.Htv.section(htvDocs[r.id] || null, { area: r.id, h: "h3" });
        box.style.minHeight = "";
      });
    }
    if (App.Quota) App.Quota.mount(document.getElementById("quota-card"), r, councilPolls.find((p) => p.regions && p.regions[r.id]));
    showTab = App.initTabs(el.querySelector(".card"), (key, how) => {
      if (how === "user") history.replaceState(null, "", key === "overview" ? `#${r.id}` : `#${r.id}/${key}`);
    });
  }

  // "#northern-victoria" shows a region and "#northern-victoria/<tab>" one of its tabs (groups, how-to-vote, polls,
  // quota); "#quota" asks for a region and then opens its quota calculator (the nav's "Quota calculator" link).
  let quotaMode = false;
  function onHashChange() {
    const [id, sub] = hashId().split("/");
    quotaMode = id === "quota" || sub === "quota";
    const r = regions.find((x) => x.id === id);
    const tab = REGION_TABS.includes(sub) ? sub : "overview";
    const card = document.querySelector("#region-detail [data-region]");
    if (r && showTab && card && card.dataset.region === r.id) { showTab(tab, { how: "hash" }); return; }   // same region, another tab
    renderChips(r ? r.id : "");
    renderDetail(r, tab);
    if (!r && id === "quota") {
      document.getElementById("region-detail").innerHTML =
        '<div class="card"><h2 style="margin-top:0">Quota calculator</h2><p>Choose a region above to open its quota calculator, seeded with the latest regional polling.</p></div>';
    }
    if (r && sub) document.querySelector("#region-detail .tabs").scrollIntoView();
  }

  async function init() {
    try {
      const [rd, dd, cd, shotData, cp, lcData] = await Promise.all([loadJSON("regions"), loadJSON("districts"), loadJSON("candidates"),
        App.loadHeadshots(), loadJSON("council_polls").then((d) => d.polls || []).catch(() => []),
        loadJSON("results_lc").catch(() => null)]);
      vec = await loadJSON("vec_nominations").catch(() => null);
      resultsLc = lcData;
      regions = rd.regions.slice().sort((a, b) => a.name.localeCompare(b.name));
      districts = dd.districts;
      councilCandidates = (cd.candidates || []).filter((c) => c.region && !c.district);
      shots = shotData;
      councilPolls = cp;
      document.getElementById("region-chips").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-id]");
        if (btn) location.hash = quotaMode ? `${btn.dataset.id}/quota` : btn.dataset.id;
      });
      window.addEventListener("hashchange", onHashChange);
      onHashChange();
    } catch (err) {
      window.App.showError(document.getElementById("region-detail"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
