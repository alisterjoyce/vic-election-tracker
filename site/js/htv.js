/* How-to-vote cards (data/htv.json): a section on each seat and region page, and the
   "Preference watch" card on lower.html. Two decisions are flagged everywhere:
   where the Liberal card puts Labor and the Greens in Labor-v-Greens seats, and
   One Nation's preferences. Orders are entered by hand from the registered card PDFs. */
(function () {
  "use strict";
  const App = window.App;
  const { escapeHtml, partyShort, partyBadge, partyVar, fmtDate } = App;

  const LEFT_PAIR = ["ALP", "GRN"];
  const isLibCard = (c) => c.party === "LIB" || c.party === "LNP";

  function statusLine(htv, n) {
    if (!htv || htv.status === "not_open") {
      return `Registration with the VEC opens 9 am ${escapeHtml(fmtDate((htv && htv.registration_opens) || "2026-11-10"))}. No cards registered yet.`;
    }
    if (!n) return "Registration is open; no cards registered here yet.";
    return `${n} card${n === 1 ? "" : "s"} registered with the VEC.`;
  }

  // Index of a party (or a Coalition party) in a card's order; -1 if absent.
  function rank(order, code) {
    const codes = code === "LNP" ? ["LNP", "LIB", "NAT"] : [code];
    return order.findIndex((x) => codes.includes(x));
  }

  // One line on what the Liberal card does with Labor and the Greens.
  function libDecision(card) {
    if (!card) return { text: "Not yet registered", state: "pending" };
    if (!card.order) return { text: "Card registered; preference order not yet entered", state: "pending", card };
    const a = rank(card.order, "ALP"), g = rank(card.order, "GRN");
    if (a < 0 || g < 0) return { text: "Card doesn't rank both Labor and the Greens", state: "done", card };
    return { text: a < g ? "Labor ahead of the Greens" : "Greens ahead of Labor", state: "done", card };
  }

  function onpDecision(card) {
    if (!card) return { text: "Not yet registered", state: "pending" };
    if (!card.order) return { text: "Card registered; preference order not yet entered", state: "pending", card };
    const next = card.order.filter((x) => x !== "ONP").slice(0, 3).map((x) => App.PARTIES[x] ? partyShort(x) : x);
    const l = rank(card.order, "LNP"), a = rank(card.order, "ALP");
    const lean = l >= 0 && a >= 0 ? (l < a ? "Coalition ahead of Labor" : "Labor ahead of the Coalition") : "";
    return { text: `${lean}${lean ? "; " : ""}next preferences ${next.join(", ")}`, state: "done", card };
  }

  const cardLink = (c) => (c && c.card_url ? ` <a href="${escapeHtml(c.card_url)}" target="_blank" rel="noopener">card ↗</a>` : "");

  function flag(title, decision) {
    return `<div class="htv-flag ${decision.state}">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(decision.text)}${cardLink(decision.card)}</span>
      </div>`;
  }

  /* opts: {district?, region?, margin? (districts.json margin), parties: party codes standing here} */
  function section(htv, opts) {
    const cards = ((htv && htv.cards) || []).filter((c) => (opts.district ? c.district === opts.district : c.region === opts.region));
    const m = opts.margin;
    const leftContest = m && LEFT_PAIR.includes(m.party) && LEFT_PAIR.includes(m.vs);
    const flags = [];
    if (leftContest) flags.push(flag("Liberal preferences in this Labor-v-Greens seat", libDecision(cards.find(isLibCard))));
    if ((opts.parties || []).includes("ONP") || cards.some((c) => c.party === "ONP")) {
      flags.push(flag("One Nation preferences", onpDecision(cards.find((c) => c.party === "ONP"))));
    }
    return `
      <section class="htv" aria-labelledby="htv-h-${escapeHtml(opts.district || opts.region)}">
        <h3 id="htv-h-${escapeHtml(opts.district || opts.region)}">How-to-vote preferences</h3>
        <p class="muted small">${statusLine(htv, cards.length)} <a href="${escapeHtml((htv && htv.source_url) || "#")}" target="_blank" rel="noopener">VEC register ↗</a></p>
        ${flags.join("")}
        ${cards.length ? `<div class="table-scroll"><table class="htv-table">
          <thead><tr><th>Registered by</th><th>Registered</th><th>Preference order</th><th></th></tr></thead>
          <tbody>${cards.map((c) => `<tr>
            <td>${c.party ? partyBadge(c.party) : escapeHtml(c.registered_by)}</td>
            <td>${c.registered_on ? escapeHtml(fmtDate(c.registered_on)) : "–"}</td>
            <td>${c.order ? `<ol class="htv-order">${c.order.map((x) => `<li style="--party-color: var(${partyVar(App.PARTIES[x] ? x : "OTH")})">${escapeHtml(App.PARTIES[x] ? partyShort(x) : x)}</li>`).join("")}</ol>`
              : '<span class="muted">Not yet entered</span>'}</td>
            <td>${c.card_url ? `<a href="${escapeHtml(c.card_url)}" target="_blank" rel="noopener">PDF ↗</a>` : ""}</td></tr>`).join("")}</tbody>
        </table></div>` : ""}
      </section>`;
  }

  /* Statewide summary for lower.html: the Liberal decision in every Labor-v-Greens seat, and One Nation's cards. */
  function watch(htv, districts, candidates) {
    const cards = (htv && htv.cards) || [];
    const left = districts.filter((d) => d.margin && LEFT_PAIR.includes(d.margin.party) && LEFT_PAIR.includes(d.margin.vs))
      .sort((a, b) => a.name.localeCompare(b.name));
    const onpSeats = new Set(candidates.filter((c) => c.district && c.party === "ONP" && c.status !== "superseded" && c.status !== "withdrawn").map((c) => c.district));
    const onpCards = cards.filter((c) => c.party === "ONP" && c.house === "lower");
    const entered = onpCards.filter((c) => c.order);
    const coalitionFirst = entered.filter((c) => { const l = rank(c.order, "LNP"), a = rank(c.order, "ALP"); return l >= 0 && (a < 0 || l < a); }).length;
    return `
      <div class="card-head"><h2>Preference watch</h2><span class="muted small">How-to-vote cards</span></div>
      <p class="muted small" style="margin-top:0">${statusLine(htv, cards.length)} Preference orders are entered from each registered card.</p>
      <div class="grid grid-2">
        <div>
          <h3>Liberal cards in Labor-v-Greens seats</h3>
          <ul class="htv-watch">${left.map((d) => {
            const dec = libDecision(cards.find((c) => c.district === d.id && isLibCard(c)));
            return `<li class="${dec.state}"><a href="lower.html#${escapeHtml(d.id)}">${escapeHtml(d.name)}</a>
              <span class="muted small">${escapeHtml(partyShort(d.margin.party))} v ${escapeHtml(partyShort(d.margin.vs))} ${d.margin.pct.toFixed(1)}</span>
              <span>${escapeHtml(dec.text)}${cardLink(dec.card)}</span></li>`;
          }).join("")}</ul>
        </div>
        <div>
          <h3>One Nation</h3>
          <p>${onpCards.length
            ? `${onpCards.length} lower-house card${onpCards.length === 1 ? "" : "s"} registered; ${entered.length} entered so far.
               ${entered.length ? `${coalitionFirst} of ${entered.length} put the Coalition ahead of Labor.` : ""}`
            : `No cards registered yet. One Nation is standing in ${onpSeats.size} lower-house seats.`}</p>
          <p class="muted small">Each seat page shows the One Nation card's order once it's entered.</p>
        </div>
      </div>`;
  }

  App.Htv = { section, watch };
})();
