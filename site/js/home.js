/* Home page: the headline card (poll average, seat projection, betting favourites, countdown), the map's
   Find my seat, seats to watch, latest news, seat counts, the poll-of-polls chart and the latest polls table. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyName, partyShort, partyVar, partyColor, fmtDate, fmtPrice, cssVar,
    DAY, preparePolls, smoothedSeries } = window.App;

  const byPartyOrder = App.partyOrder;   // the site's one fixed party order (alphabetical, independents and Other last)

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

  // Nominations badge: open (until noon Mon 9 Nov), closed, then "Official candidates" with the VEC's
  // count once refresh.py has loaded the nominations file (meta.nominations.official).
  function melbourneMoment(iso) {
    const parts = {};
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short",
      hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso)).forEach((p) => { parts[p.type] = p.value; });
    const time = parts.hour === "12" && parts.minute === "00" && /pm/i.test(parts.dayPeriod || "") ? "noon"
      : `${parts.hour}${parts.minute === "00" ? "" : `:${parts.minute}`} ${(parts.dayPeriod || "").toLowerCase()}`;
    return `${time} ${parts.weekday} ${Number(parts.day)} ${parts.month}`;
  }

  function renderNominations(meta) {
    const el = document.getElementById("hero-nominations");
    const n = meta.nominations || {};
    if (!el || !n.closes) return;
    const now = Date.now();
    let html;
    if (n.official != null) {
      html = `<span class="hero-badge is-official"><span class="hero-badge-dot"></span>Official candidates: <b>${Number(n.official).toLocaleString("en-AU")}</b> <span class="hero-badge-src">(VEC)</span></span>`;
    } else if (n.opens && now < Date.parse(n.opens)) {
      html = `<span class="hero-badge"><span class="hero-badge-dot"></span>Nominations open ${escapeHtml(melbourneMoment(n.opens))}</span>`;
    } else if (now < Date.parse(n.closes)) {
      html = `<span class="hero-badge is-open"><span class="hero-badge-dot"></span>Nominations open until ${escapeHtml(melbourneMoment(n.closes))}</span>`;
    } else {
      html = '<span class="hero-badge"><span class="hero-badge-dot"></span>Nominations closed; official candidate list due from the VEC</span>';
    }
    el.innerHTML = html;
  }

  // One 88-seat bar: blocs in the site's fixed party order (never by size), undecided last, with the majority mark.
  // `fmt` formats a count (expected seats from a model are fractional: one decimal in the key, whole seats on the bar).
  function heroBar(counts, what, fmt = String) {
    const order = Object.keys(counts).filter((b) => b !== "UND" && counts[b] > 0).sort(byPartyOrder);
    if (counts.UND) order.push("UND");
    const top = order.filter((b) => b !== "UND").reduce((best, b) => (best == null || counts[b] > counts[best] ? b : best), null);
    const fill = (b) => (b === "UND" ? "" : `background:var(${partyVar(BLOC_CODE[b])});color:${App.inkVar(BLOC_CODE[b])}`);
    const segs = order.map((b) => `<span class="hb-seg${b === "UND" ? " hb-und" : ""}" style="flex:${counts[b]} 0 0;${fill(b)}">${counts[b] >= 5 ? Math.round(counts[b]) : ""}</span>`).join("");
    const key = order.map((b) => `<li><span class="swatch${b === "UND" ? " hb-und" : ""}" style="${fill(b)}"></span>${BLOC_NAMES[b]} <b>${fmt(counts[b])}</b></li>`).join("");
    const lead = top && counts[top] >= MAJORITY ? `${BLOC_NAMES[top]} majority` : "No majority";
    return `<div class="hb-track" role="img" aria-label="${escapeHtml(`${what}: ${order.map((b) => `${BLOC_NAMES[b]} ${fmt(counts[b])}`).join(", ")}. ${lead}; ${MAJORITY} seats needed.`)}">
        ${segs}<span class="hb-majority" style="left:${(100 * MAJORITY) / SEATS}%"></span></div>
      <ul class="hb-key">${key}<li class="hb-maj-key"><span class="hb-maj-mark"></span>${MAJORITY} for a majority</li></ul>`;
  }

  // Poll-of-polls 2PP, its move over the last fortnight of polling, and the uniform-swing projection.
  function renderHero(meta, districts, pollData, odds) {
    const s = App.statewideSwing(meta, pollData);
    const series = smoothedSeries(preparePolls(pollData), (p) => (p.tpp && p.tpp.LNP != null ? p.tpp.LNP : null));
    if (s && series.length) {
      const lnp = s.current, alp = 100 - s.current;
      const last = series[series.length - 1];
      const sides = [["Labor", alp, "--p-alp"], ["Coalition", lnp, "--p-lib"]];   // the fixed party order, not the leader first
      document.getElementById("hero-tpp").innerHTML = sides.map(([n, v, c]) =>
        `<span class="tpp-side" style="--side:var(${c})">${n} <b>${v.toFixed(1)}</b></span>`).join('<span class="tpp-dash"> – </span>');
      // The 95% interval of the same average (Labor's is the Coalition's mirrored).
      const range = { Coalition: App.fmtRange(last), Labor: App.fmtRange({ lo: 100 - last.hi, hi: 100 - last.lo }) };
      document.getElementById("hero-tpp-ci").textContent = last.lo != null
        ? `95% range: ${sides.map(([n]) => `${n} ${range[n]}`).join(", ")}` : "";
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

  // "Other aggregates": BludgerTrack, Ace Strategies and electiontracker.au, each with its 2PP (or its primaries
  // where it publishes no 2PP) and the date its estimate runs to; the line links to the polls page's comparison table.
  function renderAggregates(doc) {
    const el = document.getElementById("hero-aggs");
    const list = ((doc && doc.aggregates) || []).filter((a) => a.tpp || a.primary);
    if (!list.length) return;   // the line keeps its link alone
    const short = (iso) => { const d = App.parseDate(iso); return d ? `${d.getDate()} ${fmtDate(d).split(" ")[1]}` : ""; };
    const one = (a) => {
      let figs;
      if (a.tpp && a.tpp.LNP != null && a.tpp.ALP != null) {
        const sides = [["ALP", a.tpp.ALP], ["L/NP", a.tpp.LNP]];
        figs = `${sides.map(([n, v]) => `${n} ${Number(v).toFixed(1)}`).join("–")}`;
      } else {
        figs = ["LNP", "ALP", "ONP", "GRN"].filter((k) => a.primary && a.primary[k] != null)
          .sort(byPartyOrder)
          .map((k) => `${partyShort(k)} ${Number(a.primary[k]).toFixed(1)}`).join(", ");
        figs = `primary vote ${figs}`;
      }
      return `<span class="agg-one"><b>${escapeHtml(a.name)}</b> ${escapeHtml(figs)}${a.as_of ? ` <span class="muted">(${escapeHtml(short(a.as_of))})</span>` : ""}</span>`;
    };
    el.innerHTML = `<a href="poll.html#aggregates">Other aggregates:</a> ${list.map(one).join('<span class="agg-sep" aria-hidden="true"> · </span>')}`;
  }

  // Models: Australian Election Forecasts' expected seats (the sum of its win probabilities), RedBridge's totals beneath.
  function renderModels(doc) {
    const models = (doc && doc.models) || [];
    const aef = models.find((m) => m.kind === "forecast" && m.published && m.expected_seats);
    const el = document.getElementById("hero-models");
    // The header's credit link is in the page itself (no shift when this fills in); the model's date goes on the line beneath.
    const lines = [];
    if (aef) {
      el.innerHTML = heroBar(aef.expected_seats, "Expected seats, Australian Election Forecasts", (n) => Number(n).toFixed(1));
      lines.push(`Expected seats (sum of win chances), model of ${escapeHtml(fmtDate(aef.model_date))}.`);
    } else el.innerHTML = '<p class="empty">No forecast model loaded.</p>';
    const rb = models.find((m) => m.kind === "projection" && m.published && m.totals);
    if (rb) {
      const t = rb.totals;
      const parts = App.BLOCS.filter((b) => b !== "OTH" && t[b] != null).map((b) => `${BLOC_NAMES[b]} ${t[b]}`);
      if (t.toss_up) parts.push(`${t.toss_up} toss-ups`);
      lines.push(`<a href="${escapeHtml(rb.source_url)}" rel="noopener" target="_blank">${escapeHtml(rb.name)}</a>, ${escapeHtml(fmtDate(rb.published_date))}: ${escapeHtml(parts.join(" · "))}`);
    }
    document.getElementById("hero-models-rb").innerHTML = lines.join(" ");
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
      const [a, b] = priced(o).slice(0, 2).sort((x, y) => (!x.party - !y.party) || (x.party && y.party ? byPartyOrder(x.party, y.party) : 0));   // the two shortest prices, in the fixed party order
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
    const parties = Object.keys(counts).sort(byPartyOrder);
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

  // Parties whose highs and lows are marked (Other mixes different groupings from poll to poll, so not it).
  const RECORD_KEYS = ["ALP", "LNP", "GRN", "ONP"];

  function renderChart() {
    const canvas = document.getElementById("pop-chart");
    if (!window.Chart || !canvas) return;   // Chart.js loads after the first paint (init)
    Chart.defaults.font.family = cssVar("--font-body") || "system-ui, sans-serif";
    const keys = seriesKeys();
    const records = App.pollRecords(polls, keys.filter((k) => RECORD_KEYS.includes(k)), chartValue);
    const ink = cssVar("--text");
    const datasets = [];
    keys.forEach((k) => {
      const color = partyColor(k);
      const avg = average(k);
      // The 95% interval: a lower edge with no line, then the upper edge filled down to it. Every third day is
      // plenty for a smooth band (and keeps Chart.js's fill cheap), plus the last day.
      const thin = avg.filter((pt, i) => i % 3 === 0 || i === avg.length - 1);
      const edge = (side) => ({ type: "line", band: true, label: `${partyName(k)} 95% ${side}`, data: thin.map((pt) => ({ x: pt.x, y: pt[side] })),
        borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, backgroundColor: withAlpha(color, 0.16) });
      datasets.push(edge("lo"), { ...edge("hi"), fill: "-1" });
      datasets.push({
        type: "line", label: partyName(k), data: avg,
        borderColor: color, backgroundColor: color, borderWidth: 2.5,
        pointRadius: 0, pointHoverRadius: 4,
      });
      const data = polls.filter((p) => chartValue(p, k) != null)
        .map((p) => ({ x: p.t, y: chartValue(p, k), poll: p, record: (records.get(p.id) || []).find((r) => r.key === k) }));
      // A poll that set a new high or low for this party is drawn larger, solid and outlined; a poll the
      // average leaves out (App.pollExclusion) is an empty ring.
      const out = (d) => !d.record && App.pollExclusion(d.poll);
      datasets.push({
        type: "scatter", label: `${partyName(k)} polls`, data,
        backgroundColor: data.map((d) => (d.record ? color : out(d) ? "transparent" : withAlpha(color, 0.35))),
        borderColor: data.map((d) => (d.record ? ink : out(d) ? withAlpha(color, 0.8) : "transparent")),
        borderWidth: data.map((d) => (d.record ? 1.5 : out(d) ? 1.5 : 0)),
        pointStyle: data.map((d) => (d.record ? (d.record.kind === "high" ? "triangle" : "rectRot") : "circle")),
        pointRadius: data.map((d) => (d.record ? 6 : 3.5)),
        pointHoverRadius: data.map((d) => (d.record ? 7.5 : 5)),
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
        parsing: false,      // every dataset is already {x, y}, sorted by x
        normalized: true,
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
            // A party's legend item hides its line, its polls and its band together.
            onClick: (e, item, legend) => {
              const ch = legend.chart, show = !ch.isDatasetVisible(item.datasetIndex);
              ch.data.datasets.forEach((d, i) => { if (d.label === item.text || d.label.startsWith(`${item.text} `)) ch.setDatasetVisibility(i, show); });
              ch.update();
            },
            labels: { color: text, usePointStyle: true, filter: (item) => !item.text.endsWith(" polls") && !/ 95% (lo|hi)$/.test(item.text) },
          },
          tooltip: {
            filter: (item) => !item.dataset.band,
            callbacks: {
              title: (items) => items.length ? fmtDate(new Date(items[0].parsed.x)) : "",
              label: (ctx) => {
                const poll = ctx.raw && ctx.raw.poll;
                const rec = ctx.raw && ctx.raw.record;
                return poll
                  ? `${poll.pollster}: ${ctx.dataset.label.replace(/ polls$/, "")} ${ctx.parsed.y}%`
                    + (rec ? ` (new ${rec.kind}${rec.current ? ", still the record" : ""})` : "")
                    + (App.pollExclusion(poll) ? ` (not in the average: ${App.pollExclusion(poll).toLowerCase()})` : "")
                  : `${ctx.dataset.label} average: ${ctx.parsed.y}%${ctx.raw && ctx.raw.lo != null ? ` (95% range ${App.fmtRange(ctx.raw)})` : ""}`;
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
    ["ALP", "LNP", "ONP", "GRN"].sort(byPartyOrder).forEach((k) => {
      const v = last((p) => (p.primary && p.primary[k] != null ? p.primary[k] : null));
      if (v != null) primaries[k] = v;
    });
    // The pendulum's uniform-swing projection; the card folds One Nation into Others.
    const t = App.projectSeats(districts, s).tally;
    const tally = { ALP: t.ALP, LNP: t.LNP, GRN: t.GRN, OTH: t.OTH + t.ONP };
    return App.ShareCard.homeCard({
      avg: { LNP2pp: s.current, ALP2pp: 100 - s.current, primaries, n: all.filter((p) => !App.pollExclusion(p)).length },
      tally, swing: s.swing, electionDate: meta.election_date,
      days: App.daysBetween(App.melbourneToday(), meta.election_date),
    });
  }

  /* ---------- Early and postal votes (data/early_votes.json): running totals by day, 2026 against 2022 ---------- */
  let evChart = null;
  const daysTo = (iso, election) => App.daysBetween(election, iso);   // negative before election day
  function cumulative(rows, key, election) {
    const kept = rows.filter((r) => r[key] != null);
    while (kept.length && !kept[kept.length - 1][key]) kept.pop();   // no flat tail of zero days (early voting ends before polling day)
    let sum = 0;
    return kept.map((r) => { sum += r[key]; return { x: daysTo(r.date, election), y: sum, date: r.date }; });
  }

  function renderEarly(doc, meta) {
    const status = document.getElementById("ev-status");
    const canvas = document.getElementById("ev-chart");
    if (!doc) { status.textContent = "Early and postal vote figures aren't available."; return; }
    const election = meta.election_date;
    const now = doc.statewide || [];
    const was = (doc.comparison_2022 && doc.comparison_2022.statewide) || [];
    const e26 = cumulative(now, "early", election), p26 = cumulative(now, "postal_returned", election);
    const e22 = cumulative(was, "early", doc.comparison_2022.election_date), p22 = cumulative(was, "postal_returned", doc.comparison_2022.election_date);
    const n = (v) => Number(v).toLocaleString("en-AU");
    if (doc.status !== "published" || !e26.length) {
      status.innerHTML = `The VEC hasn't published 2026 figures yet; early voting opens Wed 18 Nov. In 2022, ${n(doc.comparison_2022 ? doc.comparison_2022.totals.early : 0)} people voted early and ${n(doc.comparison_2022 ? doc.comparison_2022.totals.postal_returned : 0)} postal votes came back.`;
    } else {
      // Dated by whichever series runs later: no early voting on Sundays, but postal votes still arrive.
      const last = [e26[e26.length - 1], p26[p26.length - 1]].filter(Boolean).reduce((a, b) => (b.x > a.x ? b : a));
      const at = (series, x) => (series.filter((p) => p.x <= x).pop() || { y: 0 }).y;
      const lp = p26.length ? p26[p26.length - 1].y : null;
      status.innerHTML = `To ${escapeHtml(fmtDate(last.date))}: <strong>${n(e26[e26.length - 1].y)}</strong> early votes${lp != null ? ` and <strong>${n(lp)}</strong> postal votes returned` : ""}. At the same point in 2022: ${n(at(e22, last.x))} early${lp != null ? ` and ${n(at(p22, last.x))} postal` : ""}.`;
    }
    document.getElementById("ev-note").textContent = doc.checked ? `Checked ${App.fmtDateTime(doc.checked)}` : "";
    if (!window.Chart || !canvas) return;
    const early = cssVar("--accent"), postal = cssVar("--text"), grid = cssVar("--border"), text = cssVar("--muted");
    const line = (label, data, color, dashed) => ({ type: "line", label, data, borderColor: color, backgroundColor: color, borderWidth: 2.5,
      borderDash: dashed ? [6, 4] : [], pointRadius: dashed ? 0 : 3, pointHoverRadius: 5, tension: 0 });
    if (evChart) evChart.destroy();
    evChart = new Chart(canvas, {
      data: { datasets: [line("Early votes, 2026", e26, early), line("Postal votes returned, 2026", p26, postal),
        line("Early votes, 2022 (dashed)", e22, early, true), line("Postal votes returned, 2022 (dashed)", p22, postal, true)] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "nearest", intersect: false },
        scales: {
          x: { type: "linear", min: -13, max: 7, grid: { color: grid },
            title: { display: true, text: "Days to election day (0 = polling day)", color: text },
            ticks: { color: text, stepSize: 1, callback: (v) => (v === 0 ? "0" : v > 0 ? `+${v}` : `${v}`) } },
          y: { beginAtZero: true, grid: { color: grid }, ticks: { color: text, callback: (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : v) } },
        },
        plugins: {
          legend: { labels: { color: text, usePointStyle: true } },
          tooltip: { callbacks: { title: (items) => (items.length ? fmtDate(items[0].raw.date) : ""),
            label: (ctx) => `${ctx.dataset.label}: ${n(ctx.parsed.y)}` } },
        },
      },
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
            <th>Date</th><th>Pollster</th><th>Commissioned by</th><th class="num">Sample</th>
            ${primKeys.map((k) => `<th class="num" title="Primary vote">${escapeHtml(k)}</th>`).join("")}
            ${tppKeys.map((k) => `<th class="num" title="Two-party preferred">2PP ${escapeHtml(k)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${latest.map((p) => { const out = App.pollExclusion(p); return `
            <tr${out ? ' class="poll-excluded"' : ""}>
              <td>${escapeHtml(fmtDate(p.end_date))}</td>
              <td${out ? ` data-csv="${escapeHtml(`${p.pollster} (not in the average: ${out.toLowerCase()})`)}"` : ""}>${p.id ? `<a href="poll.html#${escapeHtml(p.id)}">${escapeHtml(p.pollster)}</a>` : escapeHtml(p.pollster)}${out
                ? `<span class="excl-reason">Not in the average: ${escapeHtml(out.toLowerCase())}</span>` : ""}</td>
              <td>${escapeHtml(App.commissionLabel(p))}</td>
              ${cell(p.sample_size ? p.sample_size.toLocaleString("en-AU") : null)}
              ${primKeys.map((k) => cell(p.primary && p.primary[k])).join("")}
              ${tppKeys.map((k) => cell(p.tpp && p.tpp[k])).join("")}
            </tr>`; }).join("")}
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
      renderNominations(meta);
      if (meta.last_updated) {
        document.getElementById("hero-updated").innerHTML =
          `<time datetime="${escapeHtml(meta.last_updated)}">${escapeHtml(App.dataUpdatedText(meta.last_updated))}</time>`;
      }
      renderHero(meta, districtData.districts, pollData, odds);
      // The other aggregates' line has its height reserved (style.css), so it can wait until the card has painted.
      App.afterPaint(() => loadJSON("poll_aggregates")).then(renderAggregates, () => {});
      // seat_models.json is the biggest of these (about 20 KB gzipped): fetched once the card has painted. Its space is reserved.
      App.afterPaint(() => loadJSON("seat_models")).then(renderModels, () => {
        document.getElementById("hero-models").innerHTML = '<p class="empty">Models failed to load.</p>';
      });
      renderWatch(districtData.districts, odds);
      renderSeats(meta, districtData.districts, regionData.regions);
      App.ShareCard.shareButton(document.getElementById("share-home"), async () => headlineCard(meta, districtData.districts, pollData));
      // "This week": the weekly briefing image (the same card refresh saves as share/this-week.png).
      App.ShareCard.shareButton(document.getElementById("share-week"), () => App.ShareCard.weekly());
      // The headline card paints first; the polls table and the chart (Chart.js, fetched once it has
      // painted) come after, in their own tasks.
      await new Promise((resolve) => setTimeout(resolve, 0));
      polls = preparePolls(pollData);
      renderTable(pollData);
      const earlyVotes = App.afterPaint(() => loadJSON("early_votes")).catch(() => null);
      earlyVotes.then((doc) => renderEarly(doc, meta));   // the line of figures, before the chart library arrives
      App.afterPaint(() => App.loadLib("chart")).then(() => {
        renderChart();
        document.addEventListener("themechange", renderChart);
        earlyVotes.then((doc) => {
          renderEarly(doc, meta);
          document.addEventListener("themechange", () => renderEarly(doc, meta));
        });
      }, () => {
        document.getElementById("pop-chart").parentElement.innerHTML = '<p class="empty">Chart library failed to load.</p>';
      });
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
    // Below the headline card: fetched after the first paint so it stays off the critical path.
    App.afterPaint(() => loadJSON("news")).then((n) => {
      // Outlet filter: every outlet in the statewide list, with its count; "All outlets" shows the five latest.
      const all = n.statewide || [], box = document.getElementById("news-statewide"), sel = document.getElementById("news-outlet");
      const counts = {};
      all.forEach((it) => { if (it.outlet) counts[it.outlet] = (counts[it.outlet] || 0) + 1; });
      Object.keys(counts).sort((a, b) => a.localeCompare(b)).forEach((o) => sel.add(new Option(`${o} (${counts[o]})`, o)));
      const show = () => {
        box.innerHTML = sel.value ? App.newsList(all.filter((it) => it.outlet === sel.value), { more: 5 }) : App.newsList(all.slice(0, 5));
      };
      sel.addEventListener("change", show);
      show();
      document.getElementById("news-updated").textContent = n.updated ? `Updated ${App.fmtDateTime(n.updated)}` : "";
    }).catch(() => {
      document.getElementById("news-statewide").innerHTML = "<p class=\"empty\">News isn't available yet.</p>";
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
