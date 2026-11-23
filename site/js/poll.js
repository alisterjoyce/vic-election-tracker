/* Poll detail (poll.html#<poll id>) with a trend line for that pollster against the poll of polls,
   and, with no hash, the full list of polls. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyName, partyVar, partyColor, cssVar, fmtDate, hashId, copyLink } = App;

  // Leaders named in Wikipedia's leadership tables -> party (for bar colours).
  const LEADER_PARTY = { Carroll: "ALP", Allan: "ALP", Andrews: "ALP", Wilson: "LIB", Battin: "LIB", Pesutto: "LIB", Guy: "LIB", Pickering: "ONP", Sandell: "GRN" };
  // Records shown on a poll's page: new highs and lows for these parties' primaries, and the Coalition's 2PP.
  const RECORD_NAMES = { ALP: "Labor", LNP: "Coalition", GRN: "Greens", ONP: "One Nation" };
  // In the site's fixed party order (Greens, Labor, Liberal/National, One Nation), 2PP first.
  const MEASURES = [
    { key: "tpp.ALP", label: "Labor 2PP", party: "ALP" },
    { key: "tpp.LNP", label: "L/NP 2PP", party: "LNP" },
    { key: "primary.GRN", label: "Greens primary", party: "GRN" },
    { key: "primary.ALP", label: "Labor primary", party: "ALP" },
    { key: "primary.LNP", label: "L/NP primary", party: "LNP" },
    { key: "primary.ONP", label: "One Nation primary", party: "ONP" },
  ];

  let polls = [];
  let chart = null;
  let measure = MEASURES[0];
  const $ = (id) => document.getElementById(id);
  const get = (p, key) => { const [a, b] = key.split("."); const v = p[a] && p[a][b]; return v == null || isNaN(v) ? null : v; };

  function fieldwork(p) {
    if (!p.start_date || p.start_date === p.end_date) return fmtDate(p.end_date);
    const [s, e] = [p.start_date, p.end_date];
    if (s.slice(0, 7) === e.slice(0, 7)) return `${Number(s.slice(8))}–${fmtDate(e)}`;
    return `${fmtDate(s)} – ${fmtDate(e)}`;
  }

  function bars(entries, max) {
    return `<ul class="vote-bars">${entries.map(([label, party, v]) => `
      <li><span class="vb-name">${escapeHtml(label)}</span>
        <span class="vb-track"><span class="vb-fill" style="display:block;width:${(100 * v) / max}%;background:var(${partyVar(party)})"></span></span>
        <span class="vb-num">${v}%</span></li>`).join("")}</ul>`;
  }

  function splitBar(entries) {
    const total = entries.reduce((a, [, , v]) => a + v, 0);
    return `<div class="tcp-bar" role="img" aria-label="${escapeHtml(entries.map(([l, , v]) => `${l} ${v}%`).join(", "))}">
        ${entries.map(([, party, v]) => `<span style="width:${(100 * v) / total}%;background:var(${partyVar(party)})"></span>`).join("")}</div>
      <p>${entries.map(([l, , v]) => `${escapeHtml(l)} <strong>${v}%</strong>`).join(" · ")}</p>`;
  }

  /* ---------- House effect: this pollster minus the other pollsters' average on the same day ---------- */
  function houseEffect(own, key) {
    const firm = own.length ? own[0].pollster : null;
    const series = App.smoothedSeries(polls.filter((p) => p.pollster !== firm), (p) => get(p, key));
    if (!series.length) return null;
    const at = (t) => {
      let best = series[0];
      for (const pt of series) { if (Math.abs(pt.x - t) < Math.abs(best.x - t)) best = pt; }
      return best.y;
    };
    const diffs = own.filter((p) => get(p, key) != null).map((p) => get(p, key) - at(p.t));
    if (!diffs.length) return null;
    return { mean: diffs.reduce((a, b) => a + b, 0) / diffs.length, n: diffs.length, series };
  }

  function renderTrend(p) {
    const own = polls.filter((x) => x.pollster === p.pollster);
    const canvas = $("trend-chart");
    const he = houseEffect(own, measure.key);
    $("house-effect").innerHTML = he
      ? `${escapeHtml(p.pollster)}'s ${escapeHtml(measure.label)} has averaged <strong>${App.fmtSwing(he.mean)}</strong> points
         against the average of every other pollster on the same day, across ${he.n} poll${he.n === 1 ? "" : "s"}.
         A consistent gap is a house effect: a lean that comes from the pollster's method rather than from voters.`
      : `${escapeHtml(p.pollster)} hasn't published a ${escapeHtml(measure.label)} figure.`;
    if (!window.Chart) { canvas.parentElement.innerHTML = '<p class="empty">Chart library failed to load.</p>'; return; }
    const color = partyColor(measure.party);
    const text = cssVar("--muted"), grid = cssVar("--border"), faint = cssVar("--border");
    const others = polls.filter((x) => x.pollster !== p.pollster && get(x, measure.key) != null);
    const mine = own.filter((x) => get(x, measure.key) != null);
    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      data: {
        datasets: [
          { type: "line", label: `${p.pollster}`, data: mine.map((x) => ({ x: x.t, y: get(x, measure.key), poll: x })),
            borderColor: color, backgroundColor: color, borderWidth: 2.5, tension: 0,
            pointRadius: mine.map((x) => (x.id === p.id ? 7 : 4)), pointHoverRadius: 7 },
          { type: "line", label: "Other pollsters' average", data: he ? he.series : [],
            borderColor: text, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0 },
          { type: "scatter", label: "Other pollsters", data: others.map((x) => ({ x: x.t, y: get(x, measure.key), poll: x })),
            backgroundColor: faint, borderColor: "transparent", pointRadius: 3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: true },
        onClick: (evt, els) => {
          const raw = els.length && chart.data.datasets[els[0].datasetIndex].data[els[0].index];
          if (raw && raw.poll && raw.poll.id) location.hash = raw.poll.id;
        },
        scales: {
          x: { type: "linear", grid: { color: grid }, ticks: { color: text, callback: (v) => App.fmtMonth(v), maxRotation: 0, autoSkipPadding: 16 } },
          y: { grid: { color: grid }, ticks: { color: text, callback: (v) => `${v}%` } },
        },
        plugins: {
          legend: { labels: { color: text, usePointStyle: true } },
          tooltip: { callbacks: {
            title: (items) => (items.length ? fmtDate(new Date(items[0].parsed.x)) : ""),
            label: (ctx) => (ctx.raw && ctx.raw.poll ? `${ctx.raw.poll.pollster}: ${ctx.parsed.y}%` : `Other pollsters' average: ${ctx.parsed.y}%`),
          } },
        },
      },
    });
  }

  // "Lowest Labor primary recorded" and the like, for a poll that set a new high or low when it came out.
  function recordNotes(p) {
    const val = (part) => (x, k) => (x[part] && x[part][k] != null && !isNaN(x[part][k]) ? x[part][k] : null);
    const recs = [
      ...(App.pollRecords(polls, Object.keys(RECORD_NAMES), val("primary")).get(p.id) || []).map((r) => ({ ...r, what: "primary" })),
      ...(App.pollRecords(polls, ["LNP"], val("tpp")).get(p.id) || []).map((r) => ({ ...r, what: "two-party-preferred vote" })),
    ];
    if (!recs.length) return "";
    const since = App.fmtMonth(App.parseDate(polls[0].end_date));
    return `<ul class="poll-records">${recs.map((r) => {
      const word = r.kind === "low" ? "Lowest" : "Highest";
      const head = r.current ? `${word} ${RECORD_NAMES[r.key]} ${r.what} recorded`
        : `New ${r.kind} for the ${RECORD_NAMES[r.key]} ${r.what} when it came out`;
      const prev = `the previous ${r.kind} was ${r.prev}% (<a href="poll.html#${escapeHtml(r.prevPoll.id)}">${escapeHtml(r.prevPoll.pollster)}, ${escapeHtml(fmtDate(r.prevPoll.end_date))}</a>)`;
      const tail = r.current ? `${r.kind === "low" ? "the lowest" : "the highest"} of the ${r.n} polls tracked since ${escapeHtml(since)}`
        : "a later poll has since gone further";
      return `<li class="poll-record poll-record-${r.kind}" style="--party-color: var(${partyVar(r.key)})"><strong>${escapeHtml(head)}</strong>
        <span class="small">${r.value}%; ${prev}; ${tail}.</span></li>`;
    }).join("")}</ul>`;
  }

  function renderDetail(p) {
    document.title = `${p.pollster} poll, ${fmtDate(p.end_date)} · Vic Election 2026`;
    const prim = Object.entries(p.primary || {}).sort(App.byValue(([, v]) => v, ([k]) => k)).map(([k, v]) => [partyName(k), k, v]);
    const maxPrim = Math.max(1, ...prim.map(([, , v]) => v));
    const pp = p.preferred_premier, ap = p.approval;
    const own = polls.filter((x) => x.pollster === p.pollster).reverse();
    let host = "";
    try { host = p.source_url ? new URL(p.source_url).hostname.replace(/^www\./, "") : ""; } catch (e) { /* bad URL */ }

    $("poll-detail").innerHTML = `
      <article class="card">
        <div class="card-head">
          <h1 class="poll-title">${escapeHtml(p.pollster)} <span class="muted">${escapeHtml(fieldwork(p))}</span></h1>
          <div class="card-actions">
            <button class="icon-btn" type="button" id="copy-link">Copy link</button>
            ${p.source_url ? `<a class="icon-btn" href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">Source ↗</a>` : ""}
          </div>
        </div>
        <div class="facts">
          <div class="fact"><div class="label">Pollster</div><div class="value">${escapeHtml(p.pollster)}</div></div>
          <div class="fact"><div class="label">Commissioned by</div><div class="value">${escapeHtml(App.commissionLabel(p))}</div></div>
          <div class="fact"><div class="label">Fieldwork</div><div class="value">${escapeHtml(fieldwork(p))}</div></div>
          <div class="fact"><div class="label">Sample</div><div class="value">${p.sample_size ? p.sample_size.toLocaleString("en-AU") : "Not published"}</div></div>
        </div>
        ${App.pollExclusion(p) ? `<p class="small poll-excl-note"><strong>Not in this site's poll of polls:</strong> ${escapeHtml(App.pollExclusion(p).toLowerCase())}. <a href="poll.html#aggregates">How the average works</a></p>` : ""}
        ${recordNotes(p)}
        ${prim.length ? `<h3>Primary vote</h3>${bars(prim, maxPrim)}` : ""}
        ${p.tpp ? `<h3>Two-party preferred</h3>${splitBar([["Labor", "ALP", p.tpp.ALP], ["L/NP", "LNP", p.tpp.LNP]].sort(App.byValue((x) => x[2], (x) => x[1])))}` : '<p class="muted small">No ALP v L/NP two-party figure published.</p>'}
        ${p.tpp3 ? `<h3>Three-party preferred</h3>${splitBar([["Labor", "ALP", p.tpp3.ALP], ["L/NP", "LNP", p.tpp3.LNP], ["One Nation", "ONP", p.tpp3.ONP]].sort(App.byValue((x) => x[2], (x) => x[1])))}` : ""}
        ${pp ? `<h3>Preferred premier <span class="muted small">${escapeHtml(pp.matchup || "")}</span></h3>
          ${bars([...Object.entries(pp.leaders).map(([n, v]) => [n, LEADER_PARTY[n] || "OTH", v]),
                  ...(pp.undecided != null ? [["Undecided", "OTH", pp.undecided]] : [])], 100)}` : ""}
        ${p.preferred_premier_alt ? `<h3>Preferred premier <span class="muted small">${escapeHtml(p.preferred_premier_alt.matchup || "")}</span></h3>
          ${bars([...Object.entries(p.preferred_premier_alt.leaders).map(([n, v]) => [n, LEADER_PARTY[n] || "OTH", v]),
                  ...(p.preferred_premier_alt.undecided != null ? [["Undecided", "OTH", p.preferred_premier_alt.undecided]] : [])], 100)}` : ""}
        ${ap ? `<h3>Leader approval <span class="muted small">${escapeHtml(ap.matchup || "")}</span></h3>
          <div class="table-scroll"><table>
            <thead><tr><th>Leader</th><th class="num">Approve</th><th class="num">Disapprove</th><th class="num">Undecided</th><th class="num">Net</th></tr></thead>
            <tbody>${Object.entries(ap.leaders).map(([n, r]) => `<tr><td><span class="party" style="--party-color: var(${partyVar(LEADER_PARTY[n] || "OTH")})">${escapeHtml(n)}</span></td>
              ${["positive", "negative", "undecided"].map((k) => `<td class="num">${r[k] == null ? "–" : `${r[k]}%`}</td>`).join("")}
              <td class="num">${r.net == null ? "–" : `${r.net > 0 ? "+" : r.net < 0 ? "−" : ""}${Math.abs(r.net)}`}</td></tr>`).join("")}</tbody>
          </table></div>` : ""}
        ${!pp && !ap ? '<p class="muted small">No preferred-premier or approval figures published with this poll.</p>' : ""}
        <p class="muted small">${p.source_url ? `Source: <a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">${escapeHtml(host)}</a>, ` : ""}${p.via
          ? `${p.added_from === "electiontracker" ? "added from" : "entered by hand from"} <a href="${escapeHtml(p.via.url)}" target="_blank" rel="noopener">${escapeHtml(p.via.label)}</a> until Wikipedia lists it.`
          : `via <a href="https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Victorian_state_election">Wikipedia's poll tables</a>.`}${(Array.isArray(p.supplemented) ? p.supplemented : p.supplemented ? [p.supplemented] : []).map((s) =>
            ` ${escapeHtml(SUPPLEMENT_LABEL(s.fields))} from <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a>.`).join("")}${p.commissioned_by && p.commissioned_by.via === "electiontracker"
          ? ` Who commissioned it: <a href="https://electiontracker.au/elections/vic/2026/polls" target="_blank" rel="noopener">electiontracker.au poll ledger</a> (CC BY 4.0).` : ""}</p>
      </article>

      <section class="card" aria-labelledby="trend-h">
        <div class="card-head"><h2 id="trend-h">${escapeHtml(p.pollster)} over time</h2></div>
        <div class="chips" role="group" aria-label="Measure">${MEASURES.map((m) =>
          `<button type="button" class="chip" data-measure="${m.key}" aria-pressed="${m === measure}">${escapeHtml(m.label)}</button>`).join("")}</div>
        <div class="chart-wrap"><canvas id="trend-chart" role="img" aria-label="${escapeHtml(p.pollster)} trend against the other pollsters' average"></canvas></div>
        <p class="small" id="house-effect"></p>
        <h3>All ${escapeHtml(p.pollster)} polls</h3>
        ${pollTable(own, p.id)}
      </section>
      <p class="small"><a href="poll.html">All polls</a></p>`;
    $("copy-link").addEventListener("click", (e) => copyLink(e.currentTarget));
    document.querySelectorAll("[data-measure]").forEach((btn) => btn.addEventListener("click", () => {
      measure = MEASURES.find((m) => m.key === btn.dataset.measure);
      document.querySelectorAll("[data-measure]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      renderTrend(p);
    }));
    renderTrend(p);
  }

  // "Client, preferred premier and leader ratings" for the fields filled from a hand-entered poll.
  function SUPPLEMENT_LABEL(fields) {
    const names = { client: "client", preferred_premier: "preferred premier", preferred_premier_alt: "preferred premier",
      approval: "leader ratings", tpp: "two-party figures", tpp3: "three-party figures", sample_size: "sample size",
      primary: "primary vote", source_url: "source link" };
    const list = [...new Set(fields.map((f) => names[f] || f.replace(/_/g, " ")))];
    const text = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function pollTable(list, current) {
    const keys = ["GRN", "ALP", "LNP", "ONP"];   // the fixed party order
    return `<div class="table-scroll"><table class="poll-list">
      <thead><tr><th>Fieldwork</th><th>Pollster</th><th>Commissioned by</th><th class="num">Sample</th>
        ${keys.map((k) => `<th class="num" title="Primary vote">${escapeHtml(App.partyShort(k))}</th>`).join("")}<th class="num">2PP L/NP</th></tr></thead>
      <tbody>${list.map((p) => {
        const out = App.pollExclusion(p);
        const cls = [p.id === current ? "current" : "", out ? "poll-excluded" : ""].filter(Boolean).join(" ");
        return `<tr${cls ? ` class="${cls}"` : ""}>
        <td>${escapeHtml(fmtDate(p.end_date))}</td>
        <td${out ? ` data-csv="${escapeHtml(`${p.pollster} (not in the average: ${out.toLowerCase()})`)}"` : ""}><a href="poll.html#${escapeHtml(p.id)}">${escapeHtml(p.pollster)}</a>${out
          ? `<span class="excl-reason">Not in the average: ${escapeHtml(out.toLowerCase())}</span>` : ""}</td>
        <td>${escapeHtml(App.commissionLabel(p))}</td>
        <td class="num">${p.sample_size ? p.sample_size.toLocaleString("en-AU") : "–"}</td>
        ${keys.map((k) => `<td class="num">${get(p, `primary.${k}`) ?? "–"}</td>`).join("")}
        <td class="num">${get(p, "tpp.LNP") ?? "–"}</td></tr>`;
      }).join("")}</tbody>
    </table></div>`;
  }

  /* ---------- Aggregates compared: this site's poll of polls against three other averages ---------- */
  const AGG_PARTIES = ["GRN", "ALP", "LNP", "ONP", "OTH"];   // the fixed party order

  // The latest point of the home chart's average (the last point of App.smoothedSeries, via App.smoothedLatest),
  // with independents counted in Others as the home chart counts them. Dated at the newest poll's fieldwork
  // midpoint, where the series ends.
  function ownAggregate() {
    const value = (part, key) => (p) => {
      const m = p[part] || {};
      if (part === "primary" && key === "OTH" && (m.OTH != null || m.IND != null)) return (m.OTH || 0) + (m.IND || 0);
      return m[key] == null || isNaN(m[key]) ? null : m[key];
    };
    let last = null;
    const ranges = {};   // "primary.ALP" -> the point, for its 95% interval
    const latest = (part, key) => {
      const pt = App.smoothedLatest(polls, value(part, key));
      if (!pt) return null;
      last = Math.max(last || 0, pt.x);
      ranges[`${part}.${key}`] = pt;
      return pt.y;
    };
    const primary = {};
    AGG_PARTIES.forEach((k) => { const v = latest("primary", k); if (v != null) primary[k] = v; });
    const alp = latest("tpp", "ALP"), lnp = latest("tpp", "LNP");
    return { id: "this-site", name: "This site", url: "index.html", linkText: "Home page chart",
      primary, tpp: alp != null && lnp != null ? { ALP: alp, LNP: lnp } : null, asOf: last ? new Date(last) : null, own: true, ranges };
  }

  let aggregates = null;   // poll_aggregates.json (null until loaded; false if it couldn't be)
  function aggregatesTable() {
    const outside = (aggregates && aggregates.aggregates) || [];
    const rows = [ownAggregate(), ...outside];
    const pct = (v) => (v == null ? "–" : Number(v).toFixed(1));
    // YYYY-MM-DD for the CSV, from the same local date fmtDate shows.
    const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
    const missing = (a, what) => (what === "2PP" && a.tpp_note ? `${a.name} ${a.tpp_note}` : `${a.name} doesn't publish ${what}`);
    // One short line above the table (below it, the CSV button that common.js adds would push it down a
    // moment after it paints): what each source leaves out, and when the figures were read.
    const gaps = [];
    outside.forEach((a) => {
      const absent = AGG_PARTIES.filter((k) => !a.primary || a.primary[k] == null).map((k) => (k === "OTH" ? "Others" : App.partyShort(k)));
      if (!a.tpp) absent.push("2PP");
      if (absent.length) gaps.push(`${escapeHtml(a.name)}'s ${escapeHtml(absent.join(" and "))}`);
    });
    const checked = outside.map((a) => a.checked).filter(Boolean).sort();
    const line = [
      gaps.length ? `– not published: ${gaps.join(", ")}.` : "",
      checked.length ? `Last read ${escapeHtml(fmtDate(checked[0]))}${checked[0] !== checked[checked.length - 1] ? ` to ${escapeHtml(fmtDate(checked[checked.length - 1]))}` : ""}.` : "",
      aggregates === false ? "The other averages couldn't be loaded; try again later." : "",
    ].filter(Boolean).join(" ");
    // This site's row carries each figure's 95% range beneath it (the CSV keeps the figure alone).
    const cell = (a, v, what, key) => {
      if (v == null) return `<td class="num muted" title="${escapeHtml(missing(a, what))}">–</td>`;
      const r = a.own && key ? App.fmtRange(a.ranges[key]) : "";
      return r ? `<td class="num" data-csv="${pct(v)}">${pct(v)}<span class="agg-ci" title="95% range">${r}</span></td>` : `<td class="num">${pct(v)}</td>`;
    };
    return `<p class="small muted agg-caveats">${line}</p>
    <div class="table-scroll"><table class="agg-compare">
      <thead><tr><th>Aggregate</th><th>As of</th>
        ${AGG_PARTIES.map((k) => `<th class="num"><span class="party" style="--party-color: var(${partyVar(k)})">${escapeHtml(k === "OTH" ? "Others" : App.partyShort(k))}</span></th>`).join("")}
        <th class="num">2PP ALP</th><th class="num">2PP L/NP</th><th>Source</th></tr></thead>
      <tbody>${rows.map((a) => {
        const p = a.primary || {};
        return `<tr${a.own ? ' class="current"' : ""}>
          <td>${escapeHtml(a.name)}</td>
          <td data-csv="${escapeHtml(a.own ? (a.asOf ? isoDay(a.asOf) : "") : a.as_of || "")}">${escapeHtml(fmtDate(a.own ? a.asOf : a.as_of) || "–")}</td>
          ${AGG_PARTIES.map((k) => cell(a, p[k], `a ${k === "OTH" ? "Others" : partyName(k)} figure`, `primary.${k}`)).join("")}
          ${cell(a, a.tpp && a.tpp.ALP, "2PP", "tpp.ALP")}${cell(a, a.tpp && a.tpp.LNP, "2PP", "tpp.LNP")}
          <td data-csv="${escapeHtml(a.own ? "" : a.url)}">${a.own ? `<a href="${a.url}">${escapeHtml(a.linkText)}</a>`
            : `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(host(a.url))} ↗</a>`}</td></tr>`;
      }).join("")}</tbody>
    </table></div>`;
  }

  async function renderAggregates() {
    const el = $("agg-table");
    if (el.dataset.done) return el.donePromise;   // once: the pollster filter re-renders only the list
    el.dataset.done = "1";
    el.donePromise = (async () => {
      if (aggregates === null) {
        try { aggregates = await loadJSON("poll_aggregates"); } catch (err) { console.error(err); aggregates = false; }
      }
      el.innerHTML = aggregatesTable();
    })();
    return el.donePromise;
  }

  function renderList() {
    document.title = "Polls · Vic Election 2026";
    const firms = [...new Set(polls.map((p) => p.pollster))].sort();
    const sel = $("poll-firm");
    if (!sel.options.length) {
      sel.innerHTML = '<option value="">All pollsters</option>' + firms.map((f) => `<option>${escapeHtml(f)}</option>`).join("");
      sel.addEventListener("change", renderList);
    }
    const list = polls.filter((p) => !sel.value || p.pollster === sel.value).reverse();
    $("poll-count").textContent = `${list.length} poll${list.length === 1 ? "" : "s"}`;
    $("poll-list").innerHTML = pollTable(list);
    return renderAggregates();
  }

  // "#aggregates" (the home page's "Other aggregates" line) is the list page, scrolled to that card.
  const SECTIONS = ["aggregates"];
  function onHashChange() {
    const id = hashId();
    if (SECTIONS.includes(id)) {
      $("poll-index").hidden = false;
      $("poll-detail").hidden = true;
      renderList().then(() => {   // once the table is in, so nothing moves under the reader
        const target = document.getElementById(`${id}-card`);   // not the hash itself: the browser would jump there before the page fills in
        if (target) App.afterPaint(() => target.scrollIntoView());
      });
      return;
    }
    const p = id && polls.find((x) => x.id === id);
    $("poll-index").hidden = !!p;
    $("poll-detail").hidden = !p;
    if (p) { renderDetail(p); window.scrollTo(0, 0); } else renderList();
    if (id && !p) $("poll-list-note").textContent = `No poll with the id “${id}”.`;
  }

  async function init() {
    if (!hashId() || hashId() === "aggregates") loadJSON("poll_aggregates").catch(() => {});   // start it alongside polls.json (loadJSON caches the request)
    try {
      polls = App.preparePolls(await loadJSON("polls"));
      if (window.Chart) Chart.defaults.font.family = cssVar("--font-body") || "system-ui, sans-serif";
      window.addEventListener("hashchange", onHashChange);
      document.addEventListener("themechange", () => {
        const p = polls.find((x) => x.id === hashId());
        if (p) renderTrend(p);
      });
      onHashChange();
    } catch (err) {
      App.showError($("poll-list"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
