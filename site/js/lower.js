/* Lower house page: filter districts, show the selected one (selected via #district-id). */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyBadge, partyShort, statusBadge, fmtDate, hashId, copyLink } = window.App;

  // Strongest confirmation first.
  const STATUS_RANK = ["vec_nominated", "endorsed", "reported", "announced"];

  let districts = [];
  let candidates = [];
  let regionsById = {};
  // Seat outlook inputs: statewide swing, MRP models, betting, seat polls.
  let outlook = { swing: null, models: null, odds: null, seatPolls: null };
  let shots = {};   // candidate id -> headshot (data/headshots.json); filled in after the first paint
  const htvDocs = {};   // data/htv/<district>.json (how-to-vote cards), loaded per seat
  let news;         // data/news.json (headlines per seat); undefined until loaded, null if it failed
  let vec;          // data/vec_nominations.json (the VEC's list, for the ballot paper); undefined until loaded
  let results = null;   // data/results.json: the 2026 count (scripts/results.py), null if missing

  const $ = (id) => document.getElementById(id);

  function marginLabel(pct) {
    if (pct == null) return "";
    if (pct < 6) return "Marginal";
    if (pct < 10) return "Fairly safe";
    return "Safe";
  }

  /* ---------- Seat outlook ---------- */
  const fmt1 = (n) => Number(n).toFixed(1);

  function outlookRow(label, body) {
    return `<div class="outlook-row"><dt>${escapeHtml(label)}</dt><dd>${body}</dd></div>`;
  }

  // One line per model, each with its date, then the betting favourite, so disagreements show at a glance.
  function forecastsCell(d, seatOdds, odds) {
    const doc = outlook.models || {};
    const models = doc.models || [];
    const entry = (m) => (doc.seats || []).find((x) => x.district === d.id && x.model === m.id);
    const pct = (n) => `${fmt1(n)}%`;
    const calls = [];   // [label, party] for the agreement line
    const lines = [];
    const line = (label, body) => lines.push(`<li><span class="fc-src">${label}</span> ${body}</li>`);

    const aef = models.find((m) => m.kind === "forecast" && m.published);
    if (aef) {
      const e = entry(aef);
      const label = `${App.modelLink(aef)} <span class="muted small">(model of ${escapeHtml(fmtDate(aef.model_date))})</span>`;
      if (!e || !e.winner) line(label, '<span class="muted">no forecast for this seat</span>');
      else {
        calls.push(["Australian Election Forecasts", e.winner]);
        const rivals = [...(e.candidates || []), ...(e.others || [])].filter((c) => c.win_probability >= 1 && c.name !== e.winner_name)
          .sort((a, b) => b.win_probability - a.win_probability).slice(0, 3)
          .map((c) => `${escapeHtml(partyShort(c.party))}${c.name ? "" : ` (${escapeHtml(c.label.replace(/^An? /, ""))})`} ${pct(c.win_probability)}`).join(", ");
        const fpRows = (e.candidates || []).map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${partyBadge(c.party, { full: false })}</td>
          <td class="num">${pct(c.win_probability)}</td><td class="num">${c.fp ? `${fmt1(c.fp[1])} <span class="muted small">(${fmt1(c.fp[0])}–${fmt1(c.fp[2])})</span>` : "–"}</td></tr>`).join("");
        const tcp = (e.two_cp || []).slice(0, 4).map((s) => `<li>${escapeHtml(partyShort(s.parties[0]))} v ${escapeHtml(partyShort(s.parties[1]))}: ${pct(s.probability)} chance${s.share
          ? `; ${escapeHtml(partyShort(s.parties[0]))} ${fmt1(s.share[1])} <span class="muted small">(${fmt1(s.share[0])}–${fmt1(s.share[2])})</span>` : ""}</li>`).join("");
        line(label, `${partyBadge(e.winner)} ${escapeHtml(e.winner_name || "")} <strong>${pct(e.win_probability)}</strong>
          ${rivals ? `<span class="muted small">· then ${rivals}</span>` : ""}
          <details class="fc-detail"><summary>First preferences and 2CP scenarios</summary>
            <div class="table-scroll"><table data-no-csv><thead><tr><th>Candidate</th><th>Party</th><th class="num">Win</th><th class="num">First pref. % (90% range)</th></tr></thead><tbody>${fpRows}</tbody></table></div>
            ${tcp ? `<p class="small" style="margin:6px 0 2px">Likeliest final pairings (2CP %, 90% range):</p><ul class="small fc-tcp">${tcp}</ul>` : ""}
          </details>`);
      }
    }

    models.filter((m) => m.kind === "mrp" && m.published).forEach((m) => {
      const e = entry(m);
      const label = `<a href="${escapeHtml(m.source_url || "#")}" rel="noopener" target="_blank">${escapeHtml(m.name)}</a> <span class="muted small">(${escapeHtml(m.fieldwork || "")})</span>`;
      if (!e || !e.winner) { line(label, '<span class="muted">no call for this seat</span>'); return; }
      calls.push([m.name, e.winner]);
      line(label, `${partyBadge(e.winner)}${e.runner_up ? ` over ${escapeHtml(App.partyName(e.runner_up))}` : ""}${e.winner_2cp != null ? `, ${fmt1(e.winner_2cp)}% 2CP` : ""}`);
    });

    const rb = models.find((m) => m.kind === "projection" && m.published);
    if (rb) {
      const e = entry(rb);
      const label = `<a href="${escapeHtml(rb.source_url)}" rel="noopener" target="_blank">${escapeHtml(rb.name)}</a> <span class="muted small">(${escapeHtml(fmtDate(rb.published_date))})</span>`;
      if (e && e.winner) { calls.push([rb.name, e.winner]); line(label, partyBadge(e.winner)); }
      else if ((rb.toss_ups || []).includes(d.id)) line(label, "<strong>Toss-up</strong>");
      else line(label, '<span class="muted">no seat rating published (statewide totals only)</span>');
    }

    if (seatOdds && seatOdds.favourite && !seatOdds.partial) {
      calls.push(["Sportsbet", seatOdds.favourite]);
      line(`Sportsbet favourite <span class="muted small">(${escapeHtml(fmtDate(seatOdds.date_checked || odds.date_checked))})</span>`,
        `${partyBadge(seatOdds.favourite)} ${App.fmtPrice(seatOdds.price)}`);
    } else if (seatOdds && seatOdds.joint_favourites) {
      line("Sportsbet favourite", `${seatOdds.joint_favourites.map((p) => partyBadge(p)).join(" / ")} <span class="muted small">(joint)</span>`);
    } else line("Sportsbet favourite", '<span class="muted">no clear favourite</span>');

    const blocs = [...new Set(calls.map(([, p]) => App.blocOf(p)))];
    const parties = [...new Set(calls.map(([, p]) => p))];
    const agreed = parties.length === 1 ? App.partyName(parties[0]) : blocs[0] === "LNP" ? "the Coalition" : App.partyName(calls[0][1]);
    const verdict = calls.length < 2 ? ""
      : blocs.length === 1 ? `<p class="fc-verdict small">All ${calls.length} calls agree: ${escapeHtml(agreed)}</p>`
      : `<p class="fc-verdict fc-split small"><strong>Forecasts disagree:</strong> ${calls.map(([n, p]) => `${escapeHtml(n)} ${escapeHtml(partyShort(p))}`).join(" · ")}</p>`;
    return lines.length ? `${verdict}<ul class="fc-list">${lines.join("")}</ul>` : '<span class="muted">none published</span>';
  }

  function renderOutlook(d) {
    const s = outlook.swing;
    const adj = App.swingAdjusted(d.margin, s);
    let swingCell;
    if (!s) swingCell = '<span class="muted">n/a (no two-party-preferred polling)</span>';
    else if (!adj) swingCell = '<span class="muted">n/a (not a Labor-Coalition contest)</span>';
    else {
      swingCell = `<strong>${escapeHtml(adj.before)} → ${escapeHtml(adj.after)}</strong> on current polling
        <div class="muted small">Statewide swing to L/NP ${App.fmtSwing(s.swing)}: L/NP ${fmt1(s.current)}% 2PP now vs ${fmt1(s.base)}% in ${escapeHtml(s.year)}</div>`;
    }

    const odds = outlook.odds;
    const seatOdds = odds && (odds.seats || []).find((x) => x.district === d.id);
    const forecastCell = forecastsCell(d, seatOdds, odds);
    let oddsCell;
    const price = App.fmtPrice;
    const favLabel = (code, candidate) => (candidate ? `${escapeHtml(candidate)} (Ind)`
      : App.PARTIES[code] ? partyBadge(code) : escapeHtml(code));
    if (seatOdds && (seatOdds.favourite || seatOdds.joint_favourites || (seatOdds.options || []).length)) {
      const date = seatOdds.date_checked || odds.date_checked;
      const favText = (row) => (row.favourite ? `${favLabel(row.favourite, row.favourite_candidate)} ${price(row.price)}`
        : row.joint_favourites ? `${row.joint_favourites.map((p) => favLabel(p)).join(" / ")} ${price(row.price)} <span class="muted small">(joint favourites)</span>`
        : null);
      const head = favText(seatOdds) || '<span class="muted">favourite not visible (partial market)</span>';
      // The previous check (seat_odds.json → history, newest first): each option's earlier price in brackets.
      const prev = (seatOdds.history || [])[0] || null;
      const optKey = (o) => `${o.party || "any"}|${o.candidate || ""}`;
      const before = new Map(((prev && prev.options) || []).map((o) => [optKey(o), o.price]));
      const was = (o) => { const p = before.get(optKey(o)); return p != null && p !== o.price ? ` (${price(p)})` : ""; };
      const market = (seatOdds.options || []).map((o) => `${escapeHtml(o.label)} ${price(o.price)}${was(o)}`).join(" · ");
      const favKey = (row) => (row.favourite ? `${row.favourite}|${row.favourite_candidate || ""}` : (row.joint_favourites || []).join("/"));
      const prevFav = prev && favText(prev);
      const moveNote = prev ? `<div class="muted small">In brackets: the price on ${escapeHtml(fmtDate(prev.date_checked))}, where it has moved.${
        prevFav && favKey(prev) !== favKey(seatOdds) ? ` The favourite then: ${prevFav}.` : ""} A shorter price means a better chance in the bookmaker's view.</div>` : "";
      oddsCell = `${head} <span class="muted small">${escapeHtml(odds.source || "")}${date ? `, as at ${escapeHtml(fmtDate(date))}` : ""}</span>
        ${market ? `<div class="muted small">${market}${seatOdds.more_options_hidden ? " · more options not shown" : ""}</div>` : ""}${moveNote}`;
    } else {
      oddsCell = '<span class="muted">not recorded</span>';
    }

    const polls = ((outlook.seatPolls && outlook.seatPolls.polls) || []).filter((p) => p.district === d.id)
      .sort((a, b) => (b.end_date || "").localeCompare(a.end_date || ""));
    const pollsCell = polls.length ? polls.map((p) => {
      const tcp = p.tcp ? Object.entries(p.tcp).map(([k, v]) => `${escapeHtml(partyShort(k))} ${fmt1(v)}`).join(" – ") : "";
      const prim = p.primary ? Object.entries(p.primary).map(([k, v]) => `${escapeHtml(partyShort(k))} ${v}`).join(", ") : "";
      return `<div>${escapeHtml(p.pollster)}, ${escapeHtml(fmtDate(p.end_date))}${p.sample_size ? `, n=${p.sample_size}` : ""}:
        ${tcp ? `<strong>2CP ${tcp}</strong>` : ""}${prim ? ` <span class="muted small">(primaries ${prim})</span>` : ""}
        ${p.source_url ? ` <a class="small" href="${escapeHtml(p.source_url)}" rel="noopener" target="_blank">source</a>` : ""}</div>`;
    }).join("") : '<span class="muted">none published</span>';

    return `
      <section class="outlook" aria-label="Seat outlook">
        <h3>Seat outlook</h3>
        <dl>
          ${outlookRow("Swing-adjusted margin", swingCell)}
          ${outlookRow("Forecasts", forecastCell)}
          ${outlookRow("Betting favourite", oddsCell)}
          ${outlookRow("Seat polls", pollsCell)}
        </dl>
        <p class="muted small outlook-note">The swing-adjusted figure is a uniform-swing estimate; One Nation's vote breaks uniform swing in outer-suburban and regional seats.</p>
      </section>`;
  }

  // The ABC's classification ("Very Safe Labor") when we have it.
  function seatLabel(d) {
    return d.classification || marginLabel(d.margin && d.margin.pct);
  }

  function marginText(m) {
    if (!m || m.pct == null) return "–";
    return `${escapeHtml(partyShort(m.party))} ${Number(m.pct).toFixed(1)}%${m.vs ? ` vs ${escapeHtml(partyShort(m.vs))}` : ""}`;
  }

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

  function candidateSort(a, b) {
    const wa = isInactive(a), wb = isInactive(b);
    if (wa !== wb) return wa ? 1 : -1;
    const pa = a.ballot_position ?? Infinity, pb = b.ballot_position ?? Infinity;
    const rank = (s) => STATUS_RANK.indexOf(s) + 1 || STATUS_RANK.length + 1;
    return pa - pb || rank(a.status) - rank(b.status) || a.name.localeCompare(b.name);
  }

  function renderDetail() {
    const el = $("district-detail");
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

    el.hidden = false;
    el.innerHTML = `
      <div class="card-head">
        <h2>${App.starButton(d.id, d.name)} ${escapeHtml(d.name)}</h2>
        <div class="card-actions">
          ${d.abc_url ? `<a class="icon-btn" href="${escapeHtml(d.abc_url)}" target="_blank" rel="noopener">ABC guide ↗</a>` : ""}
          <a class="icon-btn" href="ballot.html#${escapeHtml(d.id)}">Your ballot</a>
          <button class="icon-btn" type="button" id="copy-link">Copy link</button>
          <button class="icon-btn" type="button" id="share-seat" title="Share or download a 1200x630 image of this seat">Share</button>
        </div>
      </div>
      <div class="facts">
        <div class="fact"><div class="label">Sitting MP</div><div class="value">${escapeHtml(d.sitting_mp || "–")}${d.retiring ? ' <span class="badge neutral">Retiring</span>' : ""}</div></div>
        <div class="fact"><div class="label">Held by</div><div class="value">${partyBadge(d.party)}</div></div>
        <div class="fact"><div class="label">Margin</div><div class="value">${marginText(d.margin)}</div><div class="muted small">${escapeHtml(seatLabel(d))}</div></div>
        <div class="fact"><div class="label">Region</div><div class="value">${region ? `<a href="upper.html#${escapeHtml(region.id)}">${escapeHtml(region.name)}</a>` : escapeHtml(d.region)}${d.needs_check ? ' <span class="badge reported" title="Region allocation flagged for checking">Check</span>' : ""}</div><div class="muted small">${d.area === "regional" ? "Regional" : "Metro"}</div></div>
      </div>
      ${resultsSlot(d, live)}
      ${renderOutlook(d)}
      ${d.notes ? `<p>${escapeHtml(d.notes)}</p>` : ""}
      ${d.region_note ? `<p class="muted small">${escapeHtml(d.region_note)}</p>` : ""}
      <h3>Candidates</h3>
      <div id="seat-cands">${candidatesBlock(d, cands)}</div>
      <section class="seat-ballot" id="ballot-order" aria-labelledby="ballot-h">
        <h3 id="ballot-h">Ballot paper</h3>
        <div id="seat-ballot" style="min-height:${ballotHeight(cands)}px">${ballotBlock(d)}</div>
      </section>
      <section class="seat-vote" id="where-to-vote" aria-labelledby="wtv-h">
        <h3 id="wtv-h">Where to vote</h3>
        <p class="small wtv-times">${VOTE_TIMES}</p>
        <p class="small wtv-early-votes" id="wtv-early-votes">&nbsp;</p>
        <details class="wtv-list" id="wtv-early"><summary>Early voting centres <span class="muted" data-count></span></summary><div class="wtv-body"><p class="muted small">Loading…</p></div></details>
        <details class="wtv-list" id="wtv-day"><summary>Election-day voting centres <span class="muted" data-count></span></summary><div class="wtv-body"><p class="muted small">Loading…</p></div></details>
        <p class="muted small wtv-src">From the VEC's <a href="https://www.vec.vic.gov.au/voting/2026-state-election/voting-locations" target="_blank" rel="noopener">voting locations</a>
          (© Victorian Electoral Commission, CC BY 4.0). Pins on the voting-centre map below mark them. Check the VEC's list before you go.</p>
      </section>
      <details class="compare" id="compare">
        <summary><h3 id="compare-h">Compare candidates</h3><span class="muted small">Party, occupation, roles and stated priorities side by side</span></summary>
        <div id="compare-body"><p class="muted small">Loading profiles…</p></div>
      </details>
      <div id="seat-htv" style="min-height:${htvDocs[d.id] ? 0 : App.Htv.reserve(cands.filter((c) => !isInactive(c)).length)}px">${htvDocs[d.id] ? App.Htv.section(htvDocs[d.id]) : ""}</div>
      <section class="seat-news" aria-labelledby="news-h">
        <h3 id="news-h">In the news</h3>
        <div id="seat-news">${newsBlock(d)}</div>
        <p class="muted small">Headlines and links only, from news searches and publishers' feeds that mention ${escapeHtml(d.name)} or its MP. Updated four times a day.</p>
      </section>
      <section class="r22" id="r22" aria-labelledby="r22-h">
        <h3 id="r22-h">How it voted in 2022</h3>
        <p class="empty">Loading 2022 results…</p>
      </section>`;
    $("copy-link").addEventListener("click", (e) => copyLink(e.currentTarget));
    if (!htvDocs[d.id]) {   // another seat chosen after load: fetch its cards into the reserved space
      App.Htv.load(d.id).then((doc) => { htvDocs[d.id] = doc; }).catch(() => null).then(() => {
        const box = $("seat-htv");
        if (!box || hashId() !== d.id) return;
        box.innerHTML = App.Htv.section(htvDocs[d.id] || null, { area: d.id });
        box.style.minHeight = "";
      });
    }
    App.ShareCard.shareButton($("share-seat"), async () => App.ShareCard.seatCard({
      seat: d, cands: cands.filter((c) => !isInactive(c)), shots: await App.loadHeadshots(), classification: seatLabel(d),
      odds: outlook.odds && (outlook.odds.seats || []).find((x) => x.district === d.id),
      oddsDate: outlook.odds && outlook.odds.date_checked,
    }));
    renderWhereToVote(d);
    // The comparison loads the seat's profiles (data/profiles/<seat>.json) only when it is opened.
    $("compare").addEventListener("toggle", (e) => { if (e.currentTarget.open) renderCompare(d); });
    if (live) renderContest(d, { key: "r26", file: `results_2026/${d.id}`, title: "2026 results", live, intro: intro2026 });
    renderContest(d, { key: "r22", file: `results_2022/${d.id}`, title: "How it voted in 2022", intro: intro2022 });
  }

  function seatCands(d) {
    // Superseded, withdrawn and not-standing rows stay in candidates.json for the record but aren't shown
    // (a candidate who didn't nominate is "withdrawn").
    return candidates.filter((c) => c.district === d.id && !isInactive(c)).sort(candidateSort);
  }

  // The VEC's ballot paper for the seat (common.js ballotPaper), filled in after the first paint. Its height is
  // reserved from the number of candidates so nothing below it moves.
  const ballotHeight = (cands) => (vec === undefined ? 92 + 50 * Math.max(cands.length, 1) : 0);
  function ballotBlock(d) {
    if (vec === undefined) return `<p class="muted small">Loading the VEC's ballot paper…</p>`;
    const entry = vec && vec.districts && vec.districts[d.id];
    return entry ? App.ballotPaper(entry, "lower") : `<p class="empty">The VEC's list of candidates isn't loaded yet.</p>`;
  }

  /* ---------- Where to vote: data/voting_centres/<district>.json (scripts/vec_voting.py) ---------- */
  // The VEC's dates and hours (voting options page, checked 16 Nov 2026); the section's height doesn't depend on the data.
  const VOTE_TIMES = "<strong>Early voting:</strong> Wed 18 to Fri 27 Nov, 9 am to 6 pm (closed Sun 22 Nov). "
    + "<strong>Election day:</strong> Sat 28 Nov, 8 am to 6 pm. <strong>Postal vote applications</strong> close 6 pm Wed 25 Nov.";
  const ACCESS = { IWA: "Independent wheelchair access", AWA: "Assisted wheelchair access", LNWA: "Limited or no wheelchair access" };
  const centresFor = (id) => loadJSON(`voting_centres/${id}`);
  const dayMonth = (iso) => fmtDate(iso).replace(/ \d{4}$/, "");
  const hoursText = (hours) => (hours || []).map((h) => `${h.days ? `${escapeHtml(h.days)}, ` : ""}${escapeHtml(dayMonth(h.from))}${
    h.to && h.to !== h.from ? `–${escapeHtml(dayMonth(h.to))}` : ""} ${escapeHtml(h.open || "")}–${escapeHtml(h.close || "")}${h.note ? ` (${escapeHtml(h.note)})` : ""}`).join("; ");

  // The district's early and postal votes as the VEC publishes them (data/early_votes.json), against its enrolment.
  function earlyVotesLine(d, ev) {
    const n = (v) => Number(v).toLocaleString("en-AU");
    const enrol = ev && ev.enrolment && ev.enrolment.districts && ev.enrolment.districts[d.id];
    const fig = ev && ev.districts && ev.districts[d.id];
    const share = (v) => (enrol ? ` (${(100 * v / enrol).toFixed(1)}% of enrolment)` : "");
    const enrolText = enrol ? `${n(enrol)} people are enrolled in ${escapeHtml(d.name)} (VEC, close of roll${ev.enrolment.as_at ? `, ${escapeHtml(fmtDate(ev.enrolment.as_at))}` : ""}).` : "";
    if (!ev) return "Early and postal vote figures aren't available.";
    if (!fig || (fig.early == null && fig.postal_returned == null)) {
      return `${enrolText} The VEC hasn't published early or postal vote figures for ${escapeHtml(d.name)} yet.`;
    }
    const parts = [];
    if (fig.early != null) parts.push(`<strong>${n(fig.early)}</strong> early votes${share(fig.early)}`);
    if (fig.postal_returned != null) parts.push(`<strong>${n(fig.postal_returned)}</strong> postal votes returned${share(fig.postal_returned)}`);
    if (fig.postal_applications != null) parts.push(`${n(fig.postal_applications)} postal vote applications`);
    return `${fig.as_of ? `To ${escapeHtml(fmtDate(fig.as_of))}: ` : ""}${parts.join("; ")}. ${enrolText}`;
  }

  async function renderWhereToVote(d) {
    let doc = null, ev = null;
    [doc, ev] = await Promise.all([centresFor(d.id).catch((err) => { console.warn(err); return null; }),
      loadJSON("early_votes").catch(() => null)]);
    if (hashId() === d.id && $("wtv-early-votes")) $("wtv-early-votes").innerHTML = earlyVotesLine(d, ev);
    const sec = $("where-to-vote");
    if (hashId() !== d.id || !sec || !sec.isConnected) return;
    const names = Object.fromEntries(districts.map((x) => [x.id, x.name]));
    const item = (c) => `<li><strong>${escapeHtml(String(c.venue || c.name).replace(/\s*\(EVC\)$/, ""))}</strong>
        <span class="muted small">${escapeHtml([c.address, [c.suburb, c.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</span>
        <span class="small">${escapeHtml(ACCESS[c.access] || c.access || "")}${c.host ? ` · shared, run by ${escapeHtml(names[c.host] || c.host)} District`
          : c.joint ? " · shared with a neighbouring district" : ""}${c.hours ? ` · ${hoursText(c.hours)}` : ""}${c.lat == null ? ' · <span class="muted">not on the map</span>' : ""}</span></li>`;
    [["wtv-early", "early"], ["wtv-day", "election_day"]].forEach(([id, kind]) => {
      const box = $(id);
      const list = (doc && doc[kind]) || [];
      box.querySelector("[data-count]").textContent = doc ? `(${list.length})` : "";
      box.querySelector(".wtv-body").innerHTML = !doc ? "<p class=\"empty\">The VEC's voting centres aren't loaded yet.</p>"
        : list.length ? `<ul class="wtv-centres">${list.map(item).join("")}</ul>` : '<p class="empty">None listed by the VEC.</p>';
    });
  }

  /* ---------- Compare candidates: one column per candidate in ballot order, from their researched profiles ---------- */
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
    // Ballot order (the VEC's), else the order the candidate list uses.
    const order = vec && vec.districts && vec.districts[d.id] ? Object.fromEntries(vec.districts[d.id].candidates.map((c) => [c.id, c.ballot_position])) : {};
    const cands = seatCands(d).map((c) => ({ ...c, id: App.candidateId(d.id, c.name) }))
      .sort((a, b) => (order[a.id] ?? a.ballot_position ?? 99) - (order[b.id] ?? b.ballot_position ?? 99));
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
    const profiled = cands.filter((c) => profiles[c.id]).length;
    el.innerHTML = `<p class="muted small">In ballot order. From each candidate's researched profile, where every fact has a source (on the profile page).
        ${profiled < cands.length ? `${cands.length - profiled} of ${cands.length} candidates have no profile yet.` : ""} Scroll sideways for more candidates.</p>
      <div class="table-scroll cmp-scroll"><table class="cmp-table">
        <caption class="sr-only">Candidates for ${escapeHtml(d.name)} compared</caption>
        <thead><tr><td class="cmp-corner"></td>${cands.map((c) => `<th scope="col" style="--party-color: var(${App.partyVar(c.party)})">
          ${order[c.id] != null ? `<span class="cmp-pos">${order[c.id]}</span>` : ""}${App.profileLink(d.id, c.name)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${label}</th>${cands.map((c) => cell(fn(c, profiles[c.id]))).join("")}</tr>`).join("")}</tbody>
      </table></div>`;
  }

  function candidatesBlock(d, cands) {
    const anyBallot = cands.some((c) => c.ballot_position != null);
    return `${cands.length ? `
        <ul class="people">
          ${cands.map((c) => `
            <li class="${isInactive(c) ? "is-withdrawn" : ""}">
              ${anyBallot ? `<span class="pos" title="Ballot position">${c.ballot_position ?? "–"}</span>` : ""}
              ${App.avatar(shots, d.id, c.name, c.party)}
              <span class="name">${App.profileLink(d.id, c.name)}${c.incumbent ? ' <span class="muted small">(sitting MP)</span>' : ""}</span>
              ${partyBadge(c.party)}
              ${statusBadge(c.status)}
              ${c.source_url ? `<a class="small" href="${escapeHtml(c.source_url)}" rel="noopener">source</a>` : ""}
              ${c.notes ? `<span class="note muted small">${escapeHtml(c.notes)}</span>` : ""}
            </li>`).join("")}
        </ul>
        <p class="muted small" style="margin-top:8px">Last checked ${escapeHtml(fmtDate(cands.map((c) => c.updated).filter(Boolean).sort().pop()))}</p>
        ${App.photoCredits(shots, cands.map((c) => [d.id, c.name]))}`
        : '<p class="empty">No candidates recorded yet.</p>'}`;
  }

  function newsBlock(d) {
    return news === undefined ? '<p class="muted small">Loading headlines…</p>'
      : App.newsList(news && news.seats && news.seats[d.id], { more: 5 });
  }

  /* ---------- 2026 results (scripts/results.py) ---------- */
  // The seat's entry in results.json once votes are being counted, else null.
  function liveResult(d) {
    const r = results && results.districts && results.districts[d.id];
    return r && r.total ? r : null;
  }

  function resultsSlot(d, live) {
    if (live) {
      return `<section class="r26" id="r26" aria-labelledby="r26-h">
        <h3 id="r26-h">2026 results</h3><p class="empty">Loading 2026 results…</p></section>`;
    }
    if (!results) return "";
    return `<p class="r26-wait small"><strong>2026 results:</strong> counting begins 6 pm Sat 28 Nov. Figures from the
      <a href="https://www.vec.vic.gov.au/results" rel="noopener" target="_blank">Victorian Electoral Commission</a> will appear here as they're counted.</p>`;
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
      <p class="muted small" style="margin-top:4px">${counted.toFixed(1)}% of enrolment counted${centres ? ` · ${centres}` : ""}${swing}.
        Source: <a href="${escapeHtml(live.url || r.event.source)}" rel="noopener" target="_blank">Victorian Electoral Commission</a>${
        live.vec_updated ? `, updated ${escapeHtml(live.vec_updated)}` : ""}. Refreshed every 5 minutes.
        ${declarationText(live.declaration_votes)}
        ${live.holder && live.changes_hands ? `<strong>${escapeHtml(App.partyName(live.holder))} hold the seat; on these figures it would change hands.</strong>` : ""}</p>`;
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
    return `<p class="muted small" style="margin-top:0">${r.event.name && !/^State Election 2022/.test(r.event.name)
        ? `${escapeHtml(r.event.name)} (${escapeHtml(App.fmtDate(r.event.date))}), held after the November 2022 poll failed; results from the`
        : "Final 2022 results from the"} <a href="${escapeHtml(r.event.source)}" rel="noopener" target="_blank">VEC</a>.
        Swings compare with the notional 2018 result on today's boundaries (<a href="${escapeHtml((r.swing && r.swing.source) || "#")}" rel="noopener" target="_blank">Wikipedia</a>).</p>`;
  }

  /* ---------- Contest panels: 2026 live and 2022 history (vec-contest-v1 format) ---------- */
  const pct = (n, total) => (total ? (100 * n) / total : 0);
  const swingSpan = (v) => (v == null ? "" :
    ` <span class="small ${v >= 0 ? "swing-up" : "swing-down"}" title="Swing since the notional 2018 result">${App.fmtSwing(v)}</span>`);
  const TYPE_LABELS = { Ordinary: "Voting centres", EVCEarly: "Early voting centres", MobileVotingEarly: "Mobile voting",
    Early: "Early votes", Postal: "Postal", Absent: "Absent", MarkedAsVoted: "Marked as voted", Provisional: "Provisional" };

  // One contest panel for 2026 (live, results_2026/) and 2022 (history, results_2022/): same vec-contest-v1 format.
  // opts: {key ("r26" | "r22"), file, title, intro(r) -> html, live (results.json entry, 2026 only)}
  async function renderContest(d, opts) {
    const { key } = opts;
    const el = $(key);
    if (!el) return;
    // The booth map is below the fold: fetch Leaflet once the seat panel has painted.
    const leaflet = App.afterPaint(() => App.loadLib("leaflet")).catch(() => null);
    let r;
    try {
      r = await loadJSON(opts.file);
    } catch (err) {
      el.innerHTML = `<h3 id="${key}-h">${escapeHtml(opts.title)}</h3><p class="empty">${key === "r26" ? "2026 results" : "2022 results"} are not available for this district${key === "r26" ? " yet" : ""}.</p>`;
      return;
    }
    if (hashId() !== d.id || !el.isConnected) return;   // user moved on
    const cand = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
    const fp = r.first_preferences;
    const sw = (r.swing && r.swing.first_preferences) || {};
    const tsw = (r.swing && r.swing.tcp) || {};
    const fpRows = Object.entries(fp.candidates).sort((a, b) => b[1] - a[1]);
    const maxShare = Math.max(...fpRows.map(([, v]) => pct(v, fp.formal)));
    const label = (c) => `${escapeHtml(App.partyName(c.party))} <span class="muted small">${escapeHtml(c.name)}</span>`;

    // Booth-level 2CP is the VEC's indicative count. The headline uses the final distribution
    // of preferences when it ended with two candidates (it stops early once someone passes 50%).
    const tcpEntries = r.tcp ? Object.entries(r.tcp.candidates).sort((a, b) => b[1] - a[1]) : [];
    const dist = r.distribution && Object.keys(r.distribution.candidates).length === 2 ? r.distribution.candidates : null;
    const headEntries = dist ? Object.entries(dist).sort((a, b) => b[1] - a[1]) : tcpEntries;
    const headTotal = headEntries.reduce((a, [, v]) => a + v, 0);
    const byType = r.tcp ? Object.keys(r.tcp.by_type) : [];
    const elected = r.candidates.find((c) => c.elected);
    const name = (id) => `${escapeHtml(App.partyName(cand[id].party))} (${escapeHtml(cand[id].name.split(",")[0])})`;
    const notes = [];
    if (dist && r.tcp && !Object.keys(dist).every((id) => id in r.tcp.candidates)) {
      notes.push(`The VEC's voting-centre count was between ${tcpEntries.map(([id]) => name(id)).join(" and ")}, so the booth map compares those two; the final count was between ${headEntries.map(([id]) => name(id)).join(" and ")}.`);
    } else if (elected && tcpEntries.length && tcpEntries[0][0] !== elected.id) {
      notes.push(`${name(elected.id)} trailed in the VEC's indicative two-candidate count but won after the full distribution of preferences.`);
    }

    el.innerHTML = `
      <h3 id="${key}-h">${escapeHtml(opts.title)}</h3>
      ${opts.intro(r)}
      <h4>First preferences</h4>
      <ul class="vote-bars">
        ${fpRows.map(([id, v]) => {
          const c = cand[id];
          return `<li><span class="vb-name">${label(c)}</span>
            <span class="vb-track"><span class="vb-fill" style="display:block;width:${(100 * pct(v, fp.formal)) / maxShare}%;background:var(${App.partyVar(c.party)})"></span></span>
            <span class="vb-num">${pct(v, fp.formal).toFixed(1)}%${swingSpan(sw[id])}</span></li>`;
        }).join("")}
      </ul>
      <p class="muted small">${fp.formal.toLocaleString("en-AU")} formal votes, ${fp.informal.toLocaleString("en-AU")} informal (${pct(fp.informal, fp.total).toFixed(1)}%)${r.contest.enrolment ? `; enrolment ${r.contest.enrolment.toLocaleString("en-AU")}` : ""}.</p>
      ${headEntries.length ? `
        <h4>${dist ? "After preferences" : "Two-candidate preferred"}</h4>
        <div class="tcp-bar" role="img" aria-label="${headEntries.map(([id, v]) => `${App.partyName(cand[id].party)} ${pct(v, headTotal).toFixed(1)}%`).join(", ")}">
          ${headEntries.map(([id, v]) => `<span style="width:${pct(v, headTotal)}%;background:var(${App.partyVar(cand[id].party)})"></span>`).join("")}
        </div>
        <p>${headEntries.map(([id, v]) => `${label(cand[id])} <strong>${pct(v, headTotal).toFixed(1)}%</strong>${swingSpan(tsw[id])}`).join(" · ")}</p>
        ${notes.map((n) => `<p class="muted small">${n}</p>`).join("")}` : ""}
      <h4>Voting centres</h4>
      <div class="booth-map" id="${key}-booth-map"></div>
      <p class="muted small" id="${key}-booth-note"></p>
      ${byType.length ? `
        <div class="table-scroll" tabindex="0" role="region" aria-label="Two-candidate-preferred share by vote type (scrolls sideways)"><table>
          <thead><tr><th>Vote type (2CP)</th>${tcpEntries.map(([id]) => `<th class="num">${escapeHtml(App.partyShort(cand[id].party))}</th>`).join("")}<th class="num">Votes</th></tr></thead>
          <tbody>${byType.map((t) => {
            const row = r.tcp.by_type[t];
            const sum = Object.values(row).reduce((a, b) => a + (b || 0), 0);
            return `<tr><td>${escapeHtml(TYPE_LABELS[t] || t)}</td>${tcpEntries.map(([id]) => `<td class="num">${pct(row[id] || 0, sum).toFixed(1)}%</td>`).join("")}<td class="num">${sum.toLocaleString("en-AU")}</td></tr>`;
          }).join("")}</tbody>
        </table></div>` : ""}
      <details class="booth-table"><summary>All ${r.polling_places.length} voting centres</summary>
        <div class="table-scroll" tabindex="0" role="region" aria-label="Votes at every voting centre (scrolls sideways)"><table>
          <thead><tr><th>Voting centre</th><th class="num">Votes</th>${tcpEntries.map(([id]) => `<th class="num">${escapeHtml(App.partyShort(cand[id].party))} 2CP</th>`).join("")}</tr></thead>
          <tbody>${r.polling_places.slice().sort((a, b) => (b.total || 0) - (a.total || 0)).map((p) => {
            const s = p.tcp ? Object.values(p.tcp).reduce((a, b) => a + (b || 0), 0) : 0;
            return `<tr><td>${escapeHtml(p.name)}${p.lat == null ? ' <span class="muted small">(not mapped)</span>' : ""}</td><td class="num">${(p.total ?? 0).toLocaleString("en-AU")}</td>${tcpEntries.map(([id]) => `<td class="num">${p.tcp ? `${pct(p.tcp[id] || 0, s).toFixed(1)}%` : "–"}</td>`).join("")}</tr>`;
          }).join("")}</tbody>
        </table></div>
      </details>`;

    await leaflet;
    if (hashId() !== d.id || !el.isConnected) return;   // user moved on
    if (window.L && App.Maps) {
      const note = $(`${key}-booth-note`);
      const centres = await centresFor(d.id).catch(() => null);
      if (hashId() !== d.id || !note.isConnected) return;
      const mapped = await App.Maps.boothMap($(`${key}-booth-map`), d.id, r, centres);
      if (!mapped || !note.isConnected) return;   // user moved on
      const { placed, total } = mapped;
      note.textContent = `${placed} of ${total} voting centres mapped${key === "r26" ? " (at their 2022 locations; new centres are listed in the table only). Grey circles haven't reported yet" : ""}. Circles are sized by votes and coloured by the two-candidate-preferred leader; tap one for its numbers. Early, postal, absent and other declaration votes aren't tied to a place, so they're in the table below instead.${
        mapped.pins ? ` Pins mark the ${mapped.pins} places to vote in 2026 (VEC): square for an early voting centre, round for election day; tap one for its address.` : ""}`;
    } else {
      $(`${key}-booth-map`).remove();
      $(`${key}-booth-note`).textContent = "The map library failed to load; the voting-centre table below has every result.";
    }
  }

  function onHashChange() {
    const id = hashId();
    const d = districts.find((x) => x.id === id);
    // If a shared link points outside the current filters, clear them so it shows up.
    if (d && !filtered().includes(d)) { $("f-region").value = ""; $("f-area").value = ""; }
    renderDistrictOptions();
    renderList();
    renderDetail();
    if (d) $("district-detail").scrollIntoView({ block: "nearest" });
  }

  // Photos and headlines: fetched after the first paint, then swapped into the open seat's panel
  // (avatars keep their size, so nothing moves).
  function loadExtras() {
    Promise.all([App.loadHeadshots(), loadJSON("news").catch((err) => { console.warn(err); return null; }),
      loadJSON("vec_nominations").catch((err) => { console.warn(err); return null; })]).then(([shotData, newsData, vecData]) => {
      shots = shotData;
      news = newsData;
      vec = vecData;
      const d = districts.find((x) => x.id === hashId());
      if (d && $("seat-cands")) {
        $("seat-cands").innerHTML = candidatesBlock(d, seatCands(d));
        $("seat-news").innerHTML = newsBlock(d);
        $("seat-ballot").innerHTML = ballotBlock(d);
        $("seat-ballot").style.minHeight = "";
      }
    });
  }

  async function init() {
    try {
      const optional = (name) => loadJSON(name).catch((err) => { console.warn(err); return null; });
      // What the seat panel needs, in parallel. Photos and headlines wait until it has painted.
      const first = hashId();
      const [dd, cd, rd, meta, pollData, models, odds, seatPolls, resultData] = await Promise.all([
        loadJSON("districts"), loadJSON("candidates"), loadJSON("regions"),
        optional("meta"), optional("polls"), optional("seat_models"), optional("seat_odds"), optional("seat_polls"),
        optional("results"),
        first ? App.Htv.load(first).then((doc) => { htvDocs[first] = doc; }).catch(() => null) : null,
      ]);
      results = resultData;
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
      App.afterPaint(loadExtras);
    } catch (err) {
      window.App.showError($("district-list"), err);
    }
  }

  // Scripts are deferred, so the page is usually parsed by now: start loading the seat's data at once.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
