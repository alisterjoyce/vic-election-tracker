/* Pendulum (uniform-swing what-if, pendulum.html#swing=3.2) and the scenario explorer.
   Swing is to the Coalition in 2PP points: positive = towards L/NP, negative = towards Labor.
   Only Labor-v-Coalition contests swing; every other contest stays with its holder. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyName, partyVar, fmtDate, COALITION } = App;

  const SEATS = 88, MAJORITY = 45, MIN = -10, MAX = 15;
  const MINORS = ["ONP", "GRN", "IND"];   // betting favourites that override the swing in scenarios
  const RECENT_DAYS = 90;                  // "current polls": latest per pollster in this window

  let seats = [];        // {id, name, holder, vs, pct, swung}
  let favourites = {};   // district id -> minor party Sportsbet has as outright favourite
  let oddsDate = null;
  let base = null;       // L/NP 2PP at the 2022 election
  let average = null;    // App.statewideSwing() result
  let polls = [];
  let swing = 0;

  const $ = (id) => document.getElementById(id);
  const round1 = (v) => Math.round(v * 10) / 10;
  const bloc = (p) => (COALITION.includes(p) ? "LNP" : p === "ALP" || p === "GRN" || p === "ONP" ? p : "OTH");
  const BLOCS = ["ALP", "LNP", "GRN", "ONP", "OTH"];
  const BLOC_NAMES = { ALP: "Labor", LNP: "Coalition", GRN: "Greens", ONP: "One Nation", OTH: "Others" };
  const blocVar = (b) => (b === "LNP" ? "--p-lib" : b === "OTH" ? "--p-ind" : partyVar(b));

  function swingText(s) {
    if (Math.abs(s) < 0.05) return "No swing";
    return s > 0 ? `${App.fmtSwing(s)} to L/NP` : `${App.fmtSwing(-s)} to Labor`;
  }
  const tppText = (s) => `L/NP 2PP ${(base + s).toFixed(1)}, Labor ${(100 - base - s).toFixed(1)}`;

  // Winner of a seat at swing s (a seat falls when the swing exceeds its margin).
  function winner(seat, s) {
    if (!seat.swung) return seat.holder;
    if (seat.holder === "ALP") return s > seat.pct ? seat.vs : "ALP";
    return -s > seat.pct ? "ALP" : seat.holder;
  }

  // {winners: {id: party}, tally: {bloc: n}} at swing s, optionally with the betting overrides.
  function project(s, withFavourites) {
    const winners = {}, tally = Object.fromEntries(BLOCS.map((b) => [b, 0]));
    seats.forEach((seat) => {
      const w = (withFavourites && favourites[seat.id]) || winner(seat, s);
      winners[seat.id] = w;
      tally[bloc(w)]++;
    });
    return { winners, tally };
  }

  /* ---------- Pendulum ---------- */
  function seatItem(seat, w) {
    const falls = bloc(w) !== bloc(seat.holder);
    const contest = `${App.partyShort(seat.holder)} v ${App.partyShort(seat.vs)}`;
    const title = `${seat.name}: ${contest}, margin ${seat.pct.toFixed(1)}` +
      (seat.swung ? (falls ? `. Falls to ${partyName(w)}` : "") : ". Not a Labor-v-Coalition contest, so not swung");
    return `<li><a class="pd-seat${falls ? " falls" : ""}${seat.swung ? "" : " fixed"}" href="lower.html#${escapeHtml(seat.id)}"
        style="--party-color: var(${partyVar(w)}); ${falls ? `color:${App.inkFor(w)}` : ""}" title="${escapeHtml(title)}">
        <span class="pd-m">${seat.pct.toFixed(1)}</span>
        <span class="pd-n">${escapeHtml(seat.name)}</span>
        ${falls ? `<span class="pd-tag">→ ${escapeHtml(App.partyShort(w))}</span>` : seat.swung ? "" : `<span class="pd-tag">v ${escapeHtml(App.partyShort(seat.vs))}</span>`}
      </a></li>`;
  }

  // One side of the ladder, most marginal first, with the swing line where it crosses.
  function side(list, winners, lineAt) {
    let drawn = lineAt == null;
    const line = `<li class="pd-line" aria-hidden="true"><span>${escapeHtml(swingText(swing))}</span></li>`;
    const items = list.map((seat) => {
      let html = "";
      if (!drawn && seat.pct >= lineAt) { html += line; drawn = true; }
      return html + seatItem(seat, winners[seat.id]);
    });
    if (!drawn) items.push(line);
    return items.join("");
  }

  function tallyBars(tally) {
    return BLOCS.filter((b) => tally[b] > 0 || b === "ALP" || b === "LNP").map((b) => `
      <div class="tally-row">
        <span class="tally-label">${BLOC_NAMES[b]}</span>
        <span class="tally-track"><span class="tally-fill" style="width:${(100 * tally[b]) / SEATS}%;background:var(${blocVar(b)})"></span>
          <span class="tally-majority" style="left:${(100 * MAJORITY) / SEATS}%"></span></span>
        <span class="tally-num">${tally[b]}${tally[b] >= MAJORITY ? ' <span class="badge vec_nominated">Majority</span>' : ""}</span>
      </div>`).join("");
  }

  function renderPendulum() {
    const { winners, tally } = project(swing, false);
    const left = seats.filter((s) => s.holder === "ALP" || s.holder === "GRN").sort((a, b) => a.pct - b.pct);
    const right = seats.filter((s) => !(s.holder === "ALP" || s.holder === "GRN")).sort((a, b) => a.pct - b.pct);
    $("swing-value").textContent = swingText(swing);
    $("swing-tpp").textContent = tppText(swing);
    $("tally").innerHTML = tallyBars(tally);
    const changed = seats.filter((s) => bloc(winners[s.id]) !== bloc(s.holder)).length;
    $("tally-note").textContent = `${changed} seat${changed === 1 ? "" : "s"} change hands. The line marks ${MAJORITY} seats, a majority of ${SEATS}.`;
    $("pd-left").innerHTML = side(left, winners, swing > 0 ? swing : null);
    $("pd-right").innerHTML = side(right, winners, swing < 0 ? -swing : null);
  }

  function setSwing(s, { updateUrl = true } = {}) {
    swing = Math.max(MIN, Math.min(MAX, round1(s)));
    $("swing").value = String(swing);
    renderPendulum();
    if (updateUrl) history.replaceState(null, "", `#swing=${swing}`);
  }

  /* ---------- Scenarios ---------- */
  const SCENARIOS = [
    { id: "coalition-majority", title: "Coalition majority",
      test: (t) => t.LNP >= MAJORITY,
      blurb: "The Coalition wins 45 or more seats in its own right." },
    { id: "coalition-one-nation", title: "Coalition relying on One Nation",
      test: (t) => t.LNP < MAJORITY && t.LNP + t.ONP >= MAJORITY,
      blurb: "The Coalition falls short of 45 but reaches it with One Nation's seats." },
    { id: "labor-greens", title: "Labor-Greens minority",
      test: (t) => t.ALP < MAJORITY && t.ALP + t.GRN >= MAJORITY,
      blurb: "Labor falls short of 45 but reaches it with the Greens' seats." },
  ];

  // Contiguous swing range [lo, hi] (0.1 steps within the slider's range) where the test holds.
  function swingRange(test) {
    let lo = null, hi = null;
    for (let i = MIN * 10; i <= MAX * 10; i++) {
      const s = i / 10;
      if (test(project(s, true).tally)) { if (lo == null) lo = s; hi = s; }
    }
    return lo == null ? null : { lo, hi };
  }

  // Latest poll from each pollster in the RECENT_DAYS before the newest poll.
  function currentPolls() {
    if (!polls.length) return [];
    const newest = polls[polls.length - 1].t;
    const seen = new Set();
    return [...polls].reverse().filter((p) => {
      if (newest - p.t > RECENT_DAYS * App.DAY || seen.has(p.pollster)) return false;
      seen.add(p.pollster);
      return true;
    });
  }

  function scenarioCard(sc) {
    const range = swingRange(sc.test);
    let status, body = "";
    if (!range) {
      status = `<p class="sc-status">Not reached at any uniform swing between ${App.fmtSwing(MIN)} and ${App.fmtSwing(MAX)}.</p>`;
    } else {
      const lo = range.lo <= MIN ? null : range.lo, hi = range.hi >= MAX ? null : range.hi;
      const swingSpan = lo == null && hi == null ? "at any swing on the slider"
        : lo == null ? `at any swing up to ${swingText(hi)}`
          : hi == null ? `from a swing of ${swingText(lo)} upwards` : `between ${swingText(lo)} and ${swingText(hi)}`;
      const tppLo = lo == null ? null : base + lo, tppHi = hi == null ? null : base + hi;
      const tppSpan = tppLo == null && tppHi == null ? "any L/NP 2PP"
        : tppLo == null ? `an L/NP 2PP of ${tppHi.toFixed(1)} or less` : tppHi == null ? `an L/NP 2PP of ${tppLo.toFixed(1)} or more`
          : `an L/NP 2PP between ${tppLo.toFixed(1)} and ${tppHi.toFixed(1)}`;
      status = `<p class="sc-status">Reached ${swingSpan}: ${tppSpan}.</p>`;

      // Seats that change hands at the point the scenario is first reached.
      const entry = lo == null ? (hi == null ? 0 : Math.min(0, hi)) : lo;
      const { winners, tally } = project(entry, true);
      const lost = seats.filter((s) => bloc(winners[s.id]) !== bloc(s.holder))
        .sort((a, b) => (favourites[a.id] ? 1 : 0) - (favourites[b.id] ? 1 : 0) || a.pct - b.pct);
      const inRange = (v) => (tppLo == null || v >= tppLo - 0.05) && (tppHi == null || v <= tppHi + 0.05);
      const cur = currentPolls();
      const avg = average ? average.current : null;
      body = `
        <p class="small muted">At ${escapeHtml(swingText(entry))}: ${BLOCS.filter((b) => tally[b]).map((b) => `${BLOC_NAMES[b]} ${tally[b]}`).join(", ")}.</p>
        <h4>Seats that must fall (${lost.length})</h4>
        ${lost.length ? `<ul class="sc-seats">${lost.map((s) => {
          const w = winners[s.id];
          return `<li><a href="lower.html#${escapeHtml(s.id)}" style="--party-color: var(${partyVar(w)})" title="${escapeHtml(`${App.partyShort(s.holder)} ${s.pct.toFixed(1)}${favourites[s.id] ? `; Sportsbet favourite ${partyName(w)}` : ""}`)}">${escapeHtml(s.name)} <span class="muted">${escapeHtml(App.partyShort(s.holder))} ${s.pct.toFixed(1)} → ${escapeHtml(App.partyShort(w))}${favourites[s.id] ? "*" : ""}</span></a></li>`;
        }).join("")}</ul>` : '<p class="empty small">None: the current notional seats already give this result.</p>'}
        <h4>Polls that support it</h4>
        ${avg != null ? `<p class="small">Poll of polls: L/NP 2PP ${avg.toFixed(1)}, ${inRange(avg) ? "<strong>inside</strong>" : "outside"} the range.</p>` : ""}
        <ul class="sc-polls">${cur.map((p) => {
          const v = p.tpp && p.tpp.LNP;
          return `<li class="${v == null ? "na" : inRange(v) ? "yes" : "no"}">
            <span class="sc-mark" aria-hidden="true">${v == null ? "–" : inRange(v) ? "✓" : "✗"}</span>
            <a href="poll.html#${escapeHtml(p.id || "")}">${escapeHtml(p.pollster)}</a>
            <span class="muted small">${escapeHtml(fmtDate(p.end_date))}</span>
            <span class="num">${v == null ? "no 2PP" : `L/NP ${v}`}</span></li>`;
        }).join("")}</ul>
        <button type="button" class="icon-btn" data-show-swing="${entry}">Show on the pendulum</button>`;
    }
    return `<article class="card scenario" id="${sc.id}">
        <h3>${escapeHtml(sc.title)}</h3>
        <p class="muted small">${escapeHtml(sc.blurb)}</p>
        ${status}${body}
      </article>`;
  }

  function renderScenarios() {
    const favList = Object.entries(favourites);
    $("scenario-assumptions").innerHTML = `Seats where Sportsbet's outright favourite is One Nation, the Greens or an independent
      (${favList.length} seats, prices as at ${escapeHtml(fmtDate(oddsDate))}) go to that favourite; marked * below. Every other
      Labor-v-Coalition seat follows a uniform swing from the 2022 notional margins, and other contests stay with their holder.
      "Current polls" are the latest from each pollster in the ${RECENT_DAYS} days to the newest poll; a poll supports a scenario
      when its L/NP 2PP is inside the scenario's range.`;
    $("scenarios").innerHTML = SCENARIOS.map(scenarioCard).join("");
  }

  async function init() {
    try {
      const [dd, pd, meta, od] = await Promise.all([loadJSON("districts"), loadJSON("polls"), loadJSON("meta"),
        loadJSON("seat_odds").catch(() => null)]);
      base = meta.previous_election.tpp.LNP;
      polls = App.preparePolls(pd);
      average = App.statewideSwing(meta, pd);
      seats = dd.districts.filter((d) => d.margin && d.margin.pct != null).map((d) => {
        const m = d.margin;
        const swung = (m.party === "ALP" && COALITION.includes(m.vs)) || (COALITION.includes(m.party) && m.vs === "ALP");
        return { id: d.id, name: d.name, holder: m.party, vs: m.vs, pct: m.pct, swung };
      });
      if (od) {
        oddsDate = od.date_checked;
        (od.seats || []).forEach((s) => {
          if (MINORS.includes(s.favourite) && !(s.joint_favourites || []).length) favourites[s.district] = s.favourite;
        });
      }

      const slider = $("swing");
      slider.min = MIN; slider.max = MAX;
      slider.addEventListener("input", () => setSwing(Number(slider.value)));
      $("swing-poll").textContent = average ? `Poll average (${swingText(round1(average.swing))})` : "Poll average";
      $("swing-poll").disabled = !average;
      $("swing-poll").addEventListener("click", () => average && setSwing(average.swing));
      $("swing-zero").addEventListener("click", () => setSwing(0));
      $("pendulum-note").textContent = average
        ? `Starts at the poll-of-polls swing: L/NP 2PP ${average.current.toFixed(1)} against ${base.toFixed(1)} in ${average.year}.`
        : "No poll average available; starts at no swing.";
      document.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-show-swing]");
        if (!btn) return;
        setSwing(Number(btn.dataset.showSwing));
        $("pendulum-card").scrollIntoView({ behavior: "smooth", block: "start" });
      });

      const hashSwing = () => { const m = /swing=(-?\d+(?:\.\d+)?)/.exec(location.hash); return m ? Number(m[1]) : null; };
      window.addEventListener("hashchange", () => { if (hashSwing() != null) setSwing(hashSwing(), { updateUrl: false }); });
      setSwing(hashSwing() ?? (average ? average.swing : 0), { updateUrl: hashSwing() != null });
      renderScenarios();
      // The nav's "Scenarios" link: land on them once they're drawn (the pendulum above changes height).
      if (location.hash === "#scenarios") $("sc-title").scrollIntoView();
    } catch (err) {
      App.showError($("pendulum-card"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
