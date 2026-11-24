/* Upper house page: pick one of the 8 regions (via #region-id), show MLCs and tickets. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyName, partyVar, partyBadge, statusBadge, hashId, fmtDate } = App;

  let regions = [];
  let districts = [];
  let councilCandidates = [];
  let shots = {};   // candidate id -> headshot (data/headshots.json)
  const htvDocs = {};       // data/htv/<region>.json (how-to-vote cards), loaded per region
  let councilPolls = [];   // regional upper-house polls (data/council_polls.json), newest first
  let resultsLc = null;    // data/results_lc.json: the 2026 count by region (scripts/results.py), null if missing
  let vec = null;          // data/vec_nominations.json: the VEC's official list (ballot paper), null if missing
  let meta = null;         // data/meta.json (the next key date in At a glance)

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
      return '<p class="r26-wait small">2026 count: from 6 pm Sat 28 Nov.</p>';
    }
    const groups = c.groups.filter((g) => g.quotas >= 0.05);
    return `<section class="region-count" aria-labelledby="rc-h">
      <h3 id="rc-h">2026 count: quotas filled</h3>
      ${App.abcResultsLink("region", r)}
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
  const ui = App.ui;
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // One poll's figures for the region, largest first (OTH is the pollster's combined others, never one party).
  function pollBlock(p, r) {
    const figs = Object.entries(p.regions[r.id]).sort(App.byValue(([, v]) => v, ([k]) => k));
    const max = Math.max(...figs.map(([, v]) => v));
    return `<article class="rp-poll subcard">
      <h5><a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">${escapeHtml(p.pollster)}</a>
        <span class="muted small">${escapeHtml(p.fieldwork_label || "")}${p.client ? ` for ${escapeHtml(p.client)}` : ""}</span></h5>
      <ul class="vote-bars">${figs.map(([k, v]) => `<li><span class="vb-name">${escapeHtml(k === "OTH" ? "Others (several parties)" : partyName(k))}</span>
        <span class="vb-track"><span class="vb-fill" style="display:block;width:${(100 * v) / max}%;background:var(${partyVar(k)})"></span></span>
        <span class="vb-num">${v.toFixed(1)}%</span></li>`).join("")}</ul>
      ${p.notes ? ui.clamp(`<p>${escapeHtml(p.notes)}</p>`, "note") : ""}
    </article>`;
  }

  // The seats on the latest poll, on first preferences: each party's vote in quotas; whole quotas elect members, and
  // the seats left go to the largest remainders. The parties within half a quota of the remainder that takes the
  // last seat are its contest. No preference flows: the quota calculator models those.
  function seatCalc(p, r) {
    const fig = p.regions[r.id];
    const total = Object.values(fig).reduce((s, v) => s + v, 0);
    const parties = Object.entries(fig).filter(([k]) => k !== "OTH").map(([k, v]) => {
      const q = ((100 * v) / total) / QUOTA_PCT;
      return { k, v: (100 * v) / total, q, whole: Math.floor(q), rem: q - Math.floor(q) };
    });
    const wholeSeats = parties.reduce((s, x) => s + x.whole, 0);
    const left = 5 - wholeSeats;
    const byRem = parties.slice().sort(App.byValue((x) => x.rem, (x) => x.k));
    const winner = left > 0 ? byRem[left - 1] : null;
    const contest = winner ? byRem.filter((x) => Math.abs(x.rem - winner.rem) <= 0.5) : [];
    const seatsOf = (x) => x.whole + (left > 0 && byRem.indexOf(x) < left ? 1 : 0);
    // The party nearest the last seat's winner: the closest remainder either side of it.
    const rival = winner ? contest.filter((x) => x !== winner).sort((a, b) => Math.abs(a.rem - winner.rem) - Math.abs(b.rem - winner.rem))[0] : null;
    return { parties, wholeSeats, left, byRem, winner, contest, seatsOf, rival };
  }
  // "On current polling: Labor 2, Liberal 1, One Nation 1; the last seat is between Greens and Legalise Cannabis."
  function quotaSentence(r) {
    const ps = regionPolls(r);
    if (!ps.length) return "No published poll gives this region's upper-house vote yet.";
    const c = seatCalc(ps[0], r);
    const seats = c.parties.map((x) => ({ k: x.k, n: c.seatsOf(x) - (x === c.winner ? 1 : 0) })).filter((x) => x.n > 0).sort(App.byValue((x) => x.n, (x) => x.k));
    const list = seats.map((x) => `${partyName(x.k)} ${x.n}`).join(", ");
    const last = c.winner ? (c.rival ? `the last seat is between ${partyName(c.winner.k)} and ${partyName(c.rival.k)}` : `${partyName(c.winner.k)} takes the last seat`) : "";
    return `On ${ps[0].pollster}'s first preferences${ps[0].fieldwork_label ? ` (${ps[0].fieldwork_label})` : ""}: ${list || "no party has a whole quota"}${last ? `; ${last}` : ""}.`;
  }
  function lastSeat(p, r) {
    const c = seatCalc(p, r);
    if (!c.winner) return '<p class="muted">On this poll every seat is filled by whole quotas, so there is no contest for the last seat.</p>';
    const items = c.contest.map((x) => ({ code: x.k, label: `${escapeHtml(partyName(x.k))}${x === c.winner ? ' <span class="muted small">takes it on these figures</span>' : ""}`,
      value: `${x.rem.toFixed(2)} <span class="muted small">quota left</span>` }));
    return `${ui.rankedList(items, { numbered: false })}
      ${ui.asTable(`<div class="table-scroll"><table class="last-seat">
        <thead><tr><th>Party</th><th class="num">Vote</th><th class="num">Quotas</th><th class="num">Part-quota left</th><th class="num">Gap to the last seat</th><th class="num">Seats on these figures</th></tr></thead>
        <tbody>${c.contest.map((x) => `<tr${x === c.winner ? ' class="ls-winner"' : ""}><td style="--party-color: var(${partyVar(x.k)})" class="ls-party">${escapeHtml(partyName(x.k))}</td>
          <td class="num">${x.v.toFixed(1)}%</td><td class="num">${x.q.toFixed(2)}</td><td class="num">${x.rem.toFixed(2)}</td>
          <td class="num" data-csv="${(x.rem - c.winner.rem).toFixed(2)}">${x === c.winner ? "–" : `${x.rem > c.winner.rem ? "+" : "−"}${Math.abs(x.rem - c.winner.rem).toFixed(2)} quota`}</td><td class="num">${c.seatsOf(x)}</td></tr>`).join("")}</tbody></table></div>`)}
      ${ui.clamp(`<p>First preferences only: a quota is one-sixth of the formal vote (16.7%). Whole quotas fill ${c.wholeSeats} of the 5 seats and the rest go to the largest part-quotas;
        these are the parties within half a quota of the one that takes the last seat. Preferences decide who really takes it, and with optional preferences many votes exhaust:
        the <a href="#${escapeHtml(r.id)}/quota" data-sec-go="quota">quota calculator</a> models flows and exhaustion. Regional samples are small, so a gap under a few points is within the poll's error.</p>`, "note")}`;
  }

  function pollsPanel(r) {
    const ps = regionPolls(r);
    if (!ps.length) return '<p class="lead">No published poll gives this region\'s upper-house vote yet.</p>';
    return `<p class="lead">${escapeHtml(quotaSentence(r))}</p>
      <h4 class="rp-h">Contest for the last seat</h4>${lastSeat(ps[0], r)}
      <h4 class="rp-h">Latest regional polling</h4>${ps.map((p) => pollBlock(p, r)).join("")}`;
  }

  // The region's sections, in page order: [key, title]. "overview" (the old first tab) is At a glance.
  const REGION_SECTIONS = [["groups", "Groups and candidates"], ["how-to-vote", "How-to-vote"], ["polls", "Polls"],
    ["quota", "Quota calculator"], ["districts", "Districts"]];
  const SECTION_KEYS = REGION_SECTIONS.map(([k]) => k);
  let regionSecs = null;   // the open region's App.initSections controller

  // The one-line summaries under each collapsed section's title.
  function ballotCounts(r) {
    const e = vec && vec.regions && vec.regions[r.id];
    if (!e) return null;
    return { groups: (e.groups || []).length, ungrouped: (e.candidates || []).filter((c) => !c.group).length, candidates: (e.candidates || []).length };
  }
  function groupsSummary(r) {
    const b = ballotCounts(r);
    if (!b) return "The VEC's list isn't loaded";
    return `${plural(b.groups, "group")}, ${b.candidates} candidates`;
  }
  function htvSummary(doc) {
    if (doc === undefined) return "Loading the VEC's register…";
    if (!doc) return "The VEC's register isn't available right now";
    const n = (doc.cards || []).length;
    return n ? `${plural(n, "card")} registered` : "No cards registered";
  }
  function pollsSummary(r) {
    const ps = regionPolls(r);
    return ps.length ? `Latest: ${ps[0].pollster}${ps[0].fieldwork_label ? `, ${ps[0].fieldwork_label}` : ""}` : "No regional poll published yet";
  }

  // "At a glance": a headline from the MLCs and the ballot, three tiles, the MLCs as person cards.
  function glanceBlock(r, inRegion) {
    const kn = App.keyDateNext(meta);
    const b = ballotCounts(r);
    const mlcs = r.mlcs || [];
    const byParty = {};
    mlcs.forEach((m) => { byParty[m.party] = (byParty[m.party] || 0) + 1; });
    const held = Object.keys(byParty).sort(App.byValue((k) => byParty[k], (k) => k)).map((k) => `${byParty[k]} ${partyName(k)}`).join(", ");
    const retiring = mlcs.filter((m) => m.retiring).length;
    return `<section class="glance" id="region-glance" aria-labelledby="glance-h">
      <h3 class="glance-h" id="glance-h">At a glance</h3>
      <p class="lead glance-lead">${r.area === "regional" ? "Country" : "Metropolitan"} region electing 5 members. Held now by ${escapeHtml(held || "no recorded members")}${retiring ? `; ${retiring} retiring` : ""}.</p>
      ${ui.tiles([
        { value: b ? String(b.groups) : "–", label: "Groups", sub: '<button type="button" class="link-btn" data-sec-go="groups">See them</button>' },
        { value: b ? String(b.candidates) : "–", label: "Candidates", sub: b && b.ungrouped ? `${b.ungrouped} ungrouped` : "" },
        { value: "16.7%", label: "A quota", sub: '<button type="button" class="link-btn" data-sec-go="quota">Calculator</button>' },
      ])}
      ${regionCount(r)}
      <h4 class="glance-sub">Current MLCs</h4>
      <div id="region-mlcs">${mlcBlock(r)}</div>
      <ul class="meta-list">
        <li><span class="ml-k">Districts</span><span class="ml-v"><button type="button" class="link-btn" data-sec-go="districts">${plural(inRegion.length, "Assembly district")}</button></span></li>
        ${kn ? `<li><span class="ml-k">${kn.label === "Today" ? "Today" : "Next"}</span><span class="ml-v">${escapeHtml(kn.text)}</span></li>` : ""}
      </ul>
      ${r.notes ? ui.clamp(`<p>${escapeHtml(r.notes)}</p>`, "note") : ""}
    </section>`;
  }

  // The MLCs as person cards; photos (headshots.json) arrive after the first paint at the same size as the initials.
  function mlcBlock(r) {
    const mlcs = r.mlcs || [];
    if (!mlcs.length) return '<p class="empty">No members recorded.</p>';
    const credits = App.photoCredits(shots, mlcs.map((m) => [r.id, m.name]));
    return `<ul class="pcards">${mlcs.map((m) => `<li>${ui.personCard({
        avatar: App.avatar(shots, r.id, m.name, m.party), name: App.profileLink(r.id, m.name), code: m.party, party: partyName(m.party),
        extra: m.retiring ? ' <span class="badge neutral">Retiring</span>' : "" })}</li>`).join("")}</ul>
      ${credits ? `<details class="rl-more credits"><summary>Photo credits</summary>${credits}</details>` : ""}`;
  }

  // Group cards in ballot order (the VEC's draw): the letter, the group's name and party, its candidates in order.
  function groupCards(r, e) {
    const cands = e.candidates || [];
    const card = (letter, label, code, list) => `<li class="gcard" style="--party-color: var(${partyVar(code)})">
      <div class="gc-head">${letter ? `<span class="gc-letter">${escapeHtml(letter)}</span>` : ""}<span class="gc-name">${escapeHtml(label)}</span>${code && code !== "OTH" && code !== "IND" ? ui.chip(code, App.partyShort(code)) : ""}</div>
      ${ui.rankedList(list.map((c) => ({ code: c.party, label: `${App.profileLink(r.id, c.name)}${c.party !== code ? ` <span class="muted small">${escapeHtml(c.party_label || partyName(c.party))}</span>` : ""}` })),
        { show: 3, more: `All ${list.length} candidates` })}</li>`;
    const groups = (e.groups || []).map((g) => card(g.group, !g.label || /^unnamed/i.test(g.label) ? "Group with no name" : g.label, g.party,
      cands.filter((c) => c.group === g.group).sort((a, b) => (a.group_position || 0) - (b.group_position || 0))));
    const loose = cands.filter((c) => !c.group).sort((a, b) => a.ballot_position - b.ballot_position);
    return `<p class="lead">${plural((e.groups || []).length, "group")}${loose.length ? ` and ${plural(loose.length, "ungrouped candidate")}` : ""}, in the order the VEC drew for the ballot paper.</p>
      <ul class="gcards">${groups.join("")}${loose.length ? card("", "Ungrouped", "OTH", loose) : ""}</ul>
      ${e.ballot_drawn ? "" : '<p class="small muted">The VEC hasn\'t published the draw yet, so these are in the order the candidates nominated.</p>'}
      ${ui.linkCard(e.url, "VEC nominations", "The official list for this region", true)}`;
  }

  function renderDetail(r, want = "") {
    const el = document.getElementById("region-detail");
    const bar = document.getElementById("region-jump");
    if (regionSecs) { regionSecs.destroy(); regionSecs = null; }
    if (!r) {
      el.innerHTML = '<div class="card"><p class="empty">Choose a region above.</p></div>';
      document.title = "Upper House Regions · Vic Election 2026";
      return;
    }
    document.title = `${r.name} Region · Vic Election 2026`;
    const inRegion = districts.filter((d) => d.region === r.id).sort((a, b) => a.name.localeCompare(b.name));
    // Phones open only the section a link names; wider screens open them all.
    const wide = !App.phoneView();
    const S = (key, title, sum, html) => App.section("rsec", key, title, sum, html, wide || key === want);
    const T = Object.fromEntries(REGION_SECTIONS);
    const vecEntry = vec && vec.regions && vec.regions[r.id];

    el.innerHTML = `
      <div class="card" data-region="${escapeHtml(r.id)}">
        <div class="card-head">
          <h2>${escapeHtml(r.name)}</h2>
          <div class="card-actions">
            ${App.moreMenu("region-more", "More: links", [
              vecEntry && vecEntry.url ? `<a href="${escapeHtml(vecEntry.url)}" target="_blank" rel="noopener">VEC nominations ↗</a>` : "",
              '<button type="button" data-copy-link>Copy link</button>',
            ].filter(Boolean))}
          </div>
        </div>
        ${glanceBlock(r, inRegion)}
        <div class="secs">
        ${S("groups", T.groups, escapeHtml(groupsSummary(r)), `${vecEntry ? groupCards(r, vecEntry) : '<p class="empty">The VEC\'s list of groups and candidates isn\'t loaded yet.</p>'}
          <div id="region-extra">${renderExtraCandidates(r)}</div>`)}
        ${S("how-to-vote", T["how-to-vote"], escapeHtml(htvSummary(htvDocs[r.id])), `<div id="region-htv" style="min-height:${htvDocs[r.id] !== undefined ? 0 : 360}px">${htvDocs[r.id] !== undefined ? htvView(r, htvDocs[r.id]) : ""}</div>`)}
        ${S("polls", T.polls, escapeHtml(pollsSummary(r)), pollsPanel(r))}
        ${S("quota", T.quota, "Model the five seats from polling", `<p class="lead">${escapeHtml(quotaSentence(r))}</p>
          <p class="small muted">Change the votes, preference flows and exhaustion below to see how the five seats could fill.</p>
          <section class="quota" id="quota-card" aria-label="Quota calculator"></section>`)}
        ${S("districts", T.districts, escapeHtml(plural(inRegion.length, "Assembly district")), inRegion.length ? `<p class="lead">${plural(inRegion.length, "Assembly district")} make up ${escapeHtml(r.name)} Region.</p><div class="chips">${inRegion.map((d) =>
          `<a class="chip" href="lower.html#${escapeHtml(d.id)}" style="text-decoration:none">${escapeHtml(d.name)}</a>`).join("")}</div>`
          : '<p class="empty">No districts in the dataset for this region yet.</p>')}
        </div>
      </div>`;
    bar.innerHTML = App.jumpPills(REGION_SECTIONS.map(([k, t]) => [k, k === "groups" ? "Groups" : k === "quota" ? "Quota" : t]), (key) => `#${r.id}/${key}`);
    if (htvDocs[r.id] === undefined) {   // fill the reserved space once the region's cards arrive
      App.Htv.load(r.id).then((doc) => { htvDocs[r.id] = doc; }).catch(() => { htvDocs[r.id] = null; }).then(() => {
        const box = document.getElementById("region-htv");
        if (!box || hashId().split("/")[0] !== r.id) return;
        box.innerHTML = htvView(r, htvDocs[r.id]);
        ui.initClamps(box);
        box.style.minHeight = "";
        App.setSectionSummary(el, "how-to-vote", escapeHtml(htvSummary(htvDocs[r.id])));
      });
    }
    if (App.Quota) App.Quota.mount(document.getElementById("quota-card"), r, councilPolls.find((p) => p.regions && p.regions[r.id]));
    const card = el.querySelector(".card");
    regionSecs = App.initSections(card, {
      bar, glance: document.getElementById("region-glance"),
      onHash: (key, k) => {
        if (key) history.replaceState(null, "", `#${r.id}/${key}`);
        else if (hashId().split("/")[1] === k) history.replaceState(null, "", `#${r.id}`);
      },
    });
    ui.initClamps(el);
  }

  // Above-the-line how-to-vote cards as ranked lists, chips sorted by the latest regional poll's figure (a Coalition
  // card by the joint figure), placing the poll's three largest parties.
  function htvView(r, doc) {
    const p = regionPolls(r)[0];
    const fig = (p && p.regions[r.id]) || {};
    const val = (code) => (fig[code] != null ? fig[code] : ["LIB", "NAT"].includes(code) && fig.LNP != null ? fig.LNP : null);
    const contenders = Object.keys(fig).filter((k) => k !== "OTH").sort(App.byValue((k) => fig[k], (k) => k)).slice(0, 3);
    return App.Htv.cardsView(doc, { vote: (card) => (card.kind === "party" ? val(card.party) : null), contenders, area: r.id });
  }

  // "#northern-victoria" shows a region and "#northern-victoria/<section>" opens one of its sections and scrolls to it
  // (groups, how-to-vote, polls, quota, districts); "#quota" asks for a region and then opens its quota calculator
  // (the nav's "Quota calculator" link).
  let quotaMode = false;
  function onHashChange() {
    const [id, sub] = hashId().split("/");
    quotaMode = id === "quota" || sub === "quota";
    const r = regions.find((x) => x.id === id);
    const want = SECTION_KEYS.includes(sub) ? sub : "";
    const card = document.querySelector("#region-detail [data-region]");
    if (r && regionSecs && card && card.dataset.region === r.id) {   // same region, another section
      if (want) regionSecs.open(want);
      else card.scrollIntoView({ block: "start" });
      return;
    }
    renderChips(r ? r.id : "");
    renderDetail(r, want);
    if (!r && id === "quota") {
      document.getElementById("region-detail").innerHTML =
        '<div class="card"><h2 style="margin-top:0">Quota calculator</h2><p>Choose a region above to open its quota calculator, seeded with the latest regional polling.</p></div>';
    }
    if (r && want) App.afterPaint(() => { if (hashId().split("/")[1] === want && regionSecs) regionSecs.open(want); });
  }

  async function init() {
    try {
      // What the region panel needs, in parallel. Photos and the candidate list (only for names reported elsewhere
      // that aren't on a ticket) wait until it has painted: together they are over 1 MB.
      const [rd, dd, cp, lcData, metaData, vecData] = await Promise.all([loadJSON("regions"), loadJSON("districts"),
        loadJSON("council_polls").then((d) => d.polls || []).catch(() => []), loadJSON("results_lc").catch(() => null),
        loadJSON("meta").catch(() => null), loadJSON("vec_nominations").catch(() => null)]);
      meta = metaData;
      vec = vecData;
      resultsLc = lcData;
      regions = rd.regions.slice().sort((a, b) => a.name.localeCompare(b.name));
      districts = dd.districts;
      councilPolls = cp;
      document.getElementById("region-chips").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-id]");
        if (btn) location.hash = quotaMode ? `${btn.dataset.id}/quota` : btn.dataset.id;
      });
      window.addEventListener("hashchange", onHashChange);
      onHashChange();
      App.afterPaint(() => Promise.all([App.loadHeadshots(), loadJSON("candidates").catch(() => ({ candidates: [] }))])).then(([shotData, cd]) => {
        shots = shotData;
        councilCandidates = (cd.candidates || []).filter((c) => c.region && !c.district);
        const r = regions.find((x) => x.id === hashId().split("/")[0]);
        if (!r || !document.getElementById("region-mlcs")) return;
        document.getElementById("region-mlcs").innerHTML = mlcBlock(r);
        document.getElementById("region-extra").innerHTML = renderExtraCandidates(r);
      });
    } catch (err) {
      window.App.showError(document.getElementById("region-detail"), err);
    }
  }

  // Scripts are deferred, so the page is usually parsed by now: start loading at once.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
