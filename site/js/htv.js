/* How-to-vote cards registered with the VEC (data/htv/<seat>.json, from scripts/vec_htv.py): every card for a
   district or region side by side, as the preference numbers it prints beside each candidate (Council: each group
   above the line), with a link to each original card; the candidates no card covers; and, flagged at the top, any
   Labor, Liberal or Nationals card that numbers One Nation or the Greens ahead of the other side of government.
   Orders are read from the card PDFs; a card that couldn't be read reliably is linked as "unreadable, see card".
   These are the registering party's or candidate's own recommendations: this site recommends nothing.
   Used by lower.html (seat page and Preference watch), upper.html, ballot.html and data/index.html. */
(function () {
  "use strict";
  const App = window.App;
  const { escapeHtml, partyName, partyShort, partyVar, fmtDate, loadJSON } = App;

  const REGISTER = "https://www.vec.vic.gov.au/voting/2026-state-election/how-to-vote-cards";
  const NAMES = { ALP: "Labor", LIB: "the Liberals", NAT: "the Nationals", LNP: "the Coalition", GRN: "the Greens", ONP: "One Nation" };
  const COALITION = ["LIB", "NAT", "LNP"];

  const load = (area) => loadJSON(`htv/${area}`);
  const link = (url, text) => (url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(text)} ↗</a>` : escapeHtml(text));
  // "same_as": a translated card that couldn't be read, given the order every readable card from the same registrant
  // prints for this seat (scripts/vec_htv.py); it joins that card's column with the note "same order as the English card".
  const isRead = (c) => ["read", "partial", "same_as"].includes(c.status) && ((c.order && c.order.length) || (c.atl && c.atl.length) || (c.btl && c.btl.length));
  const SAME_AS = "same order as the English card";

  // Who a card is from, as a short label: the party, or the person or group that registered it.
  function who(c) {
    if (c.kind === "party" && c.party && c.party !== "OTH") return partyName(c.party);
    return c.registered_by || "Not named in the VEC's list";
  }
  function whoHtml(c) {
    const dot = c.kind === "non_candidate" ? "--p-oth" : partyVar(c.party || "IND");
    const extra = c.kind === "non_candidate" ? ' <span class="muted small">(not a candidate)</span>' : (c.kind === "independent" ? ' <span class="muted small">(candidate)</span>' : "");
    return `<span class="party" style="--party-color: var(${dot})">${escapeHtml(who(c))}</span>${extra}`;
  }

  // Cards with the same registrant and the same reading collapse into one column (Labor's translations, reprints).
  function columns(doc) {
    const cols = new Map();
    for (const c of doc.cards || []) {
      if (!isRead(c)) continue;
      const key = `${c.kind}|${c.party}|${c.registered_by}|${JSON.stringify([c.order, c.atl, c.btl])}`;
      if (!cols.has(key)) cols.set(key, { card: c, cards: [], same: [] });
      const col = cols.get(key);
      if (c.status === "same_as") col.same.push(c);
      else { if (col.card.status === "same_as") col.card = c; col.cards.push(c); }
    }
    // Parties' cards in the site's fixed party order, then independents' cards, then others' (CLAUDE.md, "Ordering": no number shown, so the fixed order).
    const rank = (c) => (c.kind === "party" ? 0 : c.kind === "independent" ? 1 : 2);
    return [...cols.values()].sort((a, b) => rank(a.card) - rank(b.card)
      || (a.card.kind === "party" ? App.partyOrder(a.card.party, b.card.party) : 0) || who(a.card).localeCompare(who(b.card)));
  }

  // Orders with via "image" were read by eye from the card's picture (no text layer that read cleanly), twice, and kept
  // only when both readings agreed (scripts/vec_htv.py): the link says so, so readers check the card itself.
  const IMAGE = "read from card image";
  const byImage = (c) => c.via === "image";
  const checkTag = (c) => (byImage(c) ? ` <span class="htv-check" title="Numbers ${IMAGE}">check the card</span>` : "");
  // Column header: "read from card image" when every card in it was, else how many were.
  function imageNote(col) {
    const all = col.cards.concat(col.same), n = all.filter(byImage).length;
    return n ? `; ${n === all.length ? IMAGE : `${n} ${IMAGE}`}` : "";
  }
  const cardLinks = (cards) => cards.map((c) => link(c.card_url, `no. ${c.registration}`) + checkTag(c)).join(" ");

  // Rows of the table: candidates in ballot order (Assembly), or groups then ungrouped candidates (Council).
  function rows(doc) {
    const noCard = new Set(doc.no_card || []);
    const tag = ' <span class="htv-nocard">no card registered</span>';
    if (doc.house === "lower") {
      return (doc.ballot || []).map((b) => ({
        key: b.ballot_name, party: b.party,
        label: `${b.id ? `<a href="candidate.html#${escapeHtml(b.id)}">${escapeHtml(b.ballot_name)}</a>` : escapeHtml(b.ballot_name)}
          <span class="muted small">${escapeHtml(b.party_label || "Independent")}</span>${noCard.has(b.ballot_name) ? tag : ""}`,
        pref: (c) => (c.order ? c.order.indexOf(b.ballot_name) + 1 || null : null),
      }));
    }
    const groupRows = (doc.groups || []).map((g) => {
      const members = (doc.ballot || []).filter((b) => b.group === g.group);
      const none = members.length && members.every((m) => noCard.has(m.ballot_name));
      const label = !g.label || /^unnamed/i.test(g.label) ? "(no group name)" : g.label;
      return { key: g.group, party: g.party,
        label: `<span class="yb-gl">${escapeHtml(g.group)}</span> ${escapeHtml(label)}${none ? tag : ""}`,
        pref: (c) => (c.atl ? c.atl.indexOf(g.group) + 1 || null : null) };
    });
    const loose = (doc.ballot || []).filter((b) => !b.group).map((b) => ({
      key: b.ballot_name, party: b.party,
      label: `${escapeHtml(b.ballot_name)} <span class="muted small">ungrouped</span>${noCard.has(b.ballot_name) ? tag : ""}`,
      pref: () => null,
    }));
    return [...groupRows, ...loose];
  }

  // The table: one column per distinct card reading, one row per candidate (or group).
  function matrix(doc, caption) {
    const cols = columns(doc);
    const rs = rows(doc);
    const unread = (doc.cards || []).filter((c) => !isRead(c));
    // Two columns from one registrant (cards printing different orders) are numbered: "Labor (2)".
    const seenWho = {};
    cols.forEach((col) => { const w = who(col.card); seenWho[w] = (seenWho[w] || 0) + 1; col.n = seenWho[w]; });
    const tagOf = (col) => (seenWho[who(col.card)] > 1 ? ` (${col.n})` : "");
    const head = cols.map((col) => `<th scope="col" class="num htv-col">${whoHtml(col.card)}${escapeHtml(tagOf(col))}
        <span class="htv-col-meta">${col.cards.length} card${col.cards.length === 1 ? "" : "s"}${col.same.length ? ` + ${col.same.length} translated` : ""}${col.card.status === "partial" ? "; only these numbers read, see card" : ""}${imageNote(col)}</span></th>`).join("");
    const body = rs.map((r) => `<tr><th scope="row">${r.label}</th>${cols.map((col) => {
      const n = r.pref(col.card);
      return `<td class="num">${n == null ? '<span class="muted" aria-label="not numbered">–</span>' : n}</td>`;
    }).join("")}</tr>`).join("");
    const btl = cols.filter((col) => col.card.btl && col.card.btl.length && !(col.card.atl && col.card.atl.length));
    return `${cols.length ? `<div class="table-scroll htv-scroll" tabindex="0" role="region" aria-label="${escapeHtml(caption)} (scrolls sideways)"><table class="htv-matrix">
        <caption class="sr-only">${escapeHtml(caption)}</caption>
        <thead><tr><th scope="col">On the ballot</th>${head}</tr></thead>
        <tbody>${body}</tbody></table></div>
      <ul class="htv-links small">${cols.map((col) => `<li><strong>${escapeHtml(who(col.card) + tagOf(col))}:</strong> ${cardLinks(col.cards)}${col.same.length
        ? `; translated cards, ${SAME_AS}: ${cardLinks(col.same)}` : ""}</li>`).join("")}</ul>` : ""}
      ${btl.map((col) => `<p class="small">${escapeHtml(who(col.card))}'s card numbers candidates below the line:
        ${col.card.btl.map((n, i) => `${i + 1} ${escapeHtml(n)}`).join(", ")}.</p>`).join("")}
      ${unread.length ? `<p class="small htv-unread"><strong>Unreadable, see card:</strong> ${unread.map((c) =>
        `${escapeHtml(who(c))} ${link(c.card_url, `no. ${c.registration}`)}${c.status === "pending" ? ' <span class="muted">(not read yet)</span>' : ""}`).join("; ")}.</p>` : ""}`;
  }

  // The Coalition party a card's flag is about, by name, from the seat's ballot.
  function sideName(code, doc, card) {
    if (code !== "LNP") return NAMES[code] || partyName(code);
    if (doc.house === "lower" && card.order) {
      const parties = new Map((doc.ballot || []).map((b) => [b.ballot_name, b.party]));
      const first = card.order.map((n) => parties.get(n)).find((p) => COALITION.includes(p));
      return NAMES[first] || NAMES.LNP;
    }
    return NAMES.LNP;
  }

  // Facts flagged at the top: a Labor, Liberal or Nationals card numbering One Nation or the Greens ahead of the
  // other side of government. Identical statements from one party's cards are combined.
  function flagsHtml(doc) {
    const seen = new Map();
    for (const c of doc.cards || []) {
      for (const f of c.flags || []) {
        const text = `${NAMES[f.ahead]} (${f.ahead_n}) ahead of ${sideName(f.of, doc, c)} (${f.of_n})`;
        const key = `${c.party}|${text}`;
        if (!seen.has(key)) seen.set(key, { party: c.party, text, cards: [] });
        seen.get(key).cards.push(c);
      }
    }
    if (!seen.size) return "";
    return `<div class="htv-flags" role="note">
      <p class="htv-flags-h"><strong>Major-party cards that number One Nation or the Greens ahead of Labor or the Coalition</strong></p>
      <ul>${[...seen.values()].map((f) => `<li><span class="party" style="--party-color: var(${partyVar(f.party)})">${escapeHtml(partyName(f.party))}</span>
        ${f.cards.length > 1 ? `cards (${f.cards.length}) put` : "card puts"} ${escapeHtml(f.text)}. <span class="small">${cardLinks(f.cards)}</span></li>`).join("")}</ul>
      <p class="muted small">As printed on the registered cards: the numbers are the card's preferences. A statement of fact, not a recommendation.</p>
    </div>`;
  }

  // Labor-v-Greens seats (doc.labor_greens, set by scripts/vec_htv.py): which of the two each card ranks higher.
  function laborGreensHtml(doc) {
    if (!doc.labor_greens || doc.house !== "lower") return "";
    const party = new Map((doc.ballot || []).map((b) => [b.ballot_name, b.party]));
    const items = columns(doc).map((col) => {
      const order = col.card.order || [];
      const at = (code) => { const i = order.findIndex((n) => party.get(n) === code); return i < 0 ? null : i + 1; };
      const a = at("ALP"), g = at("GRN");
      const text = a && g ? (a < g ? `Labor (${a}) ahead of the Greens (${g})` : `the Greens (${g}) ahead of Labor (${a})`)
        : col.card.status === "partial" ? "doesn't number both (only these numbers read, see card)" : "doesn't number both";
      const n = col.cards.length + col.same.length;
      return `<li>${whoHtml(col.card)} ${n > 1 ? `cards (${n})` : "card"}: ${escapeHtml(text)}</li>`;
    });
    if (!items.length) return "";
    return `<div class="htv-lvg">
      <p class="htv-flags-h"><strong>Labor or the Greens: which each card ranks higher</strong></p>
      <ul>${items.join("")}</ul>
      <p class="muted small">From the cards read here (${escapeHtml(doc.labor_greens)}). Numbers are each card's preferences.</p>
    </div>`;
  }

  function statusLine(doc) {
    const n = (doc.cards || []).length;
    if (!doc || doc.status === "not_open") return "Registration with the VEC opens 9 am 10 Nov 2026. No cards registered yet.";
    const when = doc.status === "closed" ? `Registration closed ${fmtDate(doc.registration_closes || "2026-11-20")}.` : `Registration is open until ${fmtDate(doc.registration_closes || "2026-11-20")}.`;
    if (!n) return `${when} No cards registered here.`;
    const read = (doc.cards || []).filter(isRead).length;
    return `${n} card${n === 1 ? "" : "s"} registered with the VEC for ${escapeHtml(doc.name)} ${doc.house === "lower" ? "District" : "Region"}; ${read} read here. ${when}`;
  }

  // Seat page (lower.html) and region page (upper.html).
  function section(doc, opts = {}) {
    const id = escapeHtml((doc && doc.area) || opts.area || "x");
    if (!doc) {
      return `<section class="htv" aria-labelledby="htv-h-${id}"><h3 id="htv-h-${id}">How-to-vote cards</h3>
        <p class="muted small">The how-to-vote card register isn't available right now. <a href="${REGISTER}" target="_blank" rel="noopener">VEC register ↗</a></p></section>`;
    }
    const noCard = doc.no_card || [];
    const H = opts.h || "h3";
    return `<section class="htv" aria-labelledby="htv-h-${id}">
      <${H} id="htv-h-${id}">How-to-vote cards</${H}>
      <p class="muted small">${statusLine(doc)} <a href="${escapeHtml(doc.source_url || REGISTER)}" target="_blank" rel="noopener">VEC register ↗</a></p>
      ${flagsHtml(doc)}
      ${laborGreensHtml(doc)}
      ${matrix(doc, `Preference numbers on each registered how-to-vote card for ${doc.name}`)}
      ${(doc.cards || []).length ? `<p class="muted small">Each column is one party's or candidate's card${columns(doc).some((c) => c.cards.length > 1) ? " (cards printing the same order are combined)" : ""}, as registered with the VEC:
        their recommendation, not this site's. Numbers are read from each card's PDF; follow the links for the originals.${(doc.cards || []).some((c) => isRead(c) && byImage(c))
          ? ` Cards marked "${IMAGE}" print their numbers as a picture: they were read by eye, twice, and shown only where both readings agreed and every number fits the ballot, so check the card.` : ""}</p>` : ""}
      ${noCard.length ? `<p class="small"><strong>No card registered</strong> for ${noCard.length === (doc.ballot || []).length ? "any candidate" : `${noCard.length} candidate${noCard.length === 1 ? "" : "s"}`}:
        ${noCard.map((n) => escapeHtml(n)).join("; ")}.</p>` : ""}
    </section>`;
  }

  // Room to reserve for the section before the seat's file arrives (CLS): one table row per candidate.
  const reserve = (nRows) => 150 + 38 * (nRows + 1);

  /* ---------- lower.html: Preference watch, from htv/index.json ---------- */
  function watch(index, districts) {
    if (!index) return `<div class="card-head"><h2>Preference watch</h2></div><p class="muted small">The how-to-vote card summary isn't available right now.</p>`;
    const byId = new Map(districts.map((d) => [d.id, d]));
    const rows = index.watch || [];
    const seat = (id) => { const d = byId.get(id); return `<a href="lower.html#${escapeHtml(id)}">${escapeHtml(d ? d.name : id)}</a>`; };
    const flagged = (party, ahead) => rows.filter((r) => r.party === party && ((r.flags || []).some((f) => f.ahead === ahead) || (r.flags_some || []).some((f) => f.ahead === ahead)));
    const lines = [];
    for (const party of ["ALP", "LIB", "NAT"]) {   // the fixed party order
      const read = rows.filter((r) => r.party === party && r.read);
      if (!read.length) continue;
      for (const ahead of ["GRN", "ONP"]) {
        const list = flagged(party, ahead);
        const other = party === "ALP" ? "the Coalition" : "Labor";
        lines.push(`<li><span class="party" style="--party-color: var(${partyVar(party)})">${escapeHtml(partyName(party))}</span>
          cards put ${NAMES[ahead]} ahead of ${other} in <strong>${list.length}</strong> of the ${read.length} districts where their order was read${list.length ? `:
          <span class="small">${list.sort((a, b) => a.area.localeCompare(b.area)).map((r) => seat(r.area) + (r.differ ? "*" : "")).join(", ")}</span>` : "."}</li>`);
      }
    }
    // The Liberal decision in Labor-v-Greens seats.
    const left = districts.filter((d) => d.margin && ["ALP", "GRN"].includes(d.margin.party) && ["ALP", "GRN"].includes(d.margin.vs)).sort((a, b) => a.name.localeCompare(b.name));
    const libIn = (id) => rows.find((r) => r.area === id && r.party === "LIB");
    const leftItems = left.map((d) => {
      const r = libIn(d.id);
      let text = "No Liberal card registered";
      if (r && !r.read) text = "Liberal card registered; order unreadable, see card";
      else if (r && r.differ) text = "Liberal cards differ; see the seat page";
      else if (r && r.ranks) text = r.ranks.ALP && r.ranks.GRN ? (r.ranks.ALP < r.ranks.GRN ? `Labor (${r.ranks.ALP}) ahead of the Greens (${r.ranks.GRN})` : `Greens (${r.ranks.GRN}) ahead of Labor (${r.ranks.ALP})`) : "Card doesn't number both";
      return `<li class="${r && r.ranks ? "done" : "pending"}">${seat(d.id)} <span class="muted small">${escapeHtml(partyShort(d.margin.party))} v ${escapeHtml(partyShort(d.margin.vs))} ${d.margin.pct.toFixed(1)}</span>
        <span>${escapeHtml(text)}${r && r.card_url ? ` ${link(r.card_url, "card")}` : ""}</span></li>`;
    }).join("");
    const onp = rows.filter((r) => r.party === "ONP");
    const onpRead = onp.filter((r) => r.ranks);
    const coalitionFirst = onpRead.filter((r) => r.ranks.LNP && (!r.ranks.ALP || r.ranks.LNP < r.ranks.ALP)).length;
    const cov = index.coverage || {};
    return `
      <div class="card-head"><h2>Preference watch</h2><span class="muted small">How-to-vote cards registered with the VEC</span></div>
      <p class="muted small" style="margin-top:0">${(cov.cards || 0).toLocaleString("en-AU")} cards registered; preference orders read from each card's PDF
        (${(cov.orders_read || 0).toLocaleString("en-AU")} of ${(cov.listings || 0).toLocaleString("en-AU")} district and region listings). Facts from the cards, not recommendations.</p>
      <h3>Major-party cards</h3>
      <ul class="htv-watch-lines">${lines.join("") || "<li>No major-party orders read yet.</li>"}</ul>
      <p class="muted small">* Not every card that party registered there prints the same order.</p>
      <div class="grid grid-2">
        <div>
          <h3>Liberal cards in Labor-v-Greens seats</h3>
          <ul class="htv-watch">${leftItems}</ul>
        </div>
        <div>
          <h3>One Nation</h3>
          <p>${onp.length ? `One Nation cards are registered in ${onp.length} districts; orders read in ${onpRead.length}.
            ${onpRead.length ? `${coalitionFirst} of ${onpRead.length} put the Coalition ahead of Labor.` : ""}` : "No One Nation cards registered."}</p>
          <p class="muted small">Each seat page shows every card side by side.</p>
        </div>
      </div>`;
  }

  /* ---------- data/index.html: coverage ---------- */
  function coverage(index) {
    const cov = index.coverage || {};
    const label = (k, v) => (k === "IND" ? "Independent candidates" : k === "NONCAND" ? "Others (not standing)" : k === "UNNAMED" ? "Registrant not named in the VEC's list"
      : k === "OTH" ? `Other parties: ${(v.registered_by || []).join(", ")}` : App.partyName(k));
    const fmt = (n) => (n || 0).toLocaleString("en-AU");
    const rowsHtml = Object.entries(cov.by_party || {}).map(([k, v]) => `<tr><td>${k === "NONCAND" || k === "UNNAMED" ? escapeHtml(label(k, v)) : `<span class="party" style="--party-color: var(${partyVar(k)})">${escapeHtml(label(k, v))}</span>`}</td>
      <td class="num">${fmt(v.cards)}</td><td class="num">${fmt(v.districts)}</td><td class="num">${fmt(v.regions)}</td></tr>`).join("");
    const nc = cov.no_card || {};
    return `<p class="small" style="margin-top:0"><strong>${fmt(cov.cards)}</strong> cards registered, covering <strong>${fmt(cov.districts_with_cards)}</strong> of 88 districts
        and <strong>${fmt(cov.regions_with_cards)}</strong> of 8 regions. Preference orders read from ${fmt(cov.orders_read)} of ${fmt(cov.listings)} district and region listings${cov.orders_image ? `
        (${fmt(cov.orders_image)} of them ${IMAGE}: read by eye, twice, where the card's numbers are a picture)` : ""};
        ${cov.orders_same_as ? `${fmt(cov.orders_same_as)} more are translated cards shown with the order of the same registrant's English card for that seat ("${SAME_AS}");
        ` : ""}${fmt(cov.orders_unreadable)} are marked "unreadable, see card".</p>
      <p class="small"><strong>Candidates with no card</strong> from their party or themselves: ${fmt(nc.lower)} of ${fmt(nc.candidates_lower)} Assembly candidates and
        ${fmt(nc.upper)} of ${fmt(nc.candidates_upper)} Council candidates.</p>
      <div class="table-scroll" tabindex="0" role="region" aria-label="How-to-vote cards by who registered them"><table class="htv-cov">
        <thead><tr><th>Registered by</th><th class="num">Cards</th><th class="num">Districts covered</th><th class="num">Regions covered</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table></div>
      <p class="muted small">${index.last_checked ? `Register checked ${escapeHtml(App.fmtDateTime(index.last_checked))}. ` : ""}A card counts once however many districts and regions it covers.</p>`;
  }

  App.Htv = { load, section, matrix, flagsHtml, statusLine, watch, coverage, reserve, columns };
})();
