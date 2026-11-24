/* Lower house page: filter districts, show the selected one (selected via #district-id). The seat panel is "At a
   glance" then collapsible sections, each led by a one-sentence answer and a simple visual built from the shared
   card styles (common.js App.ui), with detail behind a tap and tables only on wider screens. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyBadge, partyShort, partyName, statusBadge, fmtDate } = window.App;
  const ui = App.ui;
  // "#bendigo-west" or "#bendigo-west/<section>" (e.g. "/candidates"): the district, then the section to open and
  // scroll to. The Voting page's "#<district>/where-to-vote" links open the Voting section; "/overview" (the old
  // first tab) is the top of the seat.
  const hashId = () => App.hashId().split("/")[0];
  const hashSection = () => App.hashId().split("/")[1] || "";
  const SECTION_KEYS = ["candidates", "how-to-vote", "forecasts", "voting", "results", "news"];
  const sectionFromHash = () => { const s = hashSection(); return s === "where-to-vote" ? "voting" : SECTION_KEYS.includes(s) ? s : ""; };
  let seatSecs = null;   // the open seat's App.initSections controller
  let meta = null;      // data/meta.json (the next key date in At a glance)

  let districts = [];
  let candidates = [];
  let regionsById = {};
  // Seat outlook inputs: statewide swing, seat models, betting, seat polls.
  let outlook = { swing: null, models: null, odds: null, seatPolls: null };
  let shots = {};   // candidate id -> headshot (data/headshots.json); filled in after the first paint
  const htvDocs = {};   // data/htv/<district>.json (how-to-vote cards), loaded per seat
  const profileDocs = {};   // data/profiles/<district>.json, loaded per seat after the first paint
  let news;         // data/news.json (headlines per seat); undefined until loaded, null if it failed
  let results = null;   // data/results.json: the 2026 count (scripts/results.py), null if missing
  let pbDiffs = {};     // district id -> where The Poll Bludger's guide lists a different margin (data/pollbludger_margins.json)
  let fcNow = null;     // the open seat's App.Forecasts.build result (the how-to-vote cards' contenders)

  const $ = (id) => document.getElementById(id);
  const fmt1 = (n) => Number(n).toFixed(1);
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  function marginLabel(pct) {
    if (pct == null) return "";
    if (pct < 6) return "Marginal";
    if (pct < 10) return "Fairly safe";
    return "Safe";
  }
  // The ABC's classification ("Very Safe Labor") when we have it.
  const seatLabel = (d) => d.classification || marginLabel(d.margin && d.margin.pct);
  // The classification without the party ("Marginal", "Very Safe"): the margin tile's colour edge shows the party.
  const bandOf = (d) => { const l = seatLabel(d), p = partyName(d.party); return l.endsWith(` ${p}`) ? l.slice(0, -p.length - 1) : l; };
  // The Poll Bludger's guide page for a seat: its own menu's ids are the names with spaces removed (all 88 checked 23 Nov 2026).
  const pbUrl = (d) => `https://pollbludger.net/vic2026/LA.htm?s=${encodeURIComponent(d.name.replace(/ /g, ""))}`;
  function marginText(m) {
    if (!m || m.pct == null) return "–";
    return `${escapeHtml(partyShort(m.party))} ${Number(m.pct).toFixed(1)}%${m.vs ? ` vs ${escapeHtml(partyShort(m.vs))}` : ""}`;
  }
  // "Poll Bludger: GRN 12.0% vs LIB (2CP)" under the margin, only where the guide's figure differs from ours.
  function pbNote(d) {
    const x = pbDiffs[d.id];
    if (!x || !x.theirs) return "";
    const t = x.theirs;
    return `<p class="small pb-note">Our margin is ${marginText(d.margin)}; Poll Bludger lists <a href="${escapeHtml(t.url || pbUrl(d))}" target="_blank" rel="noopener">${marginText(t)}</a>
      (${escapeHtml(t.basis || "")}${t.asterisk ? ", marked * on its list" : ""}).</p>`;
  }

  /* ---------- Filters and the district list ---------- */
  function filtered() {
    const region = $("f-region").value;
    const area = $("f-area").value;
    return districts.filter((d) => (!region || d.region === region) && (!area || d.area === area));
  }

  function renderDistrictOptions() {
    const sel = $("f-district");
    const current = hashId();
    const list = filtered();
    sel.innerHTML = '<option value="">Choose a district…</option>' +
      list.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join("");
    sel.value = list.some((d) => d.id === current) ? current : "";
  }

  function renderList() {
    const list = filtered();
    const current = hashId();
    $("list-count").textContent = `${list.length} of ${districts.length} shown`;
    if (!list.length) {
      $("district-list").innerHTML = '<p class="empty">No districts match these filters.</p>';
      return;
    }
    $("district-list").innerHTML = `
      <table>
        <thead><tr><th><span class="sr-only">My seats</span></th><th>District</th><th>Region</th><th>Held by</th><th class="num">Margin</th><th>Seat</th></tr></thead>
        <tbody>
          ${list.map((d) => `
            <tr class="clickable${d.id === current ? " selected" : ""}" data-id="${escapeHtml(d.id)}">
              <td class="star-cell">${App.starButton(d.id, d.name)}</td>
              <td><a href="#${escapeHtml(d.id)}">${escapeHtml(d.name)}</a></td>
              <td>${escapeHtml(regionsById[d.region] ? regionsById[d.region].name : d.region)}</td>
              <td>${partyBadge(d.party, { full: false })}</td>
              <td class="num">${d.margin && d.margin.pct != null ? Number(d.margin.pct).toFixed(1) : "–"}</td>
              <td>${escapeHtml(seatLabel(d))}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  }

  const isInactive = (c) => c.status === "withdrawn" || c.status === "superseded" || c.status === "not_standing";
  // Superseded, withdrawn and not-standing rows stay in candidates.json for the record but aren't shown (a candidate
  // who didn't nominate is "withdrawn"). Ballot order, else surname (App.candidateOrder).
  const seatCands = (d) => candidates.filter((c) => c.district === d.id && !isInactive(c)).sort(App.candidateOrder);

  /* ---------- Sections and their one-line summaries ---------- */
  const sectionList = (live) => [["candidates", "Candidates"], ["how-to-vote", "How-to-vote"], ["forecasts", "Forecasts"],
    ["voting", "Voting"], ["results", live ? "Results" : "2022 results"], ["news", "News"]];
  function candSummary(cands) {
    if (!cands.length) return "None recorded yet";
    return cands.some((c) => c.ballot_position != null) ? `${cands.length} on the ballot` : plural(cands.length, "candidate");
  }
  function htvSummary(doc) {
    if (doc === undefined) return "Loading the VEC's register…";
    if (!doc) return "The VEC's register isn't available right now";
    const n = (doc.cards || []).length;
    return n ? `${plural(n, "card")} registered` : "No cards registered";
  }
  function newsSummary(d) {
    if (news === undefined) return "Loading headlines…";
    const n = ((news && news.seats && news.seats[d.id]) || []).length;
    return n ? plural(n, "recent headline") : "No recent headlines";
  }
  function liveSummary(live) {
    const l = live.leader;
    if (!l) return "No votes counted yet";
    const who = `${partyName(l.party)} (${l.name})`;
    if (live.called_by === "vec") return `Declared by the VEC: ${who}`;
    if (live.status === "called") return `Called by this site: ${who}`;
    return `Leading: ${who}, ${(live.counted_pct || 0).toFixed(1)}% counted`;
  }
  // The 2CP of a vec-contest-v1 count, winner first: [[candidate, share], [candidate, share]] or null.
  function finalPair(r) {
    const cand = Object.fromEntries((r.candidates || []).map((c) => [c.id, c]));
    const dist = r.distribution && Object.keys(r.distribution.candidates || {}).length === 2 ? r.distribution.candidates : null;
    const pair = Object.entries(dist || (r.tcp && r.tcp.candidates) || {}).sort((a, b) => b[1] - a[1]);
    if (pair.length !== 2) return null;
    const total = pair[0][1] + pair[1][1];
    return pair.map(([id, v]) => [cand[id], (100 * v) / total]);
  }
  // "Labor won 54.6–45.4 v Liberal", from the 2022 count (results_2022/<id>.json, which the Forecasts block loads too).
  async function resultsSummary(d) {
    let text = "Not available for this district";
    try {
      const r = await loadJSON(`results_2022/${d.id}`);
      const p = finalPair(r);
      if (p) {
        const year = r.event && r.event.date && !/^State Election 2022/.test(r.event.name || "") ? ` (${r.event.date.slice(0, 4)} poll)` : "";
        text = `${partyName(p[0][0].party)} won ${fmt1(p[0][1])}–${fmt1(p[1][1])} v ${partyName(p[1][0].party)}${year}`;
      }
    } catch (e) { /* the panel says so too */ }
    if (hashId() === d.id) App.setSectionSummary($("district-detail"), "results", escapeHtml(text));
  }

  /* ---------- At a glance ---------- */
  // "Sources split between Liberal and One Nation." / "All 3 sources favour Nationals." from the forecast summary.
  function forecastSentence(fc) {
    if (!fc.favs.length) return "No forecast rates this seat yet.";
    const m = /^Sources split: (.*)$/.exec(fc.short || "");
    if (m) {
      const ps = m[1].split(" or ");
      return `Sources split between ${ps.length > 2 ? `${ps.slice(0, -1).join(", ")} and ${ps[ps.length - 1]}` : ps.join(" and ")}.`;
    }
    return `${fc.short}.`;
  }
  // The median win chances as one bar: scaled to 100% when they add to more, "Anyone else" taking any remainder.
  function medianSegs(fc) {
    const segs = fc.meds.map((m) => ({ ...m }));
    const total = segs.reduce((s, m) => s + m.value, 0);
    if (total > 100) segs.forEach((m) => { m.value = (100 * m.value) / total; });
    else if (100 - total >= 0.5) segs.push({ code: "OTH", label: "Anyone else", value: 100 - total });
    return segs;
  }
  function glanceBlock(d, region, cands, fc, live) {
    const kn = App.keyDateNext(meta);
    const top = fc.meds[0];
    const mp = d.sitting_mp ? `${escapeHtml(d.sitting_mp)}${d.retiring ? ' <span class="badge neutral">Retiring</span>' : ""}` : "–";
    const headline = `${escapeHtml(partyName(d.party))}-held${d.retiring ? ", MP retiring" : cands.some((c) => c.incumbent) ? ", MP recontesting" : ""}. ${escapeHtml(forecastSentence(fc))}`;
    return `<section class="glance" id="seat-glance" aria-labelledby="glance-h">
      <h3 class="glance-h" id="glance-h">At a glance</h3>
      <p class="lead glance-lead">${headline}</p>
      ${ui.tiles([
        { value: d.margin && d.margin.pct != null ? `${fmt1(d.margin.pct)}%` : "–", label: "Margin", sub: escapeHtml(bandOf(d)), code: d.margin && d.margin.party },
        { value: String(cands.length), label: cands.some((c) => c.ballot_position != null) ? "On the ballot" : "Candidates", sub: '<button type="button" class="link-btn" data-sec-go="candidates">See them</button>' },
        top ? { value: `${Math.round(top.value)}%`, label: "Top forecast", sub: ui.chip(top.code, top.label), code: top.code } : { value: "–", label: "Top forecast", sub: "None yet" },
      ])}
      ${fc.meds.length ? ui.probBar(medianSegs(fc), { label: "Median win chance across the sources", sub: '<button type="button" class="link-btn" data-sec-go="forecasts">By source</button>' }) : ""}
      <ul class="meta-list">
        <li><span class="ml-k">MP</span><span class="ml-v">${mp}</span></li>
        <li><span class="ml-k">Region</span><span class="ml-v">${region ? `<a href="upper.html#${escapeHtml(region.id)}">${escapeHtml(region.name)}</a>` : escapeHtml(d.region)} <span class="muted small">${d.area === "regional" ? "Regional" : "Metro"}</span></span></li>
        ${kn ? `<li><span class="ml-k">${kn.label === "Today" ? "Today" : "Next"}</span><span class="ml-v">${escapeHtml(kn.text)}</span></li>` : ""}
      </ul>
      ${pbNote(d)}
      ${live ? `<p class="r26-wait small"><strong>2026 count:</strong> ${statusLine(live)} <button type="button" class="link-btn" data-sec-go="results">Full results</button></p>`
        : results ? '<p class="r26-wait small">2026 count: from 6 pm Sat 28 Nov.</p>' : ""}
      ${d.notes || d.region_note ? ui.clamp([d.notes, d.region_note].filter(Boolean).map((t) => `<p>${escapeHtml(t)}</p>`).join(""), "note") : ""}
    </section>`;
  }

  /* ---------- Candidates: a person card each, in ballot order ---------- */
  const LINK_LABELS = { party_page: "Party page", website: "Website", facebook: "Facebook", instagram: "Instagram", x: "X", twitter: "X",
    linkedin: "LinkedIn", youtube: "YouTube", tiktok: "TikTok", parliament: "Parliament", wikipedia: "Wikipedia", abc: "ABC guide" };
  function profileLine(c, pr) {
    if (!pr) return "No researched profile yet";
    if (pr.occupation && pr.occupation.text) return escapeHtml(pr.occupation.text);
    const role = (pr.prior_roles || []).find((r) => r.to == null && !r.ended) || (pr.prior_roles || [])[0];
    if (role) return escapeHtml(`${role.role}${role.organisation ? `, ${role.organisation}` : ""}`);
    // A summary sentence that says more than that they are standing; else a pointer to the profile.
    const said = ((pr.summary && pr.summary.text) || "").split(/(?<=\.)\s+/).find((x) => !/(candidate|standing|stands|contesting|nominat)/i.test(x));
    return said ? escapeHtml(said) : "Tap for their profile";
  }
  function profileBody(d, c, pr) {
    const id = App.candidateId(d.id, c.name);
    const seen = new Set();
    const links = pr ? Object.entries(pr.links || {}).filter(([, url]) => url && !seen.has(url) && seen.add(url)).slice(0, 4)
      .map(([k, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(LINK_LABELS[k] || k)} ↗</a>`) : [];
    return `${pr && pr.summary ? `<p>${escapeHtml(pr.summary.text)}</p>` : '<p class="muted">No researched profile yet.</p>'}
      <div class="btn-row"><a href="candidate.html#${escapeHtml(id)}">${pr ? "Full profile and sources" : "Candidate page"} →</a>${links.join("")}</div>`;
  }
  function candidatesBlock(d, cands) {
    if (!cands.length) return '<p class="empty">No candidates recorded yet.</p>';
    const doc = profileDocs[d.id];
    const profiles = (doc && doc.profiles) || {};
    const cards = cands.map((c) => {
      const pr = profiles[App.candidateId(d.id, c.name)];
      return `<li>${ui.personCard({
        badge: c.ballot_position, avatar: App.avatar(shots, d.id, c.name, c.party), name: escapeHtml(c.name),
        code: c.party, party: c.party === "OTH" && c.party_name ? c.party_name : partyName(c.party),
        extra: `${c.incumbent ? ' <span class="badge neutral">Sitting MP</span>' : ""}${c.status !== "vec_nominated" ? ` ${statusBadge(c.status)}` : ""}`,
        line: doc === undefined ? "&nbsp;" : profileLine(c, pr),
        body: profileBody(d, c, pr),
      })}</li>`;
    }).join("");
    const credits = App.photoCredits(shots, cands.map((c) => [d.id, c.name]));
    return `<p class="lead">${cands.length} candidates, in ballot order. Tap one for their profile.</p>
      <ul class="pcards">${cards}</ul>
      ${credits ? `<details class="rl-more credits"><summary>Photo credits</summary>${credits}</details>` : ""}`;
  }

  /* ---------- Forecasts ---------- */
  function forecastsBody(d, fc) {
    const s = outlook.swing;
    const adj = App.swingAdjusted(d.margin, s);
    const swingCell = !s ? '<span class="muted">Not available: no two-party-preferred polling.</span>'
      : !adj ? '<span class="muted">Not available: this isn\'t a Labor-Coalition contest.</span>'
      : `<strong>${escapeHtml(adj.before)} → ${escapeHtml(adj.after)}</strong> <span class="muted small">on a statewide swing to L/NP of ${App.fmtSwing(s.swing)}
        (L/NP ${fmt1(s.current)}% 2PP now, ${fmt1(s.base)}% in ${escapeHtml(s.year)})</span>`;

    // Sportsbet's prices, shortest first, with the previous check's price where it moved.
    const odds = outlook.odds;
    const seatOdds = odds && (odds.seats || []).find((x) => x.district === d.id);
    const prev = seatOdds && (seatOdds.history || [])[0];
    const optKey = (o) => `${o.party || "any"}|${o.candidate || ""}`;
    const before = new Map(((prev && prev.options) || []).map((o) => [optKey(o), o.price]));
    const market = seatOdds ? (seatOdds.options || []).slice().sort((a, b) => (a.price - b.price) || (a.party && b.party ? App.partyOrder(a.party, b.party) : !a.party - !b.party))
      .map((o) => { const p = before.get(optKey(o)); return { code: o.party || "OTH", label: escapeHtml(o.label), value: `${App.fmtPrice(o.price)}${p != null && p !== o.price ? ` <span class="muted small">was ${App.fmtPrice(p)}</span>` : ""}` }; }) : [];

    const polls = ((outlook.seatPolls && outlook.seatPolls.polls) || []).filter((p) => p.district === d.id)
      .sort((a, b) => (b.end_date || "").localeCompare(a.end_date || ""));
    const pollItems = polls.map((p) => ({ label: `<a href="${escapeHtml(p.source_url || "#")}" target="_blank" rel="noopener">${escapeHtml(p.pollster)}</a> <span class="muted small">${escapeHtml(fmtDate(p.end_date))}${p.sample_size ? `, n=${p.sample_size}` : ""}</span>`,
      value: p.tcp ? Object.entries(p.tcp).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${escapeHtml(partyShort(k))} ${fmt1(v)}`).join(" v ") : "" }));

    const bars = fc.bars.map((b) => `${ui.probBar(b.segs, { label: b.link, sub: escapeHtml(b.date) })}${b.note ? `<p class="small muted">${escapeHtml(b.note)}</p>` : ""}`).join("");
    const calls = fc.calls.length ? ui.rankedList(fc.calls.map((c) => ({
      label: `<a href="${escapeHtml(c.url || "#")}" target="_blank" rel="noopener">${escapeHtml(c.label)}</a> <span class="muted small">${escapeHtml(c.date)}</span><br>${escapeHtml(c.text)}` })), { numbered: false }) : "";
    const pairs = fc.pairs.length ? ui.rankedList(fc.pairs.map((p) => ({
      label: p.pair.map((x) => `${ui.chip(x.code, partyName(x.code))}${x.share != null ? ` ${fmt1(x.share)}` : ""}`).join(" <span class=\"muted\">v</span> "),
      value: `${p.p < 1 ? "<1" : Math.round(p.p)}%` })), { numbered: false }) : '<p class="muted small">No source publishes final-pair chances for this seat.</p>';
    return `<p class="lead">${escapeHtml(fc.summary)}</p>
      ${bars || '<p class="muted small">No source gives win chances for this seat.</p>'}
      ${calls ? `<h4>Other sources</h4>${calls}` : ""}
      <h4>Likely final two</h4>
      ${pairs}
      ${fc.pairs.length ? '<p class="small muted">The chance each pair is the last two in the count (Australian Election Forecasts), with its median two-candidate-preferred split.</p>' : ""}
      <p class="small fc-2022" data-fc2022="${escapeHtml(d.id)}">&nbsp;</p>
      <details class="see-more"><summary>Details</summary>
        <div class="desk-only">${ui.lazy(fc.tableHtml)}</div>
        ${market.length ? `<h4>Sportsbet prices</h4>${ui.rankedList(market, { show: 4, numbered: false, more: `All ${market.length} prices` })}
          <p class="small muted">${escapeHtml(odds.source || "Sportsbet")}${seatOdds.date_checked || odds.date_checked ? `, as at ${escapeHtml(fmtDate(seatOdds.date_checked || odds.date_checked))}` : ""}. A shorter price means a better chance in the bookmaker's view.</p>` : ""}
        <h4>Seat polls</h4>${pollItems.length ? ui.rankedList(pollItems, { numbered: false }) : '<p class="muted small">None published.</p>'}
        <div class="whatif-note seat-whatif">
          <p><strong>Uniform swing: a what-if that does not model One Nation or independents.</strong></p>
          <p>Swing-adjusted margin: ${swingCell}</p>
          ${ui.clamp(`<p>It moves every Labor-v-Coalition seat by the same statewide two-party swing, so it can't show a seat One Nation or an
            independent might win, and One Nation's vote breaks uniform swing in outer-suburban and regional seats. Try other swings on the
            <a href="pendulum.html${s ? `#swing=${fmt1(s.swing)}` : ""}">pendulum</a>.</p>`, "note")}
        </div>
      </details>`;
  }

  /* ---------- Voting: what's on now, then the voting centres as cards and a map ---------- */
  // The VEC's dates and hours (voting options page, checked 16 Nov 2026): early voting Wed 18 to Fri 27 Nov, 9 am to
  // 6 pm, closed Sun 22 Nov; election day Sat 28 Nov, 8 am to 6 pm; postal vote applications close 6 pm Wed 25 Nov.
  const EARLY = { from: "2026-11-18", to: "2026-11-27", closed: ["2026-11-22"], open: 540, close: 1080 };
  const ELECTION = { day: "2026-11-28", open: 480, close: 1080 };
  const POSTAL_CLOSE = { day: "2026-11-25", at: 1080 };
  const ACCESS = { IWA: "Independent wheelchair access", AWA: "Assisted wheelchair access", LNWA: "Limited or no wheelchair access" };
  const centresFor = (id) => loadJSON(`voting_centres/${id}`);
  const minsFmt = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  function melbNow() {
    const parts = Object.fromEntries(minsFmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
    return { day: App.melbourneToday(), mins: Number(parts.hour) * 60 + Number(parts.minute) };
  }
  const clock = (m) => { const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`; };
  const hhmm = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
  const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  const addDay = (iso) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
  const earlyOpenOn = (day) => day >= EARLY.from && day <= EARLY.to && !EARLY.closed.includes(day);
  function nextEarlyDay(day) {
    for (let x = addDay(day); x <= EARLY.to; x = addDay(x)) if (earlyOpenOn(x)) return x;
    return null;
  }
  // What's happening now, in a sentence, and the line under it.
  function votingStatus() {
    const { day, mins } = melbNow();
    const ed = `Election day ${weekday(ELECTION.day)}, ${clock(ELECTION.open)} to ${clock(ELECTION.close)}`;
    const postal = day < POSTAL_CLOSE.day || (day === POSTAL_CLOSE.day && mins < POSTAL_CLOSE.at) ? ` Postal vote applications close ${clock(POSTAL_CLOSE.at)} ${weekday(POSTAL_CLOSE.day)}.` : "";
    let title;
    if (day < EARLY.from) title = `Early voting opens ${weekday(EARLY.from)} at ${clock(EARLY.open)}`;
    else if (earlyOpenOn(day) && mins < EARLY.open) title = `Early voting opens today at ${clock(EARLY.open)}`;
    else if (earlyOpenOn(day) && mins < EARLY.close) title = `Early voting open today until ${clock(EARLY.close)}`;
    else if (day < ELECTION.day) {
      const next = nextEarlyDay(day);
      title = next ? `Early voting ${earlyOpenOn(day) ? "closed for today" : "closed today"}; reopens ${next === addDay(day) ? "tomorrow" : weekday(next)} at ${clock(EARLY.open)}`
        : `Election day tomorrow, ${clock(ELECTION.open)} to ${clock(ELECTION.close)}`;
    } else if (day === ELECTION.day) {
      title = mins < ELECTION.open ? `Voting opens today at ${clock(ELECTION.open)}` : mins < ELECTION.close ? `Voting centres open today until ${clock(ELECTION.close)}` : "Voting has closed; counting is under way";
    } else title = "Voting has closed";
    return { title, sub: `${day <= ELECTION.day ? ed : "Counting continues; postal votes can arrive until Fri 4 Dec"}.${postal}`, day, mins };
  }
  // A centre's hours today ([open, close] in minutes) or null when it isn't open today.
  function hoursToday(c, kind, day) {
    if (kind === "early") {
      const h = (c.hours || []).find((x) => x.from <= day && day <= (x.to || x.from));
      if (h) return h.open && h.close ? [hhmm(h.open), hhmm(h.close)] : null;
      return earlyOpenOn(day) ? [EARLY.open, EARLY.close] : null;
    }
    return day === ELECTION.day ? [ELECTION.open, ELECTION.close] : null;
  }
  function centreCard(c, kind, st, names) {
    const h = hoursToday(c, kind, st.day);
    const open = h && st.mins >= h[0] && st.mins < h[1];
    const when = h ? `Today ${clock(h[0])}–${clock(h[1])}` : kind === "early" ? (st.day < ELECTION.day && nextEarlyDay(st.day) ? `Next open ${weekday(nextEarlyDay(st.day))}` : "Early voting over")
      : st.day < ELECTION.day ? `Opens ${weekday(ELECTION.day)}, ${clock(ELECTION.open)}–${clock(ELECTION.close)}` : "Closed";
    return `<li class="vcard"><span class="vc-name">${escapeHtml(String(c.venue || c.name).replace(/\s*\(EVC\)$/, ""))}</span>
      <span class="vc-addr">${escapeHtml([c.address, [c.suburb, c.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</span>
      <span class="vc-when">${escapeHtml(when)}${h ? ` <span class="tag${open ? " open" : ""}">${open ? "Open now" : "Closed now"}</span>` : ""}</span>
      <span class="vc-acc">${escapeHtml(ACCESS[c.access] || c.access || "")}${c.host ? ` · run by ${escapeHtml(names[c.host] || c.host)} District` : c.joint ? " · shared with a neighbouring district" : ""}</span></li>`;
  }
  function centreList(list, kind, st, names) {
    if (!list.length) return '<p class="muted small">None listed by the VEC.</p>';
    const head = list.slice(0, 3), rest = list.slice(3);
    return `<ul class="vcards">${head.map((c) => centreCard(c, kind, st, names)).join("")}</ul>${rest.length ? `<details class="rl-more"><summary>Show all ${list.length}</summary>
      <ul class="vcards">${rest.map((c) => centreCard(c, kind, st, names)).join("")}</ul></details>` : ""}`;
  }
  // The district's early and postal votes as the VEC publishes them (data/early_votes.json), as tiles.
  function earlyVotesTiles(d, ev) {
    const n = (v) => Number(v).toLocaleString("en-AU");
    const enrol = ev && ev.enrolment && ev.enrolment.districts && ev.enrolment.districts[d.id];
    const fig = (ev && ev.districts && ev.districts[d.id]) || {};
    const share = (v) => (enrol && v != null ? `${(100 * v / enrol).toFixed(1)}% of roll` : "");
    return `${ui.tiles([
      { value: fig.early != null ? n(fig.early) : "–", label: "Early votes", sub: escapeHtml(share(fig.early) || "Not published yet") },
      { value: fig.postal_returned != null ? n(fig.postal_returned) : "–", label: "Postal votes", sub: escapeHtml(share(fig.postal_returned) || "Not published yet") },
      { value: enrol ? n(enrol) : "–", label: "Enrolled", sub: "Close of roll" },
    ])}<p class="small muted ev-src">${fig.as_of ? `To ${escapeHtml(fmtDate(fig.as_of))}. ` : ""}Victorian Electoral Commission.</p>`;
  }
  function votingBody(d) {
    const st = votingStatus();
    return `<div class="status-card" id="vote-status"><strong>${escapeHtml(st.title)}</strong><span>${escapeHtml(st.sub)}</span></div>
      <div id="wtv-early-votes" class="ev-tiles">${earlyVotesTiles(d, undefined)}</div>
      <div id="where-to-vote"><p class="muted small">Loading the VEC's voting centres…</p></div>
      <div class="vc-map" id="vc-map" role="img" aria-label="Map of voting centres in ${escapeHtml(d.name)}"></div>
      <p class="small muted">Square pins: early voting; round: election day. From the VEC's <a href="https://www.vec.vic.gov.au/voting/2026-state-election/voting-locations" target="_blank" rel="noopener">voting locations</a> (© Victorian Electoral Commission, CC BY 4.0). Check the VEC's list before you go.</p>`;
  }
  async function renderWhereToVote(d) {
    const [doc, ev] = await Promise.all([centresFor(d.id).catch((err) => { console.warn(err); return null; }), loadJSON("early_votes").catch(() => null)]);
    if (hashId() !== d.id || !$("where-to-vote")) return;
    $("wtv-early-votes").innerHTML = earlyVotesTiles(d, ev);
    const box = $("where-to-vote");
    if (!doc) { box.innerHTML = '<p class="empty">The VEC\'s voting centres aren\'t loaded yet.</p>'; return; }
    const st = votingStatus();
    const names = Object.fromEntries(districts.map((x) => [x.id, x.name]));
    const byName = (a, b) => String(a.venue || a.name).localeCompare(String(b.venue || b.name));
    const early = (doc.early || []).slice().sort(byName), day = (doc.election_day || []).slice().sort(byName);
    const parts = [[`Early voting centres (${early.length})`, centreList(early, "early", st, names)],
      [`Election-day voting centres (${day.length})`, centreList(day, "election_day", st, names)]];
    if (st.day >= ELECTION.day) parts.reverse();
    box.innerHTML = parts.map(([h, html]) => `<h4>${escapeHtml(h)}</h4>${html}`).join("");
    App.setSectionSummary($("district-detail"), "voting", `${early.length} early, ${day.length} election-day voting centres`);
    centresData = doc;
    if (votingOpen) drawCentresMap(d);
  }
  let centresData = null, votingOpen = false;
  function drawCentresMap(d) {
    const el = $("vc-map");
    if (!el || el.dataset.drawn || !centresData) return;
    el.dataset.drawn = "1";
    App.loadLib("leaflet").then(() => window.L && App.Maps && App.Maps.centresMap(el, d.id, centresData)).catch(() => { el.remove(); });
  }

  /* ---------- News ---------- */
  const newsBlock = (d) => (news === undefined ? '<p class="muted small">Loading headlines…</p>'
    : `${ui.newsCards(news && news.seats && news.seats[d.id])}<p class="small muted">Headlines and links only, from news searches and publishers' feeds that mention ${escapeHtml(d.name)} or its MP.</p>`);

  /* ---------- The seat panel ---------- */
  function renderDetail() {
    const el = $("district-detail");
    const bar = $("seat-jump");
    if (seatSecs) { seatSecs.destroy(); seatSecs = null; }
    centresData = null; votingOpen = false;
    const id = hashId();
    const d = districts.find((x) => x.id === id);
    if (!d) {
      el.hidden = true;
      if (id) {
        el.hidden = false;
        el.innerHTML = `<p class="empty">No district called “${escapeHtml(id)}”. Choose one from the list.</p>`;
      }
      document.title = "Lower House Districts · Vic Election 2026";
      return;
    }
    document.title = `${d.name} · Vic Election 2026`;
    const region = regionsById[d.region];
    const cands = seatCands(d);
    const live = liveResult(d);
    const fc = App.Forecasts.build(d, { models: outlook.models, odds: outlook.odds, cands });
    fcNow = fc;
    // Phones open only the section a link names; wider screens open them all.
    const want = sectionFromHash(), wide = !App.phoneView();
    const S = (key, title, sum, html) => App.section("sec", key, title, sum, html, wide || key === want);
    const T = Object.fromEntries(sectionList(live));
    el.hidden = false;
    el.dataset.seat = d.id;
    el.innerHTML = `
      <div class="card-head">
        <h2>${App.starButton(d.id, d.name)} ${escapeHtml(d.name)}</h2>
        <div class="card-actions">
          <a class="icon-btn" href="ballot.html#${escapeHtml(d.id)}">Your ballot</a>
          <button class="icon-btn" type="button" id="share-seat" title="Share or download a 1200x630 image of this seat">Share</button>
          ${App.moreMenu("seat-more", "More: guides and copy link", [
            d.abc_url ? `<a href="${escapeHtml(d.abc_url)}" target="_blank" rel="noopener">ABC guide ↗</a>` : "",
            `<a href="${escapeHtml(pbUrl(d))}" target="_blank" rel="noopener">Poll Bludger guide ↗</a>`,
            '<button type="button" data-copy-link>Copy link</button>',
          ].filter(Boolean))}
        </div>
      </div>
      ${glanceBlock(d, region, cands, fc, live)}
      <div class="secs">
      ${S("candidates", T.candidates, escapeHtml(candSummary(cands)), `
      <div id="seat-cands">${candidatesBlock(d, cands)}</div>
      ${ui.linkCard(`ballot.html#${d.id}`, "Your ballot", "Both ballot papers in the VEC's order, with every registered how-to-vote card")}
      <details class="as-table compare" id="compare"><summary>Compare candidates side by side</summary>
        <div id="compare-body"><p class="muted small">Loading profiles…</p></div></details>`)}
      ${S("how-to-vote", T["how-to-vote"], escapeHtml(htvSummary(htvDocs[d.id])), `
      <div id="seat-htv" style="min-height:${htvDocs[d.id] ? 0 : 360}px">${htvDocs[d.id] !== undefined ? htvView(d, htvDocs[d.id]) : ""}</div>`)}
      ${S("forecasts", T.forecasts, escapeHtml(fc.short), forecastsBody(d, fc))}
      ${S("voting", T.voting, "Early voting Wed 18 to Fri 27 Nov; election day Sat 28 Nov", votingBody(d))}
      ${S("results", T.results, live ? escapeHtml(liveSummary(live)) : "Loading the 2022 count…", `
      ${live ? App.abcResultsLink("district", d) : ""}
      ${live ? `<section class="r26" id="r26" aria-labelledby="r26-h"><h4 id="r26-h">2026 results</h4><p class="empty">Loading 2026 results…</p></section>` : ""}
      <section class="r22" id="r22" aria-labelledby="r22-h">
        <h4 id="r22-h">How it voted in 2022</h4>
        <p class="empty">Loading 2022 results…</p>
      </section>`)}
      ${S("news", T.news, escapeHtml(newsSummary(d)), `<div id="seat-news">${newsBlock(d)}</div>`)}
      </div>`;
    bar.innerHTML = App.jumpPills(sectionList(live), (key) => `#${d.id}/${key}`);
    if (htvDocs[d.id] === undefined) {   // another seat chosen after load: fetch its cards into the reserved space
      App.Htv.load(d.id).then((doc) => { htvDocs[d.id] = doc; }).catch(() => { htvDocs[d.id] = null; }).then(() => {
        const box = $("seat-htv");
        if (!box || hashId() !== d.id) return;
        box.innerHTML = htvView(d, htvDocs[d.id]);
        ui.initClamps(box);
        box.style.minHeight = "";
        App.setSectionSummary(el, "how-to-vote", escapeHtml(htvSummary(htvDocs[d.id])));
      });
    }
    if (profileDocs[d.id] === undefined && extrasDone) loadProfiles(d);
    App.ShareCard.shareButton($("share-seat"), async () => App.ShareCard.seatCard({
      seat: d, cands, shots: await App.loadHeadshots(), classification: seatLabel(d),
      odds: outlook.odds && (outlook.odds.seats || []).find((x) => x.district === d.id),
      oddsDate: outlook.odds && outlook.odds.date_checked,
    }));
    renderWhereToVote(d);
    // The comparison (a table, wider screens only) loads the seat's profiles when it is opened.
    $("compare").addEventListener("toggle", (e) => { if (e.currentTarget.open) renderCompare(d); });
    App.Forecasts.fillFinal2022(d);
    if (!live) resultsSummary(d);
    // The results panels draw the first time their section opens; the booth maps when "See booths" opens.
    let resultsDrawn = false;
    seatSecs = App.initSections(el, {
      bar, glance: $("seat-glance"),
      onHash: (key, k) => {
        if (key) history.replaceState(null, "", `#${d.id}/${key}`);
        else if (sectionFromHash() === k) history.replaceState(null, "", `#${d.id}`);
      },
      onOpen: (key) => {
        if (key === "voting") { votingOpen = true; drawCentresMap(d); }
        if (key !== "results" || resultsDrawn) return;
        resultsDrawn = true;
        if (live) renderContest(d, { key: "r26", file: `results_2026/${d.id}`, title: "2026 results", live, intro: intro2026 });
        renderContest(d, { key: "r22", file: `results_2022/${d.id}`, title: "How it voted in 2022", intro: intro2022 });
      },
    });
    ui.initClamps(el);
  }

  // The how-to-vote cards, chips sorted by the model's median first-preference vote, placing the three leading contenders.
  function htvView(d, doc) {
    const fc = fcNow || { fp: {}, meds: [] };
    const contenders = [...new Set(fc.meds.map((m) => m.code))].filter((p) => p !== "OTH").slice(0, 3);
    // An independent's card: the model's figure for the candidate with that surname (cards name them as on the ballot).
    const surname = (n) => String(n || "").split(",")[0].trim().split(" ").pop().toLowerCase();
    const bySurname = Object.fromEntries((((outlook.models && outlook.models.seats) || []).find((x) => x.district === d.id && x.model === "aeforecasts") || { candidates: [] }).candidates
      .filter((c) => c.fp && ["IND", "OTH"].includes(c.party)).map((c) => [surname(c.name), c.fp[1]]));
    const vote = (card) => (card.kind === "party" && card.party !== "IND" && fc.fp[card.party] != null ? fc.fp[card.party]
      : card.kind === "independent" && bySurname[surname(card.registered_by)] != null ? bySurname[surname(card.registered_by)] : null);
    return App.Htv.cardsView(doc, { vote, contenders, area: d.id });
  }

  /* ---------- Compare candidates (a table: wider screens, under "Compare candidates side by side") ---------- */
  const NOTHING = '<span class="muted">Nothing published</span>';
  const roleYears = (r) => (r.from || r.to ? ` <span class="muted">(${r.from || "?"}–${r.to != null ? r.to : r.ended ? "?" : "present"})</span>` : "");
  const unver = (f) => (f && f.unverified ? ' <span class="muted">(unverified)</span>' : "");
  const ROLES_SHOWN = 4;

  async function renderCompare(d) {
    const el = $("compare-body");
    if (!el || el.dataset.done === d.id) return;
    let profiles = {};
    try { profiles = (await loadJSON(`profiles/${d.id}`)).profiles || {}; } catch (err) { console.warn(err); }
    if (hashId() !== d.id || !el.isConnected) return;   // user moved on
    el.dataset.done = d.id;
    const cands = seatCands(d).map((c) => ({ ...c, id: App.candidateId(d.id, c.name) }));
    if (!cands.length) { el.innerHTML = '<p class="empty">No candidates recorded yet.</p>'; return; }
    const cell = (html) => `<td>${html || NOTHING}</td>`;
    const list = (items) => (items.length ? `<ul class="cmp-list">${items.map((x) => `<li>${x}</li>`).join("")}</ul>` : "");
    const roles = (pr) => {
      const all = ((pr && pr.prior_roles) || []).slice().sort((a, b) => ((b.to == null && !b.ended) - (a.to == null && !a.ended)) || (b.from || 0) - (a.from || 0));
      const shown = all.slice(0, ROLES_SHOWN).map((r) => `${escapeHtml(r.role)}${r.organisation ? `, ${escapeHtml(r.organisation)}` : ""}${roleYears(r)}${unver(r)}`);
      if (all.length > ROLES_SHOWN) shown.push(`<span class="muted">and ${all.length - ROLES_SHOWN} more on the profile</span>`);
      return list(shown);
    };
    const priorities = (pr) => list(((pr && pr.priorities) || []).map((x) => `${x.quoted ? `“${escapeHtml(x.text)}”` : escapeHtml(x.text)}${unver(x)}`));
    const rows = [
      ["Party", (c) => `${partyBadge(c.party)}`],
      ["Occupation", (c, pr) => (pr && pr.occupation ? `${escapeHtml(pr.occupation.text)}${unver(pr.occupation)}` : "")],
      ["Prior roles", (c, pr) => roles(pr)],
      ["Stated priorities", (c, pr) => priorities(pr)],
      ["Full profile", (c, pr) => `<a href="candidate.html#${escapeHtml(c.id)}">${pr ? "Profile and sources" : "Candidate page"}</a>`],
    ];
    el.innerHTML = `<p class="muted small">In ballot order, from each candidate's researched profile (every fact has a source on the profile page).</p>
      <div class="table-scroll cmp-scroll"><table class="cmp-table">
        <caption class="sr-only">Candidates for ${escapeHtml(d.name)} compared</caption>
        <thead><tr><td class="cmp-corner"></td>${cands.map((c) => `<th scope="col" style="--party-color: var(${App.partyVar(c.party)})">
          ${c.ballot_position != null ? `<span class="cmp-pos">${c.ballot_position}</span>` : ""}${App.profileLink(d.id, c.name)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${label}</th>${cands.map((c) => cell(fn(c, profiles[c.id]))).join("")}</tr>`).join("")}</tbody>
      </table></div>`;
  }

  /* ---------- 2026 results (scripts/results.py) ---------- */
  // The seat's entry in results.json once votes are being counted, else null.
  function liveResult(d) {
    const r = results && results.districts && results.districts[d.id];
    return r && r.total ? r : null;
  }

  function statusLine(live) {
    const leader = live.leader;
    if (!leader) return '<span class="muted">No votes counted yet.</span>';
    const who = `${partyBadge(leader.party)} ${escapeHtml(leader.name)}`;
    if (live.called_by === "vec") return `<span class="call call-vec">Declared by the VEC</span> ${who}`;
    if (live.status === "called") {
      return `<span class="call call-site">Called by this site</span> ${who}
        <span class="muted small">(this site's projection, not the VEC's: the ${escapeHtml(leader.basis === "distribution" ? "preference count" : "2CP")} margin of
        ${live.margin_votes.toLocaleString("en-AU")} is more than the ~${(live.uncounted_estimate || 0).toLocaleString("en-AU")} votes left to count plus a safety buffer)</span>`;
    }
    return `<span class="call call-lead">Leading</span> ${who} <span class="muted small">${leader.basis === "first preferences"
      ? "on first preferences (no two-candidate count yet)"
      : `by ${(live.margin_votes || 0).toLocaleString("en-AU")} votes on the ${leader.basis === "distribution" ? "preference count" : "2CP count"}, with ~${(live.uncounted_estimate || 0).toLocaleString("en-AU")} still to count`}</span>`;
  }

  function intro2026(r) {
    const live = liveResult({ id: r.contest.district }) || {};
    const counted = live.counted_pct || 0;
    const centres = live.centres_total ? `${live.centres_counted} of ${live.centres_total} voting centres reporting` : "";
    const swing = live.swing_2cp != null && live.leader
      ? ` · 2CP swing to ${escapeHtml(App.partyShort(live.leader.party))} since 2022: ${App.fmtSwing(live.swing_2cp)}` : "";
    return `<p class="r26-status">${statusLine(live)}</p>
      <div class="count-progress" role="img" aria-label="${counted.toFixed(1)}% of enrolment counted">
        <span style="width:${Math.min(100, counted)}%"></span></div>
      ${ui.clamp(`<p>${counted.toFixed(1)}% of enrolment counted${centres ? ` · ${centres}` : ""}${swing}.
        Source: <a href="${escapeHtml(live.url || r.event.source)}" rel="noopener" target="_blank">Victorian Electoral Commission</a>${
        live.vec_updated ? `, updated ${escapeHtml(live.vec_updated)}` : ""}. Refreshed every 5 minutes.
        ${declarationText(live.declaration_votes)}
        ${live.holder && live.changes_hands ? `<strong>${escapeHtml(App.partyName(live.holder))} hold the seat; on these figures it would change hands.</strong>` : ""}</p>`, "note")}`;
  }

  // Early and postal votes the VEC said were cast before election day, against those counted so far (results.py).
  function declarationText(dv) {
    if (!dv) return "";
    const n = (v) => Number(v || 0).toLocaleString("en-AU");
    const cast = (dv.early_cast || 0) + (dv.postal_returned || 0);
    return `Before election day the VEC reported ${n(dv.early_cast)} early votes and ${n(dv.postal_returned)} postal votes returned here;
      ${n(dv.early_counted + dv.postal_counted)} of those types are counted so far, so about <strong>${n(dv.outstanding)}</strong> of the ${n(cast)} are still to come
      (postal votes can arrive until Fri 4 Dec).`;
  }

  function intro2022(r) {
    return ui.clamp(`<p>${r.event.name && !/^State Election 2022/.test(r.event.name)
        ? `${escapeHtml(r.event.name)} (${escapeHtml(App.fmtDate(r.event.date))}), held after the November 2022 poll failed; results from the`
        : "Final 2022 results from the"} <a href="${escapeHtml(r.event.source)}" rel="noopener" target="_blank">VEC</a>.
        Swings compare with the notional 2018 result on today's boundaries (<a href="${escapeHtml((r.swing && r.swing.source) || "#")}" rel="noopener" target="_blank">Wikipedia</a>).</p>`, "note");
  }

  /* ---------- Contest panels: 2026 live and 2022 history (vec-contest-v1 format) ---------- */
  const pct = (n, total) => (total ? (100 * n) / total : 0);
  const swingSpan = (v) => (v == null ? "" :
    ` <span class="small ${v >= 0 ? "swing-up" : "swing-down"}" title="Swing since the notional 2018 result">${App.fmtSwing(v)}</span>`);
  const FP_SHOWN = 6;   // first-preference bars shown before "All N candidates"
  const TYPE_LABELS = { Ordinary: "Voting centres", EVCEarly: "Early voting centres", MobileVotingEarly: "Mobile voting",
    Early: "Early votes", Postal: "Postal", Absent: "Absent", MarkedAsVoted: "Marked as voted", Provisional: "Provisional" };

  // One contest panel for 2026 (live, results_2026/) and 2022 (history, results_2022/): same vec-contest-v1 format.
  // Leads with the final two as one bar, then first preferences largest first; the booth map, a ranked list of
  // booths and the tables are behind "See booths".
  // opts: {key ("r26" | "r22"), file, title, intro(r) -> html, live (results.json entry, 2026 only)}
  async function renderContest(d, opts) {
    const { key } = opts;
    const el = $(key);
    if (!el) return;
    let r;
    try {
      r = await loadJSON(opts.file);
    } catch (err) {
      el.innerHTML = `<h4 id="${key}-h">${escapeHtml(opts.title)}</h4><p class="empty">${key === "r26" ? "2026 results" : "2022 results"} are not available for this district${key === "r26" ? " yet" : ""}.</p>`;
      return;
    }
    if (hashId() !== d.id || !el.isConnected) return;   // user moved on
    const cand = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
    const fp = r.first_preferences;
    const sw = (r.swing && r.swing.first_preferences) || {};
    const tsw = (r.swing && r.swing.tcp) || {};
    const fpRows = Object.entries(fp.candidates).sort((a, b) => b[1] - a[1]);
    const maxShare = Math.max(...fpRows.map(([, v]) => pct(v, fp.formal)));
    const tcpEntries = r.tcp ? Object.entries(r.tcp.candidates).sort((a, b) => b[1] - a[1]) : [];
    const pair = finalPair(r);
    const byType = r.tcp ? Object.keys(r.tcp.by_type) : [];
    const elected = r.candidates.find((c) => c.elected);
    const name = (id) => `${escapeHtml(App.partyName(cand[id].party))} (${escapeHtml(cand[id].name.split(",")[0])})`;
    const dist = r.distribution && Object.keys(r.distribution.candidates).length === 2 ? r.distribution.candidates : null;
    const notes = [];
    if (dist && r.tcp && !Object.keys(dist).every((id) => id in r.tcp.candidates)) {
      notes.push(`The VEC's voting-centre count was between ${tcpEntries.map(([id]) => name(id)).join(" and ")}, so the booth map compares those two; the final count was between ${Object.keys(dist).map(name).join(" and ")}.`);
    } else if (elected && tcpEntries.length && tcpEntries[0][0] !== elected.id) {
      notes.push(`${name(elected.id)} trailed in the VEC's indicative two-candidate count but won after the full distribution of preferences.`);
    }
    const fpBars = (list) => `<ul class="vote-bars">${list.map(([id, v]) => {
      const c = cand[id];
      return `<li><span class="vb-name">${escapeHtml(App.partyName(c.party))} <span class="muted small">${escapeHtml(ui.niceName(c.name))}</span></span>
        <span class="vb-track"><span class="vb-fill" style="display:block;width:${(100 * pct(v, fp.formal)) / maxShare}%;background:var(${App.partyVar(c.party)})"></span></span>
        <span class="vb-num">${pct(v, fp.formal).toFixed(1)}%${swingSpan(sw[id])}</span></li>`;
    }).join("")}</ul>`;
    const pairLead = pair ? `<p class="lead">${escapeHtml(App.partyName(pair[0][0].party))} ${key === "r26" ? "leads" : "won"} ${fmt1(pair[0][1])}–${fmt1(pair[1][1])} against ${escapeHtml(App.partyName(pair[1][0].party))} after preferences.</p>` : "";
    const booths = r.polling_places.slice().sort((a, b) => (b.total || 0) - (a.total || 0)).map((p) => {
      const s = p.tcp ? Object.values(p.tcp).reduce((a, b) => a + (b || 0), 0) : 0;
      const lead = p.tcp ? Object.entries(p.tcp).sort((a, b) => b[1] - a[1])[0] : null;
      return { label: `${escapeHtml(p.name)} <span class="muted small">${(p.total ?? 0).toLocaleString("en-AU")} votes</span>`,
        code: lead && cand[lead[0]] ? cand[lead[0]].party : "OTH",
        value: lead && cand[lead[0]] ? `${escapeHtml(App.partyShort(cand[lead[0]].party))} ${pct(lead[1], s).toFixed(0)}%` : "–" };
    });

    el.innerHTML = `
      <h4 id="${key}-h">${escapeHtml(opts.title)}</h4>
      ${pairLead}
      ${pair ? ui.splitBar({ code: pair[0][0].party, label: App.partyName(pair[0][0].party), value: pair[0][1] }, { code: pair[1][0].party, label: App.partyName(pair[1][0].party), value: pair[1][1] },
        `${escapeHtml(ui.niceName(pair[0][0].name))} v ${escapeHtml(ui.niceName(pair[1][0].name))}${tsw[pair[0][0].id] != null ? ` · swing ${App.fmtSwing(tsw[pair[0][0].id])} to ${escapeHtml(App.partyShort(pair[0][0].party))}` : ""}`) : ""}
      <h5>First preferences</h5>
      ${fpBars(fpRows.slice(0, FP_SHOWN))}
      ${fpRows.length > FP_SHOWN ? `<details class="rl-more"><summary>All ${fpRows.length} candidates</summary>${fpBars(fpRows.slice(FP_SHOWN))}</details>` : ""}
      ${opts.intro(r)}
      ${notes.length ? ui.clamp(notes.map((n) => `<p>${n}</p>`).join(""), "note") : ""}
      <p class="muted small">${fp.formal.toLocaleString("en-AU")} formal votes, ${pct(fp.informal, fp.total).toFixed(1)}% informal${r.contest.enrolment ? `; enrolment ${r.contest.enrolment.toLocaleString("en-AU")}` : ""}.</p>
      <details class="see-more booths" id="${key}-booths"><summary>See booths (${r.polling_places.length})</summary>
        <div class="booth-map" id="${key}-booth-map"></div>
        <p class="muted small" id="${key}-booth-note"></p>
        <div class="phone-only">${ui.rankedList(booths, { show: 5, numbered: false, more: `All ${booths.length} booths` })}</div>
        ${ui.asTable(`${byType.length ? `
          <div class="table-scroll" tabindex="0" role="region" aria-label="Two-candidate-preferred share by vote type (scrolls sideways)"><table>
            <thead><tr><th>Vote type (2CP)</th>${tcpEntries.map(([id]) => `<th class="num">${escapeHtml(App.partyShort(cand[id].party))}</th>`).join("")}<th class="num">Votes</th></tr></thead>
            <tbody>${byType.map((t) => {
              const row = r.tcp.by_type[t];
              const sum = Object.values(row).reduce((a, b) => a + (b || 0), 0);
              return `<tr><td>${escapeHtml(TYPE_LABELS[t] || t)}</td>${tcpEntries.map(([id]) => `<td class="num">${pct(row[id] || 0, sum).toFixed(1)}%</td>`).join("")}<td class="num">${sum.toLocaleString("en-AU")}</td></tr>`;
            }).join("")}</tbody>
          </table></div>` : ""}
          <div class="table-scroll" tabindex="0" role="region" aria-label="Votes at every voting centre (scrolls sideways)"><table>
            <thead><tr><th>Voting centre</th><th class="num">Votes</th>${tcpEntries.map(([id]) => `<th class="num">${escapeHtml(App.partyShort(cand[id].party))} 2CP</th>`).join("")}</tr></thead>
            <tbody>${r.polling_places.slice().sort((a, b) => (b.total || 0) - (a.total || 0)).map((p) => {
              const s = p.tcp ? Object.values(p.tcp).reduce((a, b) => a + (b || 0), 0) : 0;
              return `<tr><td>${escapeHtml(p.name)}${p.lat == null ? ' <span class="muted small">(not mapped)</span>' : ""}</td><td class="num">${(p.total ?? 0).toLocaleString("en-AU")}</td>${tcpEntries.map(([id]) => `<td class="num">${p.tcp ? `${pct(p.tcp[id] || 0, s).toFixed(1)}%` : "–"}</td>`).join("")}</tr>`;
            }).join("")}</tbody>
          </table></div>`)}
      </details>`;
    ui.initClamps(el);
    // The booth map draws the first time "See booths" opens (a map in a hidden box has no size).
    $(`${key}-booths`).addEventListener("toggle", (e) => { if (e.currentTarget.open) drawBoothMap(d, key, r); }, { once: false });
  }

  async function drawBoothMap(d, key, r) {
    const box = $(`${key}-booth-map`);
    if (!box || box.dataset.drawn) return;
    box.dataset.drawn = "1";
    const note = $(`${key}-booth-note`);
    await App.loadLib("leaflet").catch(() => null);
    if (hashId() !== d.id || !box.isConnected) return;
    if (!window.L || !App.Maps) {
      box.remove();
      note.textContent = "The map library failed to load; the list below has every voting centre.";
      return;
    }
    const centres = await centresFor(d.id).catch(() => null);
    const mapped = await App.Maps.boothMap(box, d.id, r, centres);
    if (!mapped || !note.isConnected) return;
    note.textContent = `${mapped.placed} of ${mapped.total} voting centres mapped${key === "r26" ? " at their 2022 locations; grey circles haven't reported yet" : ""}. Circles are sized by votes and coloured by the two-candidate-preferred leader; tap one for its numbers.${
      mapped.pins ? " Pins mark the 2026 places to vote." : ""}`;
  }

  // "#<district>/<section>": open the section and bring it to the top once photos and headlines are in, so nothing
  // above it moves afterwards.
  function scrollToSection() {
    if (!extrasDone || !sectionFromHash()) return;
    const want = App.hashId();
    extrasDone.then(() => App.afterPaint()).then(() => {
      if (App.hashId() === want && seatSecs) seatSecs.open(sectionFromHash(), { how: "link" });
    });
  }

  function onHashChange() {
    const id = hashId();
    const d = districts.find((x) => x.id === id);
    if (d && seatSecs && $("district-detail").dataset.seat === id && !$("district-detail").hidden) {   // same seat, another section
      if (sectionFromHash()) seatSecs.open(sectionFromHash(), { how: "link" });
      else $("district-detail").scrollIntoView({ block: "start" });
      return;
    }
    // If a shared link points outside the current filters, clear them so it shows up.
    if (d && !filtered().includes(d)) { $("f-region").value = ""; $("f-area").value = ""; }
    renderDistrictOptions();
    renderList();
    renderDetail();
    if (d && sectionFromHash()) scrollToSection();
    else if (d) $("district-detail").scrollIntoView({ block: "nearest" });
  }

  // The open seat's researched profiles (data/profiles/<district>.json): each person card's one line and summary.
  function loadProfiles(d) {
    return loadJSON(`profiles/${d.id}`).catch(() => null).then((doc) => {
      profileDocs[d.id] = doc;
      if (hashId() === d.id && $("seat-cands")) { $("seat-cands").innerHTML = candidatesBlock(d, seatCands(d)); }
    });
  }

  // Photos, headlines and profiles: fetched after the first paint, then swapped into the open seat's panel (avatars
  // and each card's line keep their size, so nothing moves).
  let extrasDone = null;   // resolves once they are in (a section link scrolls after it)
  function loadExtras() {
    const d0 = districts.find((x) => x.id === hashId());
    return Promise.all([App.loadHeadshots(), loadJSON("news").catch((err) => { console.warn(err); return null; }),
      d0 ? loadJSON(`profiles/${d0.id}`).catch(() => null) : null]).then(([shotData, newsData, prof]) => {
      shots = shotData;
      news = newsData;
      if (d0) profileDocs[d0.id] = prof;
      const d = districts.find((x) => x.id === hashId());
      if (d && $("seat-cands")) {
        if (profileDocs[d.id] === undefined) loadProfiles(d);
        $("seat-cands").innerHTML = candidatesBlock(d, seatCands(d));
        $("seat-news").innerHTML = newsBlock(d);
        App.setSectionSummary($("district-detail"), "news", escapeHtml(newsSummary(d)));
      }
    });
  }

  async function init() {
    try {
      const optional = (name) => loadJSON(name).catch((err) => { console.warn(err); return null; });
      // What the seat panel needs, in parallel. Photos, headlines and profiles wait until it has painted.
      const first = hashId();
      const [dd, cd, rd, metaData, pollData, models, odds, seatPolls, resultData, pb] = await Promise.all([
        loadJSON("districts"), loadJSON("candidates"), loadJSON("regions"),
        optional("meta"), optional("polls"), optional("seat_models"), optional("seat_odds"), optional("seat_polls"),
        optional("results"), optional("pollbludger_margins"),
        first ? App.Htv.load(first).then((doc) => { htvDocs[first] = doc; }).catch(() => { htvDocs[first] = null; }) : null,
      ]);
      results = resultData;
      meta = metaData;
      ((pb && pb.differences) || []).forEach((x) => { pbDiffs[x.district] = x; });
      outlook = { swing: App.statewideSwing(meta, pollData), models, odds, seatPolls };
      districts = dd.districts.slice().sort((a, b) => a.name.localeCompare(b.name));
      candidates = cd.candidates || [];
      rd.regions.forEach((r) => { regionsById[r.id] = r; });
      if ($("pref-watch")) App.afterPaint(() => optional("htv/index").then((index) => { $("pref-watch").innerHTML = App.Htv.watch(index, districts); }));

      $("f-region").innerHTML += rd.regions.slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join("");

      $("f-region").addEventListener("change", () => { renderDistrictOptions(); renderList(); });
      $("f-area").addEventListener("change", () => { renderDistrictOptions(); renderList(); });
      $("f-district").addEventListener("change", (e) => {
        if (e.target.value) {
          location.hash = e.target.value;
        } else {
          history.replaceState(null, "", location.pathname + location.search);
          onHashChange();
        }
      });
      $("district-list").addEventListener("click", (e) => {
        const row = e.target.closest("tr[data-id]");
        if (row && !e.target.closest("a, [data-star]")) location.hash = row.dataset.id;
      });
      window.addEventListener("hashchange", onHashChange);
      onHashChange();
      extrasDone = App.afterPaint(loadExtras);
      scrollToSection();
    } catch (err) {
      window.App.showError($("district-list"), err);
    }
  }

  // Scripts are deferred, so the page is usually parsed by now: start loading the seat's data at once.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
