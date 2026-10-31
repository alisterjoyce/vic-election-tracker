/* Home page: the headline card (poll average, seat projection, betting favourites, countdown), the map's
   Find my seat, seats to watch, latest news, seat counts, the poll-of-polls chart and the latest polls table. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyName, partyShort, partyVar, partyColor, fmtDate, fmtPrice, cssVar,
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

  /* ---------- Headline card ---------- */
  const SEATS = 88, MAJORITY = 45;
  const BLOC_NAMES = { LNP: "Coalition", ALP: "Labor", GRN: "Greens", ONP: "One Nation", OTH: "Others", UND: "Undecided" };
  const BLOC_CODE = { LNP: "LNP", ALP: "ALP", GRN: "GRN", ONP: "ONP", OTH: "IND" };   // colours, as on the pendulum

  function renderCountdown(meta) {
    if (!meta.election_date) return;
    const days = App.daysBetween(App.melbourneToday(), meta.election_date);
    const date = `Sat ${fmtDate(meta.election_date)}`;
    document.getElementById("countdown").innerHTML =
      days > 1 ? `<strong>${days} days</strong> to election day <span class="muted hero-date">· ${escapeHtml(date)}</span>`
      : days === 1 ? `<strong>Tomorrow</strong> is election day <span class="muted hero-date">· ${escapeHtml(date)}</span>`
      : days === 0 ? "<strong>Election day:</strong> voting centres are open 8 am to 6 pm"
      : `Election held ${escapeHtml(fmtDate(meta.election_date))}`;
  }

  // One 88-seat bar: blocs largest first from the left, so the leader's block meets the majority line.
  function heroBar(counts, what) {
    const order = Object.keys(counts).filter((b) => b !== "UND" && counts[b] > 0).sort((a, b) => counts[b] - counts[a]);
    if (counts.UND) order.push("UND");
    const fill = (b) => (b === "UND" ? "" : `background:var(${partyVar(BLOC_CODE[b])});color:${App.inkFor(BLOC_CODE[b])}`);
    const segs = order.map((b) => `<span class="hb-seg${b === "UND" ? " hb-und" : ""}" style="flex:${counts[b]} 0 0;${fill(b)}">${counts[b] >= 5 ? counts[b] : ""}</span>`).join("");
    const key = order.map((b) => `<li><span class="swatch${b === "UND" ? " hb-und" : ""}" style="${fill(b)}"></span>${BLOC_NAMES[b]} <b>${counts[b]}</b></li>`).join("");
    const lead = order[0] && order[0] !== "UND" && counts[order[0]] >= MAJORITY ? `${BLOC_NAMES[order[0]]} majority` : "No majority";
    return `<div class="hb-track" role="img" aria-label="${escapeHtml(`${what}: ${order.map((b) => `${BLOC_NAMES[b]} ${counts[b]}`).join(", ")}. ${lead}; ${MAJORITY} seats needed.`)}">
        ${segs}<span class="hb-majority" style="left:${(100 * MAJORITY) / SEATS}%"></span></div>
      <ul class="hb-key">${key}<li class="hb-maj-key"><span class="hb-maj-mark"></span>${MAJORITY} for a majority</li></ul>`;
  }

  // Poll-of-polls 2PP, its move over the last fortnight of polling, and the uniform-swing projection.
  function renderHero(meta, districts, pollData, odds) {
    const s = App.statewideSwing(meta, pollData);
    const series = smoothedSeries(preparePolls(pollData), (p) => (p.tpp && p.tpp.LNP != null ? p.tpp.LNP : null));
    if (s && series.length) {
      const lnp = s.current, alp = 100 - s.current;
      const sides = [["Coalition", lnp, "--p-lib"], ["Labor", alp, "--p-alp"]].sort((a, b) => b[1] - a[1]);
      document.getElementById("hero-tpp").innerHTML = sides.map(([n, v, c]) =>
        `<span class="tpp-side" style="--side:var(${c})">${n} <b>${v.toFixed(1)}</b></span>`).join('<span class="tpp-dash"> – </span>');
      const last = series[series.length - 1];
      const before = series.find((pt) => pt.x >= last.x - 14 * DAY) || series[0];
      const move = last.y - before.y;
      document.getElementById("hero-trend").textContent = Math.abs(move) < 0.05
        ? "Steady over the latest fortnight of polling"
        : `${App.fmtSwing(Math.abs(move))} to ${move > 0 ? "Coalition" : "Labor"} this fortnight`;
      const proj = App.projectSeats(districts, s).tally;
      document.getElementById("hero-proj").innerHTML = heroBar(proj, "Seat projection at a uniform swing");
      const note = document.getElementById("hero-proj-note");
      note.textContent = `Uniform swing, ${App.fmtSwing(Math.abs(s.swing))} to ${s.swing >= 0 ? "L/NP" : "Labor"}`;
      note.href = `pendulum.html#swing=${(Math.round(s.swing * 10) / 10).toFixed(1)}`;
    } else {
      document.getElementById("hero-tpp").textContent = "No poll average yet";
      document.getElementById("hero-proj").innerHTML = '<p class="empty">Needs a poll average.</p>';
    }
    // Betting: a joint favourite, a partial market or no market counts as undecided.
    const counts = { UND: 0 };
    const bySeat = Object.fromEntries(((odds && odds.seats) || []).map((x) => [x.district, x]));
    districts.forEach((d) => {
      const o = bySeat[d.id];
      const b = o && o.favourite && !o.partial && !o.joint_favourites ? App.blocOf(o.favourite) : "UND";
      counts[b] = (counts[b] || 0) + 1;
    });
    document.getElementById("hero-odds").innerHTML = heroBar(counts, "Sportsbet favourites");
    document.getElementById("hero-odds-note").textContent = odds && odds.date_checked ? `as at ${fmtDate(odds.date_checked)}` : "";
  }

  /* ---------- Seats to watch: the closest betting contests ---------- */
  function renderWatch(districts, odds) {
    const el = document.getElementById("seats-watch");
    const names = Object.fromEntries(districts.map((d) => [d.id, d.name]));
    const priced = (o) => (o.options || []).filter((x) => x.price != null).sort((a, b) => a.price - b.price);
    // A favourite under 2.00, closest first: the longer the favourite's price, the tighter the race.
    const close = ((odds && odds.seats) || []).filter((o) => o.price != null && o.price < 2 && priced(o).length > 1)
      .sort((a, b) => b.price - a.price || priced(a)[1].price - priced(b)[1].price).slice(0, 10);
    if (!close.length) { el.innerHTML = '<li class="empty">No betting markets recorded yet.</li>'; return; }
    const opt = (x) => `<span class="watch-opt"><span class="swatch" style="background:var(${partyVar(x.party || "OTH")})"></span>${escapeHtml(x.party ? partyShort(x.party) : x.label)} <b>${fmtPrice(x.price)}</b></span>`;
    el.innerHTML = close.map((o) => {
      const [a, b] = priced(o);
      return `<li><a href="lower.html#${escapeHtml(o.district)}">${escapeHtml(names[o.district] || o.district)}</a><span class="watch-odds">${opt(a)}${opt(b)}</span></li>`;
    }).join("");
    document.getElementById("watch-note").textContent = odds.date_checked ? `Sportsbet, ${fmtDate(odds.date_checked)}` : "Sportsbet";
  }

  /* ---------- Find my seat (map card) ---------- */
  function initFindSeat() {
    const btn = document.getElementById("find-seat");
    const msg = document.getElementById("find-seat-msg");
    if (!btn) return;
    if (!navigator.geolocation || !App.Maps) { btn.hidden = true; return; }
    btn.addEventListener("click", () => {
      msg.textContent = "Finding your location…";
      btn.disabled = true;
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const id = await App.Maps.districtAt(pos.coords.latitude, pos.coords.longitude);
          if (id) { location.href = `lower.html#${encodeURIComponent(id)}`; return; }
          msg.textContent = "That location isn't inside a Victorian district. Try the search box instead.";
        } catch (err) {
          msg.textContent = "Couldn't load the district boundaries. Try the search box instead.";
        }
        btn.disabled = false;
      }, (err) => {
        msg.textContent = err.code === err.PERMISSION_DENIED
          ? "Location access was declined. Search for your suburb or postcode instead."
          : "Couldn't get your location. Search for your suburb or postcode instead.";
        btn.disabled = false;
      }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
    });
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

  /* ---------- Share card: poll average and the uniform-swing seat projection ---------- */
  function headlineCard(meta, districts, pollData) {
    const all = preparePolls(pollData);
    const last = (fn) => { const s = smoothedSeries(all, fn); return s.length ? s[s.length - 1].y : null; };
    const s = App.statewideSwing(meta, pollData);
    if (!s) throw new Error("No poll average available");
    const primaries = {};
    ["ALP", "LNP", "ONP", "GRN"].forEach((k) => {
      const v = last((p) => (p.primary && p.primary[k] != null ? p.primary[k] : null));
      if (v != null) primaries[k] = v;
    });
    // The pendulum's uniform-swing projection; the card folds One Nation into Others.
    const t = App.projectSeats(districts, s).tally;
    const tally = { ALP: t.ALP, LNP: t.LNP, GRN: t.GRN, OTH: t.OTH + t.ONP };
    return App.ShareCard.homeCard({
      avg: { LNP2pp: s.current, ALP2pp: 100 - s.current, primaries, n: all.length },
      tally, swing: s.swing, electionDate: meta.election_date,
      days: App.daysBetween(App.melbourneToday(), meta.election_date),
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
    initFindSeat();
    try {
      const [meta, districtData, regionData, pollData, odds] = await Promise.all([
        loadJSON("meta"), loadJSON("districts"), loadJSON("regions"), loadJSON("polls"), loadJSON("seat_odds").catch(() => null),
      ]);
      renderCountdown(meta);
      renderHero(meta, districtData.districts, pollData, odds);
      renderWatch(districtData.districts, odds);
      renderSeats(meta, districtData.districts, regionData.regions);
      polls = preparePolls(pollData);
      renderTable(pollData);
      renderChart();
      App.ShareCard.shareButton(document.getElementById("share-home"), async () => headlineCard(meta, districtData.districts, pollData));
      document.addEventListener("themechange", renderChart);
    } catch (err) {
      window.App.showError(document.getElementById("polls-table"), err);
    }
    const mapRoot = document.getElementById("state-map");
    if (mapRoot && App.Maps) {
      // Leaflet and the boundaries are big and the map is below the fold: fetch them once the figures above have painted.
      App.afterPaint(() => App.loadLib("leaflet"))
        .then(() => App.Maps.homeMap(mapRoot), () => {
          mapRoot.querySelector("[data-map=main]").innerHTML = '<p class="empty">The map library failed to load.</p>';
        })
        .then(() => { if (location.hash === "#state-map") mapRoot.scrollIntoView(); })   // the nav's "Map" link
        .catch((err) => App.showError(mapRoot.querySelector("[data-map=main]"), err));
    }
    loadJSON("news").then((n) => {
      document.getElementById("news-statewide").innerHTML = App.newsList((n.statewide || []).slice(0, 5));
      document.getElementById("news-updated").textContent = n.updated ? `Updated ${App.fmtDateTime(n.updated)}` : "";
    }).catch(() => {
      document.getElementById("news-statewide").innerHTML = "<p class=\"empty\">News isn't available yet.</p>";
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
