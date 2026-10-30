/* Poll detail (poll.html#<poll id>) with a trend line for that pollster against the poll of polls,
   and, with no hash, the full list of polls. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyName, partyVar, partyColor, cssVar, fmtDate, hashId, copyLink } = App;

  // Leaders named in Wikipedia's leadership tables -> party (for bar colours).
  const LEADER_PARTY = { Carroll: "ALP", Allan: "ALP", Andrews: "ALP", Wilson: "LIB", Battin: "LIB", Pesutto: "LIB", Guy: "LIB", Pickering: "ONP" };
  const MEASURES = [
    { key: "tpp.LNP", label: "L/NP 2PP", party: "LNP" },
    { key: "tpp.ALP", label: "Labor 2PP", party: "ALP" },
    { key: "primary.ALP", label: "Labor primary", party: "ALP" },
    { key: "primary.LNP", label: "L/NP primary", party: "LNP" },
    { key: "primary.GRN", label: "Greens primary", party: "GRN" },
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

  function renderDetail(p) {
    document.title = `${p.pollster} poll, ${fmtDate(p.end_date)} · Vic Election 2026`;
    const prim = Object.entries(p.primary || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => [partyName(k), k, v]);
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
          <div class="fact"><div class="label">Client</div><div class="value">${escapeHtml(p.client || "None published")}</div></div>
          <div class="fact"><div class="label">Fieldwork</div><div class="value">${escapeHtml(fieldwork(p))}</div></div>
          <div class="fact"><div class="label">Sample</div><div class="value">${p.sample_size ? p.sample_size.toLocaleString("en-AU") : "Not published"}</div></div>
        </div>
        ${prim.length ? `<h3>Primary vote</h3>${bars(prim, maxPrim)}` : ""}
        ${p.tpp ? `<h3>Two-party preferred</h3>${splitBar([["Labor", "ALP", p.tpp.ALP], ["L/NP", "LNP", p.tpp.LNP]])}` : '<p class="muted small">No ALP v L/NP two-party figure published.</p>'}
        ${p.tpp3 ? `<h3>Three-party preferred</h3>${splitBar([["Labor", "ALP", p.tpp3.ALP], ["L/NP", "LNP", p.tpp3.LNP], ["One Nation", "ONP", p.tpp3.ONP]])}` : ""}
        ${pp ? `<h3>Preferred premier <span class="muted small">${escapeHtml(pp.matchup || "")}</span></h3>
          ${bars([...Object.entries(pp.leaders).map(([n, v]) => [n, LEADER_PARTY[n] || "OTH", v]),
                  ...(pp.undecided != null ? [["Undecided", "OTH", pp.undecided]] : [])], 100)}` : ""}
        ${ap ? `<h3>Leader approval <span class="muted small">${escapeHtml(ap.matchup || "")}</span></h3>
          <div class="table-scroll"><table>
            <thead><tr><th>Leader</th><th class="num">Approve</th><th class="num">Disapprove</th><th class="num">Undecided</th><th class="num">Net</th></tr></thead>
            <tbody>${Object.entries(ap.leaders).map(([n, r]) => `<tr><td><span class="party" style="--party-color: var(${partyVar(LEADER_PARTY[n] || "OTH")})">${escapeHtml(n)}</span></td>
              ${["positive", "negative", "undecided"].map((k) => `<td class="num">${r[k] == null ? "–" : `${r[k]}%`}</td>`).join("")}
              <td class="num">${r.net == null ? "–" : `${r.net > 0 ? "+" : r.net < 0 ? "−" : ""}${Math.abs(r.net)}`}</td></tr>`).join("")}</tbody>
          </table></div>` : ""}
        ${!pp && !ap ? '<p class="muted small">No preferred-premier or approval figures published with this poll.</p>' : ""}
        <p class="muted small">${p.source_url ? `Source: <a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">${escapeHtml(host)}</a>, via ` : "Via "}<a href="https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Victorian_state_election">Wikipedia's poll tables</a>.</p>
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

  function pollTable(list, current) {
    const keys = ["ALP", "LNP", "GRN", "ONP"];
    return `<div class="table-scroll"><table class="poll-list">
      <thead><tr><th>Fieldwork</th><th>Pollster</th><th>Client</th><th class="num">Sample</th>
        ${keys.map((k) => `<th class="num" title="Primary vote">${escapeHtml(App.partyShort(k))}</th>`).join("")}<th class="num">2PP L/NP</th></tr></thead>
      <tbody>${list.map((p) => `<tr${p.id === current ? ' class="current"' : ""}>
        <td>${escapeHtml(fmtDate(p.end_date))}</td>
        <td><a href="poll.html#${escapeHtml(p.id)}">${escapeHtml(p.pollster)}</a></td>
        <td>${escapeHtml(p.client || "–")}</td>
        <td class="num">${p.sample_size ? p.sample_size.toLocaleString("en-AU") : "–"}</td>
        ${keys.map((k) => `<td class="num">${get(p, `primary.${k}`) ?? "–"}</td>`).join("")}
        <td class="num">${get(p, "tpp.LNP") ?? "–"}</td></tr>`).join("")}</tbody>
    </table></div>`;
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
  }

  function onHashChange() {
    const id = hashId();
    const p = id && polls.find((x) => x.id === id);
    $("poll-index").hidden = !!p;
    $("poll-detail").hidden = !p;
    if (p) { renderDetail(p); window.scrollTo(0, 0); } else renderList();
    if (id && !p) $("poll-list-note").textContent = `No poll with the id “${id}”.`;
  }

  async function init() {
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
