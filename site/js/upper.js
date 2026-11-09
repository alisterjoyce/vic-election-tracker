/* Upper house page: pick one of the 8 regions (via #region-id), show MLCs and tickets. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyName, partyVar, partyBadge, statusBadge, hashId, copyLink } = App;

  let regions = [];
  let districts = [];
  let councilCandidates = [];
  let shots = {};   // candidate id -> headshot (data/headshots.json)
  let htv = null;           // data/htv.json (how-to-vote cards)
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
    return partyName(a.party).localeCompare(partyName(b.party));
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
    const parties = Object.keys(byParty).sort((a, b) => partyName(a).localeCompare(partyName(b)));
    return `
      <div class="card">
        <div class="card-head"><h2>Other announced candidates</h2><span class="muted small">${rows.length} name${rows.length === 1 ? "" : "s"}</span></div>
        <p class="muted small" style="margin-top:0">Names reported elsewhere (mostly Wikipedia) that aren't on the tickets above yet. Numbers are the reported ticket positions.</p>
        <div class="tickets">
          ${parties.map((p) => `
            <div class="ticket" style="--party-color: var(${partyVar(p)})">
              <div class="ticket-head"><strong>${escapeHtml(partyName(p))}</strong></div>
              <ul class="people">
                ${byParty[p].sort((a, b) => (a.ticket_position || 99) - (b.ticket_position || 99)).map((c) => `
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

  function renderDetail(r) {
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

    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>${escapeHtml(r.name)}</h2>
          <button class="icon-btn" type="button" id="copy-link">Copy link</button>
        </div>
        <p class="muted small" style="margin-top:0">${r.area === "regional" ? "Regional" : "Metropolitan"} region · 5 members</p>
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
      </div>

      <div class="card">
        <div class="card-head"><h2>2026 tickets</h2><span class="muted small">${tickets.length} group${tickets.length === 1 ? "" : "s"}</span></div>
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
        ${r.notes ? `<p class="muted small" style="margin-bottom:0">${escapeHtml(r.notes)}</p>` : ""}
      </div>

      ${vec && vec.regions && vec.regions[r.id] ? `<section class="card" id="ballot-order" aria-labelledby="ballot-h">
        <h2 id="ballot-h">Ballot paper</h2>
        ${App.ballotPaper(vec.regions[r.id], "upper")}
      </section>` : ""}

      ${renderExtraCandidates(r)}

      ${App.Htv ? `<section class="card">${App.Htv.section(htv, { region: r.id, parties: tickets.map((t) => t.party) })}</section>` : ""}

      <section class="card quota" id="quota-card" aria-label="Quota calculator"></section>

      <div class="card">
        <h2>Districts in this region</h2>
        ${inRegion.length ? `<div class="chips">${inRegion.map((d) =>
          `<a class="chip" href="lower.html#${escapeHtml(d.id)}" style="text-decoration:none">${escapeHtml(d.name)}</a>`).join("")}</div>`
          : '<p class="empty">No districts in the dataset for this region yet.</p>'}
      </div>`;
    document.getElementById("copy-link").addEventListener("click", (e) => copyLink(e.currentTarget));
    if (App.Quota) App.Quota.mount(document.getElementById("quota-card"), r, councilPolls.find((p) => p.regions && p.regions[r.id]));
  }

  // "#northern-victoria" shows a region; "#quota" asks for a region and "#northern-victoria/quota"
  // opens that region at its quota calculator (the nav's "Quota calculator" link).
  let quotaMode = false;
  function onHashChange() {
    const [id, sub] = hashId().split("/");
    quotaMode = id === "quota" || sub === "quota";
    const r = regions.find((x) => x.id === id);
    renderChips(r ? r.id : "");
    renderDetail(r);
    if (!r && id === "quota") {
      document.getElementById("region-detail").innerHTML =
        '<div class="card"><h2 style="margin-top:0">Quota calculator</h2><p>Choose a region above to open its quota calculator, seeded with the latest regional polling.</p></div>';
    }
    if (r && sub === "quota") document.getElementById("quota-card").scrollIntoView();
  }

  async function init() {
    try {
      const [rd, dd, cd, shotData, cp, htvData, lcData] = await Promise.all([loadJSON("regions"), loadJSON("districts"), loadJSON("candidates"),
        App.loadHeadshots(), loadJSON("council_polls").then((d) => d.polls || []).catch(() => []), loadJSON("htv").catch(() => null),
        loadJSON("results_lc").catch(() => null)]);
      vec = await loadJSON("vec_nominations").catch(() => null);
      resultsLc = lcData;
      regions = rd.regions.slice().sort((a, b) => a.name.localeCompare(b.name));
      districts = dd.districts;
      councilCandidates = (cd.candidates || []).filter((c) => c.region && !c.district);
      shots = shotData;
      councilPolls = cp;
      htv = htvData;
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
