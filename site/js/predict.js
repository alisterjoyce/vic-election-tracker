/* Build your own prediction (predict.html): a winner for each of the 88 seats, starting from App.seatCalls (the
   party most seat-by-seat sources pick), changed with a tap. The hemicycle and totals follow every change. Only the
   seats the reader changed are kept, in localStorage ("vet-predict"), so the rest follow the sources as they move. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml } = App;
  const $ = (id) => document.getElementById(id);
  const KEY = "vet-predict";
  const SEATS = 88, MAJORITY = 45;
  const BLOCS = App.BLOCS, LABEL = App.BLOC_LABEL, COLOR = App.BLOC_COLOR;
  const SHORT = { GRN: "GRN", ALP: "ALP", LNP: "L/NP", ONP: "ONP", OTH: "OTH" };

  let districts = [];       // districts.json rows, by region then name
  let defaults = {};        // district id -> bloc, from the sources (else the holder)
  let sources = {};         // district id -> App.seatCalls entry
  let options = {};         // district id -> [{bloc, text}]
  let picks = {};           // district id -> bloc, only where it differs from defaults

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      return v && v.picks && typeof v.picks === "object" ? v.picks : {};
    } catch (e) { return {}; }
  }
  function save() {
    try {
      if (Object.keys(picks).length) localStorage.setItem(KEY, JSON.stringify({ v: 1, picks }));
      else localStorage.removeItem(KEY);
    } catch (e) { /* private mode: picks last until the page closes */ }
  }
  const pickOf = (id) => picks[id] || defaults[id];

  function counts(of = pickOf) {
    const c = Object.fromEntries(BLOCS.map((b) => [b, 0]));
    districts.forEach((d) => { c[of(d.id)]++; });
    return c;
  }

  // "Coalition majority, 47 seats" or "No majority: Coalition 44, 1 short".
  function verdict(c) {
    const top = BLOCS.reduce((a, b) => (c[b] > c[a] ? b : a));
    return c[top] >= MAJORITY ? `${LABEL[top]} majority, ${c[top]} seats`
      : `No majority: ${LABEL[top]} ${c[top]}, ${MAJORITY - c[top]} short`;
  }

  function renderSummary() {
    const c = counts(), base = counts((id) => defaults[id]);
    const ranked = BLOCS.slice().sort(App.byValue((b) => c[b]));   // most seats first, ties in the fixed party order
    const segments = ranked.filter((b) => c[b]).map((b) => ({ code: COLOR[b], n: c[b] }));
    const hemi = App.hemicycle({ segments, label: `Your parliament: ${ranked.filter((b) => c[b]).map((b) => `${LABEL[b]} ${c[b]}`).join(", ")}. ${MAJORITY} seats needed for a majority.` });
    const changed = Object.keys(picks).length;
    const diff = (b) => { const d = c[b] - base[b]; return `<span class="pred-diff">${d ? `${d > 0 ? "+" : "−"}${Math.abs(d)}` : ""}</span>`; };   // always there, so the figures line up
    $("pred-summary").innerHTML = `<figure class="pred-hemi">${hemi}</figure>
      <div class="pred-side"><p class="pred-verdict">${escapeHtml(verdict(c))}</p>
        <ul class="pred-totals">${ranked.map((b) => `<li><span class="swatch" style="background:var(${App.partyVar(COLOR[b])})"></span>${LABEL[b]}<b>${c[b]}</b>${diff(b)}</li>`).join("")}
          <li class="hb-maj-key"><span class="hb-maj-mark"></span>${MAJORITY} for a majority</li></ul></div>`;
    $("pred-note").textContent = changed
      ? `You've changed ${changed} seat${changed === 1 ? "" : "s"} from the starting picks; the small figures show the difference.`
      : "These are the starting picks. Change any seat below.";
    $("pred-strip").innerHTML = `<span class="pred-strip-v">${escapeHtml(verdict(c))}</span>
      <span class="pred-strip-n">${ranked.filter((b) => c[b]).map((b) => `<span><i style="background:var(${App.partyVar(COLOR[b])})"></i>${SHORT[b]} <b>${c[b]}</b></span>`).join("")}</span>`;
    $("pred-reset").disabled = !changed;
  }

  // What the sources say about a seat, in a line: "Starting pick: Labor (Australian Election Forecasts, Sportsbet)".
  function sourceLine(id) {
    const e = sources[id];
    if (!e) return "No source rates this seat: starts with its holder";
    const short = (l) => l.replace("Australian Election Forecasts", "AEF").replace("Sportsbet favourite", "Sportsbet");
    const names = e.calls.filter((x) => App.blocOf(x.party) === defaults[id]).map((x) => short(x.label));
    return `${names.join(", ")}${e.disagree ? ` · ${e.disagree} differ${e.disagree === 1 ? "s" : ""}` : ""}`;
  }

  function seatRow(d) {
    const p = pickOf(d.id), changed = !!picks[d.id];
    return `<li class="pred-seat${changed ? " is-changed" : ""}" style="--party-color: var(${App.partyVar(COLOR[p])})" data-id="${escapeHtml(d.id)}">
      <span class="pred-seat-name"><a href="lower.html#${escapeHtml(d.id)}">${escapeHtml(d.name)}</a>
        <span class="muted small">${changed ? `Starting pick: ${escapeHtml(LABEL[defaults[d.id]])}` : escapeHtml(sourceLine(d.id))}</span></span>
      <select aria-label="Winner in ${escapeHtml(d.name)}">${options[d.id].map((o) =>
        `<option value="${o.bloc}"${o.bloc === p ? " selected" : ""}>${escapeHtml(o.text)}</option>`).join("")}</select></li>`;
  }

  function renderSeats(regions) {
    const byRegion = {};
    districts.forEach((d) => { (byRegion[d.region] = byRegion[d.region] || []).push(d); });
    $("pred-regions").innerHTML = regions.filter((r) => byRegion[r.id]).map((r) => `<section class="card pred-region" aria-labelledby="pr-${r.id}">
        <h2 id="pr-${r.id}">${escapeHtml(r.name)} Region <span class="muted small">${byRegion[r.id].length} seats</span></h2>
        <ul class="pred-seats">${byRegion[r.id].map(seatRow).join("")}</ul></section>`).join("");
  }

  function onChange(e) {
    const sel = e.target.closest(".pred-seat select");
    if (!sel) return;
    const li = sel.closest(".pred-seat"), id = li.dataset.id;
    if (sel.value === defaults[id]) delete picks[id]; else picks[id] = sel.value;
    save();
    const d = districts.find((x) => x.id === id);
    li.outerHTML = seatRow(d);
    renderSummary();
  }

  async function init() {
    try {
      const [dd, rd, models, odds, noms] = await Promise.all([loadJSON("districts"), loadJSON("regions"),
        loadJSON("seat_models").catch(() => null), loadJSON("seat_odds").catch(() => null), loadJSON("vec_nominations").catch(() => null)]);
      const regions = rd.regions.slice().sort((a, b) => a.name.localeCompare(b.name));
      const order = Object.fromEntries(regions.map((r, i) => [r.id, i]));
      districts = dd.districts.slice().sort((a, b) => (order[a.region] ?? 99) - (order[b.region] ?? 99) || a.name.localeCompare(b.name));
      sources = App.seatCalls(models, odds);
      districts.forEach((d) => {
        const e = sources[d.id];
        defaults[d.id] = App.blocOf(e && e.pick ? e.pick : (d.margin && d.margin.party) || d.party);
        // The choices: every bloc with a candidate on the seat's ballot (all five where the VEC list isn't loaded),
        // plus the starting pick; the Coalition labelled with the party or parties standing (Liberal, Nationals).
        const cands = (noms && noms.districts && noms.districts[d.id] && noms.districts[d.id].candidates) || null;
        const parties = cands ? cands.map((c) => c.party) : null;
        const blocs = BLOCS.filter((b) => !parties || b === defaults[d.id] || parties.some((p) => App.blocOf(p) === b));
        const coal = parties ? [...new Set(parties.filter((p) => App.COALITION.includes(p)))] : [];
        options[d.id] = blocs.map((b) => ({ bloc: b,
          text: b === "LNP" && coal.length ? coal.map((p) => (p === "NAT" ? "Nationals" : p === "LIB" ? "Liberal" : "Coalition")).join(" or ")
            : b === "OTH" ? "Independent or other" : LABEL[b] }));
      });
      picks = load();
      Object.keys(picks).forEach((id) => {   // drop anything stale: unknown seats, or a pick that is now the starting pick
        if (!defaults[id] || !BLOCS.includes(picks[id]) || picks[id] === defaults[id]) delete picks[id];
      });
      renderSummary();
      renderSeats(regions);
      $("pred-regions").addEventListener("change", onChange);
      $("pred-reset").addEventListener("click", () => {
        picks = {};
        save();
        renderSeats(regions);
        renderSummary();
      });
      App.ShareCard.shareButton($("pred-share"), () => App.ShareCard.predictCard({ counts: counts(), changed: Object.keys(picks).length }));
    } catch (err) {
      App.showError($("pred-summary"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
