/* Forecast comparison for one seat (the seat page's Forecasts row and the Key contests page): a one-line summary of
   what each source favours, a table with one row per candidate sorted by the median win chance across the sources
   that give one (largest first, ballot position as a column) and a column per source with its date, each source's
   favourite highlighted; the likeliest final pairings beside the 2022 final pair; the model's first-preference
   ranges. It describes the sources only and never makes a call of its own. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, fmtDate, partyShort, partyBadge } = App;
  const fmt1 = (n) => Number(n).toFixed(1);

  // The Forecasts row: a one-line summary of what the sources say, a table with one row per candidate (sorted by
  // the median win chance across the sources that give one, largest first; ballot position as a column) and one
  // column per source with its date, each source's favourite highlighted, then the likeliest final pairings beside
  // the 2022 final pair, and the model's first-preference ranges. Facts about the sources only: no call of our own.
  const pctText = (n) => `${n < 0.05 && n > 0 ? "<0.1" : fmt1(n)}%`;
  const normName = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim();
  const surname = (s) => normName(s).split(" ").pop();

  // A source's row for a tracker candidate: the same name, else the same party and surname, else the only row of
  // that party (not for independents, who can be several).
  function matchCand(c, rows, nameOf = (r) => r.name) {
    const n = normName(c.name);
    return rows.find((r) => nameOf(r) && normName(nameOf(r)) === n)
      || rows.find((r) => r.party === c.party && nameOf(r) && surname(nameOf(r)) === surname(c.name))
      || (!["IND", "OTH"].includes(c.party) && rows.filter((r) => r.party === c.party && !r.candidate).length === 1
        ? rows.find((r) => r.party === c.party && !r.candidate) : null);
  }

  // Sportsbet's prices as chances: 1/price for each option, scaled so the whole market adds to 100% (the
  // bookmaker's margin removed in proportion). Not scaled when the shortest prices were cut off (partial).
  function impliedChances(seatOdds) {
    const opts = (seatOdds && seatOdds.options || []).filter((o) => o.price > 1);
    if (!opts.length) return null;
    const book = opts.reduce((s, o) => s + 1 / o.price, 0);
    const scale = seatOdds.partial ? 100 : 100 / book;
    return { book, partial: !!seatOdds.partial, hidden: !!seatOdds.more_options_hidden,
      opts: opts.map((o) => ({ ...o, chance: scale / o.price })) };
  }

  const median = (v) => { const s = v.slice().sort((a, b) => a - b), k = s.length; return k ? (k % 2 ? s[(k - 1) / 2] : (s[k / 2 - 1] + s[k / 2]) / 2) : null; };

  // ctx: {models: seat_models.json, odds: seat_odds.json, cands: the seat's active candidates (candidates.json rows or
  // vec_nominations.json entries: name, party, ballot_position)}. Returns {html, topMed (the leader's median chance or
  // null), split (the sources' favourites are different parties), favs ([[source, party]]), holder}.
  function build(d, ctx) {
    const odds = ctx.odds || null;
    const seatOdds = odds && (odds.seats || []).find((x) => x.district === d.id);
    const doc = ctx.models || {};
    const models = doc.models || [];
    const entry = (m) => (doc.seats || []).find((x) => x.district === d.id && x.model === m.id);
    const cands = ctx.cands || [];
    const aef = models.find((m) => m.kind === "forecast" && m.published);
    const aefE = aef && entry(aef);
    const mrps = models.filter((m) => m.kind === "mrp" && m.published);
    const rb = models.find((m) => m.kind === "projection" && m.published);
    const rbE = rb && entry(rb);
    const imp = impliedChances(seatOdds);
    const oddsDate = seatOdds && (seatOdds.date_checked || (odds && odds.date_checked));

    // Each source as a column: cell(c) -> {chance?, text, fav}; head (name, linked, and its date).
    const NM = '<span class="muted small">not modelled</span>';
    const cols = [];
    if (aef) {
      const rows = (aefE && aefE.candidates) || [];
      const top = rows.reduce((a, r) => (!a || r.win_probability > a.win_probability ? r : a), null);
      cols.push({ key: "aef", head: `${App.modelLink(aef)}<span class="fc-date">win chance, model of ${escapeHtml(fmtDate(aef.model_date))}</span>`,
        cell: (c) => { const r = rows.length ? matchCand(c, rows) : null;
          return r ? { chance: r.win_probability, text: pctText(r.win_probability), fav: r === top } : { text: NM }; },
        others: aefE ? (aefE.others || []).reduce((s, o) => s + (o.win_probability || 0), 0) : null,
        fav: top && top.party, label: "Australian Election Forecasts" });
    }
    mrps.forEach((m) => {
      const e = entry(m);
      cols.push({ key: m.id, head: `<a href="${escapeHtml(m.source_url || "#")}" rel="noopener" target="_blank">${escapeHtml(m.name)}</a><span class="fc-date">call, fieldwork ${escapeHtml(m.fieldwork || "")}</span>`,
        cell: (c) => {
          if (!e || !e.winner) return { text: NM };
          const one = (p) => cands.filter((x) => x.party === p).length === 1;   // a party call names a candidate only if it has one
          if (c.party === e.winner && one(e.winner)) return { text: `Win${e.winner_2cp != null ? ` <span class="muted small">${fmt1(e.winner_2cp)}% 2CP</span>` : ""}`, fav: true };
          if (c.party === e.runner_up && one(e.runner_up)) return { text: "Runner-up" };
          return { text: '<span class="muted">–</span>' };
        }, fav: e && e.winner, label: m.name });
    });
    if (rb) {
      const toss = (rb.toss_ups || []).includes(d.id);
      cols.push({ key: rb.id, head: `<a href="${escapeHtml(rb.source_url)}" rel="noopener" target="_blank">${escapeHtml(rb.name)}</a><span class="fc-date">rating, ${escapeHtml(fmtDate(rb.published_date))}</span>`,
        cell: (c) => (rbE && rbE.winner ? (c.party === rbE.winner ? { text: "Favoured", fav: true } : { text: '<span class="muted">–</span>' })
          : toss ? { text: "Toss-up" } : { text: NM }),
        fav: rbE && rbE.winner, label: rb.name });
    }
    {
      const rows = imp ? imp.opts.filter((o) => o.party) : [];
      const top = imp ? imp.opts.reduce((a, o) => (!a || o.chance > a.chance ? o : a), null) : null;
      const matched = new Set();
      cols.push({ key: "odds", head: `Sportsbet<span class="fc-date">implied chance${imp && !imp.partial ? ", margin removed" : ""}${oddsDate ? `, as at ${escapeHtml(fmtDate(oddsDate))}` : ""}</span>`,
        cell: (c) => { const o = rows.length ? matchCand(c, rows, (r) => r.candidate || null) || (c.party !== "IND" ? matchCand(c, rows.filter((r) => !r.candidate)) : null) : null;
          if (!o) return { text: imp ? '<span class="muted small">not offered</span>' : NM };
          matched.add(o);
          return { chance: o.chance, text: `${pctText(o.chance)} <span class="muted small">${App.fmtPrice(o.price)}</span>`, fav: o === top }; },
        matched, imp, fav: top && top.party, label: "Sportsbet" });
    }

    // Rows: every active candidate, sorted by the median of the chances the sources give, then ballot order.
    const rows = cands.map((c) => {
      const cells = cols.map((col) => col.cell(c));
      const chances = cells.map((x) => x.chance).filter((v) => v != null);
      return { c, cells, med: median(chances), n: chances.length };
    }).sort((a, b) => ((b.med ?? -1) - (a.med ?? -1)) || App.candidateOrder(a.c, b.c));

    // Anyone else: the model's emerging independent/party allowance and Sportsbet's "Any Other" plus any option for
    // someone not on the ballot (e.g. a named independent who didn't nominate).
    const oddsCol = cols.find((x) => x.key === "odds");
    const stray = oddsCol.imp ? oddsCol.imp.opts.filter((o) => !oddsCol.matched.has(o)) : [];
    const strayNames = stray.filter((o) => o.party).map((o) => o.label);
    const otherCells = cols.map((col) => col.key === "aef" ? (col.others != null ? { text: pctText(col.others) } : { text: NM })
      : col.key === "odds" ? (stray.length ? { text: pctText(stray.reduce((s, o) => s + o.chance, 0)) } : { text: '<span class="muted">–</span>' })
      : { text: '<span class="muted">–</span>' });

    const td = (x) => `<td class="${x.fav ? "fc-fav" : ""}"${x.chance != null ? ` data-csv="${fmt1(x.chance)}"` : ""}>${x.text}</td>`;
    const table = `<div class="table-scroll" role="region" tabindex="0" aria-label="Forecasts for each candidate in ${escapeHtml(d.name)}">
      <table class="fc-table"><thead><tr><th class="fc-cand-h">Candidate</th><th class="num">Median chance</th><th class="num">Ballot</th>${cols.map((col) => `<th>${col.head}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="fc-cand" style="--party-color: var(${App.partyVar(r.c.party)})">${App.profileLink(d.id, r.c.name)} <span class="muted small">${escapeHtml(partyShort(r.c.party))}</span></td>
        <td class="num" data-csv="${r.med != null ? fmt1(r.med) : ""}">${r.med != null ? `<strong>${pctText(r.med)}</strong>` : '<span class="muted small">none</span>'}</td>
        <td class="num">${r.c.ballot_position || "–"}</td>${r.cells.map(td).join("")}</tr>`).join("")}
        <tr class="fc-others"><td class="fc-cand">Anyone else${strayNames.length ? ` <span class="muted small">(incl. Sportsbet's ${escapeHtml(strayNames.join(", "))})</span>` : ""}</td><td class="num">–</td><td class="num">–</td>${otherCells.map(td).join("")}</tr>
      </tbody></table></div>`;

    // The summary: who each source favours, against the party that holds the seat. Descriptions of the sources only.
    const favs = [];
    cols.forEach((col) => {
      if (col.key === "aef" && col.fav) favs.push([col.label, col.fav]);
      else if (col.key === "odds" && col.fav && !(oddsCol.imp && oddsCol.imp.partial)) favs.push([col.label, col.fav]);
      else if (col.key !== "aef" && col.key !== "odds" && col.fav) favs.push([col.label, col.fav]);
    });
    const holder = d.party;
    const name = (p) => App.partyName(p);
    let summary;
    if (!favs.length) summary = `No source rates ${d.name}.`;
    else {
      const byParty = {};
      favs.forEach(([src, p]) => { (byParty[p] = byParty[p] || []).push(src); });
      const medOf = (p) => Math.max(-1, ...rows.filter((r) => r.c.party === p && r.med != null).map((r) => r.med));
      const parties = Object.keys(byParty).sort((a, b) => byParty[b].length - byParty[a].length || medOf(b) - medOf(a) || App.partyOrder(a, b));
      if (parties.length === 1) {
        const p = parties[0];
        summary = `${favs.length === 1 ? `The only source that rates ${d.name}, ${favs[0][0]},` : `All ${favs.length} sources`} favour${favs.length === 1 ? "s" : ""} ${p === holder ? `${name(p)} to hold ${d.name}` : `${name(p)} to win ${d.name} from ${name(holder)}`}.`;
      } else if (!byParty[holder]) {
        summary = `No source favours ${name(holder)} to hold ${d.name}; they split between ${parties.map((p) => `${name(p)} (${byParty[p].join(", ")})`).join(" and ")}.`;
      } else {
        const list = parties.map((p) => `${name(p)} (${byParty[p].join(", ")})`);
        summary = `Sources split between ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}; ${name(holder)} holds ${d.name}.`;
      }
    }

    // Likely final two: the model's final pairings with their chance, largest first, each pair with the party it
    // puts ahead (median 2CP) first; and the 2022 final pair (filled in from results_2022/, its line reserved).
    const pairs = ((aefE && aefE.two_cp) || []).slice().sort((a, b) => b.probability - a.probability).slice(0, 3).map((s) => {
      const [a, b] = s.parties, sh = s.share ? s.share[1] : null;
      const order = sh != null && sh < 50 ? [[b, 100 - sh], [a, sh]] : [[a, sh], [b, sh != null ? 100 - sh : null]];
      return `<li><strong>${order.map(([p, v]) => `${escapeHtml(name(p))}${v != null ? ` ${fmt1(v)}` : ""}`).join(" v ")}</strong> <span class="muted small">${pctText(s.probability)} chance of this final pair</span></li>`;
    });
    const final2 = `<div class="fc-final2"><h4>Likely final two</h4>
      ${pairs.length ? `<ol class="fc-pairs">${pairs.join("")}</ol><p class="muted small">From ${aef ? App.modelLink(aef) : "the model"}: the chance each pair is the last two in the count, with the model's median two-candidate-preferred split.</p>`
        : '<p class="muted small">No source publishes final-pair chances for this seat.</p>'}
      <p class="small fc-2022" data-fc2022="${escapeHtml(d.id)}">&nbsp;</p></div>`;

    const fpRows = ((aefE && aefE.candidates) || []).slice().sort((a, b) => b.win_probability - a.win_probability).map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${partyBadge(c.party, { full: false })}</td>
      <td class="num">${pctText(c.win_probability)}</td><td class="num">${c.fp ? `${fmt1(c.fp[1])} <span class="muted small">(${fmt1(c.fp[0])}–${fmt1(c.fp[2])})</span>` : "–"}</td></tr>`).join("");
    const notes = [
      "Median chance: the middle of the win chances the sources give (the average of two where two do); sources that make a call without a chance aren't counted in it.",
      imp ? (imp.partial ? "Sportsbet: part of the market was cut off, so its chances are 1 ÷ price with the bookmaker's margin left in."
        : `Sportsbet: each price as 1 ÷ price, scaled so the market adds to 100% (its prices added to ${fmt1(100 * imp.book)}%)${imp.hidden ? "; longer-priced options Sportsbet folded away aren't included" : ""}.`) : "",
      "The highlighted cell in each column is that source's favourite. The Swing Is On isn't included: it states no licence for reuse.",
    ].filter(Boolean).join(" ");
    const html = `<p class="fc-summary">${escapeHtml(summary)}</p>${table}<p class="muted small fc-notes">${escapeHtml(notes)}</p>${final2}
      ${fpRows ? `<details class="fc-detail"><summary>First-preference ranges (Australian Election Forecasts)</summary>
        <div class="table-scroll"><table data-no-csv><thead><tr><th>Candidate</th><th>Party</th><th class="num">Win</th><th class="num">First pref. % (90% range)</th></tr></thead><tbody>${fpRows}</tbody></table></div></details>` : ""}`;
    const favParties = new Set(favs.map(([, p]) => p));
    return { html, topMed: rows.length && rows[0].med != null ? rows[0].med : null, split: favParties.size > 1, favs, holder, summary };
  }

  // The 2022 final pair, from results_2022/<id>.json, into the line the Forecasts block reserves (within root).
  async function fillFinal2022(d, root = document) {
    const find = () => root.querySelector(`[data-fc2022="${d.id}"]`);
    try {
      const r = await loadJSON(`results_2022/${d.id}`);
      const el = find();
      if (!el) return;
      const tcp = r.tcp && r.tcp.candidates, byId = Object.fromEntries((r.candidates || []).map((c) => [c.id, c]));
      const ids = tcp ? Object.keys(tcp) : [];
      if (ids.length !== 2) { el.textContent = "2022: no two-candidate count published."; return; }
      const total = ids.reduce((s, id) => s + tcp[id], 0);
      const pair = ids.map((id) => [byId[id], (100 * tcp[id]) / total]).sort((a, b) => b[1] - a[1]);
      el.innerHTML = `In 2022 the final two were ${pair.map(([c, v]) => `<strong>${escapeHtml(App.partyName(c.party))} ${fmt1(v)}</strong>`).join(" v ")} <span class="muted">(VEC)</span>.`;
    } catch (e) {
      const el = find();
      if (el) el.textContent = "";
    }
  }

  App.Forecasts = { build, cell: (d, ctx) => build(d, ctx).html, fillFinal2022 };
})();
