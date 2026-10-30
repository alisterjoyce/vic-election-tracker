/* Home page: countdown, headline seat counts, poll-of-polls chart, latest polls table. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyName, partyVar, partyColor, fmtDate, cssVar,
    DAY, preparePolls, smoothedSeries } = window.App;

  const PARTY_ORDER = ["ALP", "LNP", "LIB", "NAT", "GRN", "ONP", "LCV", "IND", "OTH"];
  const byPartyOrder = (a, b) => {
    const ia = PARTY_ORDER.indexOf(a), ib = PARTY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  };

  let chart = null;
  let measure = "tpp";
  let polls = [];

  // Old shared links like index.html#bendigo-east go to the district page.
  async function redirectDistrictHash() {
    const id = window.App.hashId();
    if (!id) return false;
    try {
      const { districts } = await loadJSON("districts");
      if (districts.some((d) => d.id === id)) {
        location.replace(`lower.html#${encodeURIComponent(id)}`);
        return true;
      }
      const { regions } = await loadJSON("regions");
      if (regions.some((r) => r.id === id)) {
        location.replace(`upper.html#${encodeURIComponent(id)}`);
        return true;
      }
    } catch (e) { /* fall through to the home page */ }
    return false;
  }

  /* ---------- Countdown ---------- */
  function renderCountdown(meta) {
    if (!meta.election_date) return;
    document.getElementById("election-date").textContent = `Polling day ${fmtDate(meta.election_date)}`;
    const days = App.daysBetween(App.melbourneToday(), meta.election_date);
    document.getElementById("countdown").textContent =
      days > 1 ? `${days} days to go` : days === 1 ? "Tomorrow" : days === 0 ? "Polling day" : "Election held";
  }

  /* ---------- Seat counts ---------- */
  function seatBlock(counts, total, unknownLabel) {
    const majority = Math.floor(total / 2) + 1;
    const known = Object.values(counts).reduce((a, b) => a + b, 0);
    const parties = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || byPartyOrder(a, b));
    const segs = parties.map((p) =>
      `<span style="width:${(counts[p] / total) * 100}%;background:var(${partyVar(p)})" title="${escapeHtml(partyName(p))}: ${counts[p]}"></span>`
    ).join("");
    const legend = parties.map((p) =>
      `<li><span class="swatch" style="background:var(${partyVar(p)})"></span>${escapeHtml(partyName(p))} <b>${counts[p]}</b></li>`
    ).join("");
    const unknown = total - known;
    return `
      <div class="seat-bar" role="img" aria-label="${parties.map((p) => `${partyName(p)} ${counts[p]}`).join(", ")}">
        ${segs}
        <span class="majority" style="left:${(majority / total) * 100}%" title="Majority: ${majority}"></span>
      </div>
      <ul class="seat-legend">${legend}${unknown > 0 ? `<li><span class="swatch" style="background:var(--surface-2);border:1px solid var(--border)"></span>${escapeHtml(unknownLabel)} <b>${unknown}</b></li>` : ""}</ul>
      <p class="muted small" style="margin:10px 0 0">${total} seats · ${majority} for a majority</p>`;
  }

  function renderSeats(meta, districts, regions) {
    const la = {};
    districts.forEach((d) => { la[d.party] = (la[d.party] || 0) + 1; });
    const laEl = document.getElementById("la-seats");
    laEl.innerHTML = seatBlock(la, meta.assembly_seats || 88, "Not in dataset");
    document.getElementById("la-note").textContent = "Sitting members";

    const lc = {};
    regions.forEach((r) => (r.mlcs || []).forEach((m) => { lc[m.party] = (lc[m.party] || 0) + 1; }));
    const lcEl = document.getElementById("lc-seats");
    lcEl.innerHTML = seatBlock(lc, meta.council_seats || 40, "Not in dataset");
    document.getElementById("lc-note").textContent = "Current members";
  }

  /* ---------- Poll of polls ---------- */
  // Pollsters differ on whether independents are reported separately, so the
  // primary chart counts them in Other to keep that line comparable.
  function chartValue(p, key) {
    const m = p[measure] || {};
    if (measure === "primary" && key === "OTH" && (m.OTH != null || m.IND != null)) {
      return (m.OTH || 0) + (m.IND || 0);
    }
    return m[key] == null || isNaN(m[key]) ? null : m[key];
  }

  function seriesKeys() {
    const keys = new Set();
    polls.forEach((p) => Object.keys(p[measure] || {}).forEach((k) => keys.add(k)));
    if (measure === "primary" && keys.delete("IND")) keys.add("OTH");
    return [...keys].sort(byPartyOrder);
  }

  function average(key) {
    return smoothedSeries(polls, (p) => chartValue(p, key));
  }

  function withAlpha(color, alpha) {
    const m = color.match(/^#([0-9a-f]{6})$/i);
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function renderChart() {
    const canvas = document.getElementById("pop-chart");
    if (!window.Chart) {
      canvas.parentElement.innerHTML = '<p class="empty">Chart library failed to load.</p>';
      return;
    }
    const keys = seriesKeys();
    const datasets = [];
    keys.forEach((k) => {
      const color = partyColor(k);
      datasets.push({
        type: "line", label: partyName(k), data: average(k),
        borderColor: color, backgroundColor: color, borderWidth: 2.5,
        pointRadius: 0, pointHoverRadius: 4,
      });
      datasets.push({
        type: "scatter", label: `${partyName(k)} polls`,
        data: polls.filter((p) => chartValue(p, k) != null)
          .map((p) => ({ x: p.t, y: chartValue(p, k), poll: p })),
        backgroundColor: withAlpha(color, 0.35), borderColor: "transparent",
        pointRadius: 3.5, pointHoverRadius: 5,
      });
    });

    const text = cssVar("--muted");
    const grid = cssVar("--border");
    const fmtTick = (v) => App.fmtMonth(v);

    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        // A poll dot opens that poll's page.
        onClick: (evt, els) => {
          const el = els.find((e) => chart.data.datasets[e.datasetIndex].type === "scatter");
          const raw = el && chart.data.datasets[el.datasetIndex].data[el.index];
          if (raw && raw.poll && raw.poll.id) location.href = `poll.html#${raw.poll.id}`;
        },
        scales: {
          x: {
            type: "linear",
            min: polls.length ? polls[0].t - 7 * DAY : undefined,
            max: polls.length ? polls[polls.length - 1].t + 7 * DAY : undefined,
            grid: { color: grid },
            ticks: { color: text, callback: fmtTick, maxRotation: 0, autoSkipPadding: 12 },
            afterBuildTicks(scale) {
              // Place ticks on the first of each month.
              const ticks = [];
              const d = new Date(scale.min); d.setDate(1); d.setHours(0, 0, 0, 0);
              d.setMonth(d.getMonth() + 1);
              while (d.getTime() <= scale.max) { ticks.push({ value: d.getTime() }); d.setMonth(d.getMonth() + 1); }
              if (ticks.length) scale.ticks = ticks;
            },
          },
          y: {
            grid: { color: grid },
            ticks: { color: text, callback: (v) => `${v}%` },
            suggestedMin: measure === "tpp" ? 42 : 0,
            suggestedMax: measure === "tpp" ? 58 : 45,
          },
        },
        plugins: {
          legend: {
            labels: { color: text, usePointStyle: true, filter: (item) => !item.text.endsWith(" polls") },
          },
          tooltip: {
            callbacks: {
              title: (items) => items.length ? fmtDate(new Date(items[0].parsed.x)) : "",
              label: (ctx) => {
                const poll = ctx.raw && ctx.raw.poll;
                return poll
                  ? `${poll.pollster}: ${ctx.dataset.label.replace(/ polls$/, "")} ${ctx.parsed.y}%`
                  : `${ctx.dataset.label} average: ${ctx.parsed.y}%`;
              },
            },
          },
        },
      },
    });
  }

  function initMeasureToggle() {
    document.querySelectorAll("[data-measure]").forEach((btn) => {
      btn.addEventListener("click", () => {
        measure = btn.dataset.measure;
        document.querySelectorAll("[data-measure]").forEach((b) =>
          b.setAttribute("aria-pressed", String(b === btn)));
        renderChart();
      });
    });
  }

  /* ---------- Latest polls table ---------- */
  function renderTable(data) {
    const el = document.getElementById("polls-table");
    if (!polls.length) { el.innerHTML = '<p class="empty">No polls yet.</p>'; return; }
    const primKeys = [...new Set(polls.flatMap((p) => Object.keys(p.primary || {})))].sort(byPartyOrder);
    const tppKeys = [...new Set(polls.flatMap((p) => Object.keys(p.tpp || {})))].sort(byPartyOrder);
    const latest = [...polls].sort((a, b) => b.t - a.t).slice(0, 12);
    const cell = (v) => `<td class="num">${v == null ? "–" : escapeHtml(v)}</td>`;
    el.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Pollster</th><th class="num">Sample</th>
            ${primKeys.map((k) => `<th class="num" title="Primary vote">${escapeHtml(k)}</th>`).join("")}
            ${tppKeys.map((k) => `<th class="num" title="Two-party preferred">2PP ${escapeHtml(k)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${latest.map((p) => `
            <tr>
              <td>${escapeHtml(fmtDate(p.end_date))}</td>
              <td>${p.id ? `<a href="poll.html#${escapeHtml(p.id)}">${escapeHtml(p.pollster)}</a>` : escapeHtml(p.pollster)}</td>
              ${cell(p.sample_size ? p.sample_size.toLocaleString("en-AU") : null)}
              ${primKeys.map((k) => cell(p.primary && p.primary[k])).join("")}
              ${tppKeys.map((k) => cell(p.tpp && p.tpp[k])).join("")}
            </tr>`).join("")}
        </tbody>
      </table>`;
    document.getElementById("polls-source").innerHTML =
      data.source === "sample" ? "Sample rows" : `<a href="poll.html">All ${polls.length} polls</a>`;
  }

  async function init() {
    if (await redirectDistrictHash()) return;
    window.addEventListener("hashchange", redirectDistrictHash);
    initMeasureToggle();
    const mapRoot = document.getElementById("state-map");
    if (mapRoot && window.L && App.Maps) {
      App.Maps.homeMap(mapRoot).catch((err) => App.showError(mapRoot.querySelector("[data-map=main]"), err));
    } else if (mapRoot) {
      mapRoot.querySelector("[data-map=main]").innerHTML = '<p class="empty">The map library failed to load.</p>';
    }
    try {
      const [meta, districtData, regionData, pollData] = await Promise.all([
        loadJSON("meta"), loadJSON("districts"), loadJSON("regions"), loadJSON("polls"),
      ]);
      renderCountdown(meta);
      renderSeats(meta, districtData.districts, regionData.regions);
      polls = preparePolls(pollData);
      renderTable(pollData);
      renderChart();
      document.addEventListener("themechange", renderChart);
    } catch (err) {
      window.App.showError(document.getElementById("polls-table"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
