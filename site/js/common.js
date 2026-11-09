/* Shared helpers for every page: data loading, theme, formats, party palette,
   header chrome (search, key-dates strip), watchlist, poll smoothing, seat-outlook maths, footer.
   Conventions (palette, formats, copyright) are documented in CLAUDE.md. */
(function () {
  "use strict";

  // The site root (where index.html lives), so pages in subfolders such as data/ load the same files.
  const ROOT = new URL("..", document.currentScript ? document.currentScript.src : location.href);

  // Colours are CSS variables (style.css); unlisted parties fall back to --p-oth.
  const PARTIES = {
    ALP: { name: "Labor", color: "--p-alp" },
    LNP: { name: "Liberal/National", color: "--p-lnp" },
    LIB: { name: "Liberal", color: "--p-lib" },
    NAT: { name: "Nationals", color: "--p-nat" },
    GRN: { name: "Greens", color: "--p-grn" },
    ONP: { name: "One Nation", color: "--p-onp" },
    LCV: { name: "Legalise Cannabis", color: "--p-lcv" },
    VS: { name: "Victorian Socialists", color: "--p-vs" },
    AJP: { name: "Animal Justice", color: "--p-ajp" },
    LBT: { name: "Libertarian", color: "--p-lbt" },
    FF: { name: "Family First", color: "--p-ff" },
    ND: { name: "New Democrats", color: "--p-oth" },
    WEST: { name: "West Party", color: "--p-oth" },
    SAL: { name: "Socialist Alliance", color: "--p-oth" },
    SFF: { name: "Shooters, Fishers and Farmers", color: "--p-oth" },
    DLP: { name: "Democratic Labour", color: "--p-oth" },
    SUS: { name: "Sustainable Australia", color: "--p-oth" },
    ILAB: { name: "Independent Labor", color: "--p-ind" },
    IND: { name: "Independent", color: "--p-ind" },
    OTH: { name: "Other", color: "--p-oth" },
  };

  // Short labels where the code alone would mislead (LNP is a Queensland party).
  const SHORT = { LNP: "L/NP", ILAB: "Ind. Labor" };
  const COALITION = ["LNP", "LIB", "NAT"];

  const STATUSES = {
    announced: "Announced",
    reported: "Reported",
    endorsed: "Endorsed",
    vec_nominated: "VEC-nominated",
    withdrawn: "Withdrawn",
    superseded: "Superseded",
    not_standing: "Not standing",
  };

  const cache = {};

  function loadJSON(name) {
    if (!cache[name]) {
      cache[name] = fetch(new URL(`data/${name}.json`, ROOT), { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`${name}.json: HTTP ${r.status}`);
        return r.json();
      });
    }
    return cache[name];
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function partyName(code) {
    return (PARTIES[code] && PARTIES[code].name) || code || "Unknown";
  }

  function partyShort(code) {
    return SHORT[code] || code || "?";
  }

  function partyVar(code) {
    return (PARTIES[code] && PARTIES[code].color) || "--p-oth";
  }

  function partyColor(code) {
    return getComputedStyle(document.documentElement).getPropertyValue(partyVar(code)).trim();
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function partyBadge(code, { full = true } = {}) {
    const label = full ? partyName(code) : partyShort(code);
    return `<span class="party" style="--party-color: var(${partyVar(code)})" title="${escapeHtml(partyName(code))}">${escapeHtml(label)}</span>`;
  }

  function statusBadge(status) {
    const label = STATUSES[status] || status || "Unknown";
    const cls = STATUSES[status] ? status : "neutral";
    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
  }

  function slugify(s) {
    return String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  /* ---- Formats (CLAUDE.md: "22 Oct 2026", margins to 1 dp, signed swings, prices as 1.72) ---- */
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function parseDate(iso) {
    // Date-only strings are treated as local midnight so they don't shift a day.
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, d] = iso.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date(iso);
  }

  // "22 Oct 2026". Accepts "YYYY-MM-DD", an ISO timestamp or a Date.
  function fmtDate(value) {
    if (!value) return "";
    const d = value instanceof Date ? value : parseDate(value);
    if (isNaN(d)) return "";
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  // "Oct 2026" (chart axes)
  function fmtMonth(value) {
    const d = value instanceof Date ? value : new Date(value);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  // Melbourne wall-clock parts for a timestamp.
  function melbourneParts(date) {
    const parts = {};
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Melbourne", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
    }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
    return parts;
  }

  // "Data updated 31 Oct 2026, 6:04 am Melbourne time" (footer and the home page's headline card).
  function dataUpdatedText(iso) {
    const p = melbourneParts(new Date(iso));
    return `Data updated ${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} ${(p.dayPeriod || "").toLowerCase()} Melbourne time`;
  }

  // "30 Oct 2026, 1:18 pm AEDT" in Melbourne time.
  function fmtDateTime(iso) {
    const p = melbourneParts(new Date(iso));
    return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} ${(p.dayPeriod || "").toLowerCase()} ${p.timeZoneName || ""}`.trim();
  }

  // Today's date in Melbourne as "YYYY-MM-DD".
  function melbourneToday(now = new Date()) {
    const p = melbourneParts(now);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  }

  // Whole calendar days from date a to date b ("YYYY-MM-DD").
  function daysBetween(a, b) {
    const utc = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((utc(b) - utc(a)) / 86400000);
  }

  const fmt1 = (n) => Number(n).toFixed(1);
  const fmtPrice = (p) => (p == null ? "" : Number(p).toFixed(2));
  const fmtMargin = (party, pct) => `${partyShort(party)} ${fmt1(pct)}`;
  // "+9.7" / "−2.1" (true minus sign)
  const fmtSwing = (v) => `${v >= 0 ? "+" : "−"}${fmt1(Math.abs(v))}`;

  /* ---- Poll of polls (shared by the home chart and the seat outlook) ---- */
  const DAY = 86400000;
  const BANDWIDTH_DAYS = 21; // standard deviation of the Gaussian smoothing kernel

  // Polls sorted by fieldwork midpoint, each with a timestamp `t`.
  function preparePolls(pollData) {
    return ((pollData && pollData.polls) || [])
      .filter((p) => p.end_date)
      .map((p) => {
        const end = parseDate(p.end_date).getTime();
        const start = p.start_date ? parseDate(p.start_date).getTime() : end;
        return { ...p, t: (start + end) / 2 };
      })
      .sort((a, b) => a.t - b.t);
  }

  // Centred Gaussian-kernel average of value(p), weighted by sqrt(sample size).
  // Returns daily points [{x: time, y: value}] from the first to the last poll.
  function smoothedSeries(polls, value) {
    const pts = polls.filter((p) => value(p) != null);
    if (!pts.length) return [];
    const out = [];
    const bw = BANDWIDTH_DAYS * DAY;
    const first = pts[0].t, last = pts[pts.length - 1].t;
    const days = Math.ceil((last - first) / DAY);
    for (let i = 0; i <= days; i++) {
      const t = Math.min(first + i * DAY, last);
      let w = 0, v = 0;
      for (const p of pts) {
        const z = (t - p.t) / bw;
        if (Math.abs(z) > 3) continue;
        const weight = Math.exp(-0.5 * z * z) * Math.sqrt((p.sample_size || 1000) / 1000);
        w += weight; v += weight * value(p);
      }
      if (w > 0) out.push({ x: t, y: Math.round((v / w) * 10) / 10 });
    }
    return out;
  }

  // Polls that set a new high or low for a party when they came out. polls: preparePolls output; keys: party
  // codes; value(p, key): the figure or null. Polls are taken in order of fieldwork end. A record needs at least
  // RECORD_MIN_PRIOR earlier polls with that party (so the first few polls of the term don't all count), and a
  // tie doesn't set one. Returns Map poll id -> [{key, kind: "high" | "low", value, prev, prevPoll, current, n}]:
  // prev/prevPoll are the record it broke; current is true while no later poll has gone past it; n is how
  // many polls carry that party's figure.
  const RECORD_MIN_PRIOR = 5;
  function pollRecords(polls, keys, value) {
    const order = [...polls].sort((a, b) => (a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : a.t - b.t));
    const out = new Map();
    keys.forEach((key) => {
      let lo = null, hi = null, n = 0;
      const found = [];
      order.forEach((p) => {
        const v = value(p, key);
        if (v == null || isNaN(v)) return;
        if (n >= RECORD_MIN_PRIOR) {
          if (v < lo.v) found.push({ poll: p, key, kind: "low", value: v, prev: lo.v, prevPoll: lo.p });
          if (v > hi.v) found.push({ poll: p, key, kind: "high", value: v, prev: hi.v, prevPoll: hi.p });
        }
        if (!lo || v < lo.v) lo = { v, p };
        if (!hi || v > hi.v) hi = { v, p };
        n++;
      });
      found.forEach((r) => {
        r.current = r.poll === (r.kind === "low" ? lo.p : hi.p);
        r.n = n;
        if (!out.has(r.poll.id)) out.set(r.poll.id, []);
        out.get(r.poll.id).push(r);
      });
    });
    return out;
  }

  /* ---- Seat outlook maths (district page and My seats) ---- */
  // Statewide swing to the Coalition: current poll-of-polls L/NP 2PP minus
  // the previous election's L/NP 2PP.
  function statewideSwing(meta, pollData) {
    const prev = meta && meta.previous_election;
    const base = prev && prev.tpp && prev.tpp.LNP;
    const series = smoothedSeries(preparePolls(pollData), (p) => (p.tpp && p.tpp.LNP != null ? p.tpp.LNP : null));
    if (base == null || !series.length) return null;
    const current = series[series.length - 1].y;
    return { current, base, swing: current - base, year: (prev.date || "").slice(0, 4) };
  }

  // Uniform swing applied to a Labor-v-Coalition margin; null for other contests.
  function swingAdjusted(m, s) {
    if (!m || m.pct == null || !s) return null;
    if (m.party === "ALP" && COALITION.includes(m.vs)) {
      const after = m.pct - s.swing;   // Labor's margin after the swing
      return { before: fmtMargin("ALP", m.pct), after: after >= 0 ? fmtMargin("ALP", after) : fmtMargin(m.vs, -after),
               winner: after >= 0 ? "ALP" : m.vs };
    }
    if (COALITION.includes(m.party) && m.vs === "ALP") {
      const after = m.pct + s.swing;   // Coalition's margin after the swing
      return { before: fmtMargin(m.party, m.pct), after: after >= 0 ? fmtMargin(m.party, after) : fmtMargin("ALP", -after),
               winner: after >= 0 ? m.party : "ALP" };
    }
    return null;
  }

  // Seats at a uniform swing, by the pendulum's rule: Labor-v-Coalition contests swing, every other
  // contest stays with its holder. Returns {winners: {district id: party}, tally: {bloc: seats}}.
  const BLOCS = ["ALP", "LNP", "GRN", "ONP", "OTH"];
  const blocOf = (p) => (COALITION.includes(p) ? "LNP" : BLOCS.includes(p) ? p : "OTH");
  // Upper-house groups' quotas filled: one bar each, a full quota at the first tick (half way), two at the end.
  function quotaBars(groups) {
    return `<ul class="quota-bars">${groups.map((g) => `<li><span class="qb-name">${escapeHtml(g.name || partyName(g.party))}</span>
      <span class="qb-track"><span class="qb-fill" style="width:${Math.min(100, 50 * g.quotas)}%;background:var(${partyVar(g.party)})"></span><span class="qb-one" title="One quota"></span></span>
      <span class="qb-num">${Number(g.quotas).toFixed(2)}</span></li>`).join("")}</ul>`;
  }
  // A seat model's credit, linked to its page: "Australian Election Forecasts (aeforecasts.com)" wherever it's shown.
  const modelLink = (m) => `<a href="${escapeHtml(m.source_url || "#")}" rel="noopener" target="_blank">${escapeHtml(m.credit || m.name)}</a>`;
  function projectSeats(districts, s) {
    const winners = {}, tally = Object.fromEntries(BLOCS.map((b) => [b, 0]));
    districts.forEach((d) => {
      const adj = swingAdjusted(d.margin, s);
      const w = adj ? adj.winner : (d.margin && d.margin.party) || d.party;
      winners[d.id] = w;
      tally[blocOf(w)]++;
    });
    return { winners, tally };
  }

  /* ---- Candidates: ids, headshots and initials avatars ---- */
  // "<district or region id>/<slug of Given Surname>", matching scripts/build_headshots.py.
  function givenFirst(name) {
    if (!name || !name.includes(",")) return name || "";
    const [sur, ...rest] = name.split(",");
    return `${rest.join(",").trim()} ${sur.trim()}`;
  }

  function candidateId(seat, name) {
    return `${seat}/${slugify(givenFirst(name))}`;
  }

  let headshots = null;
  function loadHeadshots() {
    if (!headshots) {
      headshots = loadJSON("headshots")
        .then((d) => Object.fromEntries((d.headshots || []).map((h) => [h.id, h])))
        .catch(() => ({}));
    }
    return headshots;
  }

  function initials(name) {
    const parts = givenFirst(name).replace(/[^\p{L}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  // Text on a party colour: black or white, whichever contrasts more (WCAG AA for every party, light and dark).
  // inkVar is for the page (a CSS variable, so it follows the theme toggle: --ink-* in style.css);
  // inkFor is the current theme's colour itself, for canvas.
  function inkVar(code) {
    return `var(${partyVar(code).replace("--p-", "--ink-")})`;
  }
  function inkFor(code) {
    const set = getComputedStyle(document.documentElement).getPropertyValue(partyVar(code).replace("--p-", "--ink-")).trim();
    if (set) return set;
    const m = (partyColor(code) || "").match(/^#?([0-9a-f]{6})$/i);
    if (!m) return "#fff";
    const n = parseInt(m[1], 16);
    const lin = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return lum > 0.179 ? "#000" : "#fff";   // 0.179: where black and white contrast equally
  }

  // Photo if one exists (from a loadHeadshots() map), otherwise a party-colour initials circle.
  function avatar(shots, seat, name, party, { size = 40 } = {}) {
    const shot = shots && shots[candidateId(seat, name)];
    const style = `width:${size}px;height:${size}px`;
    if (shot) {
      const src = size > 120 ? shot.files["320"] : shot.files["160"];
      // Large photos are a profile's main image (its LCP): fetch them straight away.
      const load = size > 120 ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';
      return `<img class="avatar" src="${escapeHtml(src)}" alt="" width="${size}" height="${size}" ${load} style="${style}" title="Photo: ${escapeHtml(shot.source.credit)}">`;
    }
    return `<span class="avatar avatar-initials" aria-hidden="true" style="${style};font-size:${Math.round(size * 0.38)}px;background:var(${partyVar(party)});color:${inkVar(party)}">${escapeHtml(initials(name))}</span>`;
  }

  // "Photos: Victorian Labor (Jane Citizen), ..." for the photos shown in a list. Names are the
  // tracker's spelling (ABC is the authority), not the spelling published with the photo.
  function photoCredits(shots, people) {
    const used = people.map(([seat, name]) => {
      const shot = shots && shots[candidateId(seat, name)];
      return shot && { shot, name };
    }).filter(Boolean);
    if (!used.length) return "";
    const byCredit = {};
    used.forEach((u) => { (byCredit[u.shot.source.credit] = byCredit[u.shot.source.credit] || []).push(u); });
    return `<p class="photo-credits muted small">Photos: ${Object.entries(byCredit).map(([credit, list]) =>
      `${escapeHtml(credit)} (${list.map((u) => `<a href="${escapeHtml(u.shot.source.page)}" rel="noopener" target="_blank">${escapeHtml(u.name)}</a>`).join(", ")})`).join("; ")}.</p>`;
  }

  function profileHref(seat, name) {
    return `candidate.html#${candidateId(seat, name)}`;
  }

  // Name linked to the candidate's profile page.
  function profileLink(seat, name, label = name) {
    return `<a class="profile-link" href="${escapeHtml(profileHref(seat, name))}">${escapeHtml(label)}</a>`;
  }

  const isPlaceholder = (name) => /^TB[CD]$/i.test(String(name || "").trim());

  // Everyone with a profile: active candidates (both houses), upper-house ticket
  // names and current MLCs, merged by candidate id. Earlier sources win per field:
  // tickets, then candidates.json, then the MLC list.
  function buildPeople(cd, rd, dd) {
    const districts = Object.fromEntries(((dd && dd.districts) || []).map((d) => [d.id, d]));
    const regions = Object.fromEntries(((rd && rd.regions) || []).map((r) => [r.id, r]));
    const byId = new Map();
    const add = (seat, name, fields) => {
      if (!name || isPlaceholder(name)) return;
      const id = candidateId(seat, name);
      let p = byId.get(id);
      if (!p) {
        const place = districts[seat] || regions[seat] || {};
        p = { id, name, seat, house: districts[seat] ? "lower" : "upper", seatName: place.name || seat };
        byId.set(id, p);
      }
      Object.entries(fields).forEach(([k, v]) => { if (v != null && p[k] == null) p[k] = v; });
    };
    Object.values(regions).forEach((r) => (r.tickets || []).forEach((t) => (t.candidates || []).forEach((name, i) =>
      add(r.id, name, { party: t.party, status: t.status, ticket_position: i + 1, group: t.group, on_ticket: true, contesting: true }))));
    ((cd && cd.candidates) || []).forEach((c) => {
      if (c.status === "superseded" || c.status === "not_standing") return;
      const seat = c.district || c.region;
      if (!districts[seat] && !regions[seat]) return;
      add(seat, c.name, { party: c.party, status: c.status, ticket_position: c.ticket_position, incumbent: c.incumbent || null,
        source: c.source, source_url: c.source_url, notes: c.notes || null, date_added: c.date_added, updated: c.updated, contesting: true,
        website: c.website, ballot_position: c.ballot_position, ballot_name: c.ballot_name, group: c.group,
        party_name: c.party_name, former_names: c.former_names, moved_to: c.moved_to });
    });
    Object.values(regions).forEach((r) => (r.mlcs || []).forEach((m) =>
      add(r.id, m.name, { party: m.party, mlc: { party: m.party, retiring: !!m.retiring, notes: m.notes || "" } })));
    return [...byId.values()];
  }

  let people = null;
  function loadPeople() {
    if (!people) {
      people = Promise.all([loadJSON("candidates"), loadJSON("regions"), loadJSON("districts")])
        .then(([cd, rd, dd]) => buildPeople(cd, rd, dd));
    }
    return people;
  }

  /* ---- Ballot paper (data/vec_nominations.json: the VEC's official list) ---- */
  // "SURNAME, Given" as the ballot prints it, surname in capitals.
  function ballotNameHtml(b) {
    const i = String(b).indexOf(",");
    return i < 0 ? `<span class="bp-sur">${escapeHtml(b)}</span>`
      : `<span class="bp-sur">${escapeHtml(b.slice(0, i))}</span>, ${escapeHtml(b.slice(i + 1).trim())}`;
  }

  const bpLink = (c) => (c.id ? `<a class="bp-name" href="candidate.html#${escapeHtml(c.id)}">${ballotNameHtml(c.ballot_name)}</a>`
    : `<span class="bp-name">${ballotNameHtml(c.ballot_name)}</span>`);
  const bpParty = (c) => `<span class="bp-party">${escapeHtml(c.party_label || (c.party === "IND" ? "Independent" : ""))}</span>`;

  // The seat's or region's ballot paper, in the VEC's order once the 9 Nov draw is published (before that, the
  // order the candidates nominated, clearly labelled). entry: vec_nominations.json → districts[id] or regions[id].
  function ballotPaper(entry, house) {
    if (!entry || !(entry.candidates || []).length) return "";
    const drawn = !!entry.ballot_drawn;
    const src = `<p class="muted small bp-src">Source: <a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener">Victorian Electoral Commission</a>,
      nominations closed noon Mon 9 Nov 2026. ${entry.candidates.length} candidates${house === "upper" ? ` for ${entry.vacancies || 5} vacancies` : ""}.</p>`;
    const pending = `<p class="bp-note">The VEC drew the ballot order at 4 pm on Mon 9 Nov; it will show here once the VEC publishes it.
      Until then the candidates are listed in the order they nominated, which is not the ballot order.</p>`;
    const byNom = (a, b) => (a.nominated || 0) - (b.nominated || 0);
    if (house === "lower") {
      const cands = entry.candidates.slice().sort(drawn ? (a, b) => a.ballot_position - b.ballot_position : byNom);
      return `<div class="ballot-paper${drawn ? "" : " is-pending"}">
        <p class="bp-head">Legislative Assembly · ${escapeHtml(entry.name)} District</p>
        ${drawn ? "" : pending}
        <ol class="bp-list">${cands.map((c) => `<li style="--party-color: var(${partyVar(c.party)})">
          <span class="bp-pos" aria-label="${drawn ? `Ballot position ${c.ballot_position}` : ""}">${drawn ? c.ballot_position : ""}</span>
          <span class="bp-box" aria-hidden="true"></span>
          <span class="bp-who">${bpLink(c)}${bpParty(c)}</span></li>`).join("")}</ol>
        ${src}</div>`;
    }
    if (!drawn) {
      const cands = entry.candidates.slice().sort(byNom);
      return `<div class="ballot-paper bp-upper is-pending">
        <p class="bp-head">Legislative Council · ${escapeHtml(entry.name)} Region</p>
        ${pending.replace("ballot order", "group letters and order")}
        <ul class="bp-list bp-cols">${cands.map((c) => `<li style="--party-color: var(${partyVar(c.party)})">
          <span class="bp-who">${bpLink(c)}${bpParty(c)}</span></li>`).join("")}</ul>
        ${src}</div>`;
    }
    const groups = (entry.groups || []).map((g) => ({ ...g, members: entry.candidates.filter((c) => c.group === g.group) }));
    const loose = entry.candidates.filter((c) => !c.group);
    const col = (letter, label, party, members) => `<div class="bp-group" style="--party-color: var(${partyVar(party)})">
        <div class="bp-ghead">${letter ? `<span class="bp-letter">${escapeHtml(letter)}</span>` : ""}<span class="bp-glabel">${escapeHtml(label || "")}</span></div>
        <ol class="bp-list">${members.map((c) => `<li style="--party-color: var(${partyVar(c.party)})">
          <span class="bp-box" aria-hidden="true"></span><span class="bp-who">${bpLink(c)}${letter && c.party_label && c.party_label !== label ? bpParty(c) : (letter ? "" : bpParty(c))}</span></li>`).join("")}</ol>
      </div>`;
    return `<div class="ballot-paper bp-upper">
      <p class="bp-head">Legislative Council · ${escapeHtml(entry.name)} Region</p>
      <div class="bp-groups">${groups.map((g) => col(g.group, g.label || "(group with no name)", g.party || "OTH", g.members)).join("")}
        ${loose.length ? col("", "Ungrouped", "IND", loose) : ""}</div>
      <p class="muted small">Groups in ballot order (A first), each with its candidates in their order on the ballot; ungrouped candidates last.</p>
      ${src}</div>`;
  }

  /* ---- News (data/news.json): headline, outlet, date and link only ---- */
  function newsList(items, { more = 0 } = {}) {
    if (!items || !items.length) return '<p class="empty">No recent stories found.</p>';
    const li = (it) => `<li><a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>
        <span class="muted small">${escapeHtml(it.outlet || "")}${it.outlet ? " · " : ""}${escapeHtml(fmtDate(it.published))}</span></li>`;
    const shown = more ? items.slice(0, more) : items;
    const rest = more ? items.slice(more) : [];
    return `<ul class="news-list">${shown.map(li).join("")}</ul>
      ${rest.length ? `<details class="news-more"><summary>${rest.length} more</summary><ul class="news-list">${rest.map(li).join("")}</ul></details>` : ""}`;
  }

  function hashId() {
    return decodeURIComponent(location.hash.replace(/^#/, "")).trim().toLowerCase();
  }

  /* ---- Watchlist (localStorage; works without a backend, degrades to this page only) ---- */
  const WATCH_KEY = "vic2026.watchlist";
  let memoryWatch = null;   // fallback when storage is blocked

  function getWatchlist() {
    if (memoryWatch) return memoryWatch.slice();
    try {
      const v = JSON.parse(localStorage.getItem(WATCH_KEY) || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch (e) {
      return [];
    }
  }

  function storageWorks() {
    try {
      localStorage.setItem(WATCH_KEY + ".test", "1");
      localStorage.removeItem(WATCH_KEY + ".test");
      return true;
    } catch (e) {
      return false;
    }
  }

  function setWatchlist(ids) {
    const unique = [...new Set(ids)];
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(unique));
      memoryWatch = null;
    } catch (e) {
      memoryWatch = unique;   // keep it for this page view at least
    }
    document.dispatchEvent(new CustomEvent("watchlistchange", { detail: unique }));
  }

  function isWatched(id) {
    return getWatchlist().includes(id);
  }

  function toggleWatch(id) {
    const list = getWatchlist();
    const on = !list.includes(id);
    setWatchlist(on ? [...list, id] : list.filter((x) => x !== id));
    return on;
  }

  function starButton(id, name) {
    const on = isWatched(id);
    return `<button type="button" class="star${on ? " on" : ""}" data-star="${escapeHtml(id)}" aria-pressed="${on}"
      title="${on ? "Remove from" : "Add to"} My seats" aria-label="${on ? "Remove" : "Add"} ${escapeHtml(name)} ${on ? "from" : "to"} My seats">${on ? "★" : "☆"}</button>`;
  }

  // One delegated handler for every star on the page.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-star]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    toggleWatch(btn.dataset.star);
  });
  document.addEventListener("watchlistchange", () => {
    document.querySelectorAll("[data-star]").forEach((btn) => {
      const on = isWatched(btn.dataset.star);
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", String(on));
      btn.textContent = on ? "★" : "☆";
      btn.title = `${on ? "Remove from" : "Add to"} My seats`;
    });
  });

  /* ---- Theme ---- */
  function currentTheme() {
    const set = document.documentElement.getAttribute("data-theme");
    if (set) return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function initTheme() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const label = () => {
      const dark = currentTheme() === "dark";
      btn.innerHTML = `<span aria-hidden="true">${dark ? "☀" : "☾"}</span><span class="theme-word"> ${dark ? "Light" : "Dark"}</span>`;
      btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      // The toolbar colour (theme-color) follows a theme picked here; otherwise the media queries decide.
      if (document.documentElement.hasAttribute("data-theme")) {
        document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = cssVar("--surface") || m.content; });
      }
    };
    label();
    btn.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) { /* storage unavailable */ }
      label();
      document.dispatchEvent(new CustomEvent("themechange"));
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      label();
      document.dispatchEvent(new CustomEvent("themechange"));
    });
  }

  /* ---- Key-dates strip (under the header on every page) ---- */
  function renderKeyDates(meta) {
    const kd = meta && meta.key_dates;
    const header = document.querySelector(".site-header");
    if (!kd || !header) return;
    // Pages carry an empty, height-reserved #key-dates so filling it doesn't push the page down.
    let strip = document.getElementById("key-dates");
    if (!strip) {
      strip = document.createElement("div");
      strip.className = "key-dates";
      strip.setAttribute("role", "region");
      strip.setAttribute("aria-label", "Key dates");
      header.after(strip);
    }

    const now = new Date();
    const today = melbourneToday(now);
    const items = (kd.countdowns || []).map((c) => {
      const date = c.at.slice(0, 10);
      const passed = now >= new Date(c.at);
      const days = daysBetween(today, date);
      let when;
      if (passed) when = c.after || "passed";
      else if (days <= 0) when = c.today || "today";
      else when = `${days} day${days === 1 ? "" : "s"}`;
      return `<li class="${passed ? "done" : ""}"><span class="kd-label">${escapeHtml(c.label)}</span>
        <span class="kd-when">${escapeHtml(when)}</span><span class="kd-date">${escapeHtml(fmtDate(date))}</span></li>`;
    }).join("");

    // What happens today: the narrowest event covering today, else the next one.
    // Today: the narrowest event covering today. Next: the next milestone (events marked "ongoing" are
    // stretches between milestones, e.g. counting, and never count as one).
    const events = (kd.events || []).map((e) => ({ ...e, to: e.to || e.from }));
    const current = events.filter((e) => e.from <= today && today <= e.to)
      .sort((a, b) => daysBetween(a.from, a.to) - daysBetween(b.from, b.to))[0];
    const milestones = events.filter((e) => !e.ongoing).sort((a, b) => a.from.localeCompare(b.from));
    const startsToday = milestones.find((e) => e.from === today);
    const next = milestones.find((e) => e.from > today);
    const dayMonth = (iso) => fmtDate(iso).replace(/ \d{4}$/, "");
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    const nextNote = next ? ` <strong>Next,</strong> ${escapeHtml(fmtDate(next.from))}: ${escapeHtml(next.text)}` : "";
    const note = (current ? `<strong>Today:</strong> ${escapeHtml(current.text)}` : "<strong>Today:</strong> no scheduled milestone.") + nextNote;
    // The phone line: "Today:" on a milestone's own day, otherwise what's next.
    const line = startsToday ? `<strong>Today:</strong> ${escapeHtml(cap(startsToday.short || startsToday.text))}`
      : next ? `<strong>Next:</strong> ${escapeHtml(dayMonth(next.from))}, ${escapeHtml(next.short || next.text)}`
      : current ? `<strong>Today:</strong> ${escapeHtml(cap(current.short || current.text))}`
      : "<strong>Today:</strong> no scheduled milestone.";
    // Phones show only the summary button; it opens the full strip (CSS hides one or the other).
    strip.innerHTML = `<div class="container">
      <button type="button" class="kd-summary" aria-expanded="false" aria-controls="kd-full"><span class="kd-line">${line}</span><span class="kd-caret" aria-hidden="true"></span></button>
      <div class="kd-full" id="kd-full"><ul class="kd-list">${items}</ul><p class="kd-today">${note}</p></div></div>`;
    const btn = strip.querySelector(".kd-summary");
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(open));
      strip.classList.toggle("kd-open", open);
    });
  }

  /* ---- Header search: districts, regions, candidates, localities, postcodes ---- */
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  let searchIndex = null;

  async function buildSearchIndex() {
    if (searchIndex) return searchIndex;
    const optional = (n) => loadJSON(n).catch(() => null);
    const [dd, rd, cd, ld] = await Promise.all([optional("districts"), optional("regions"), optional("candidates"), optional("localities")]);
    const districts = (dd && dd.districts) || [];
    const regions = (rd && rd.regions) || [];
    const dName = Object.fromEntries(districts.map((d) => [d.id, d.name]));
    const rName = Object.fromEntries(regions.map((r) => [r.id, r.name]));
    const items = [];
    districts.forEach((d) => items.push({ type: "District", label: d.name, sub: rName[d.region] || "", href: `lower.html#${d.id}`, key: norm(d.name), rank: 0 }));
    regions.forEach((r) => items.push({ type: "Region", label: r.name, sub: "Legislative Council region", href: `upper.html#${r.id}`, key: norm(r.name), rank: 0 }));
    buildPeople(cd, rd, dd).forEach((p) => {
      if (p.status === "withdrawn" && !p.mlc) return;
      items.push({ type: p.contesting ? "Candidate" : "MLC", label: p.name,
        sub: `${p.contesting ? "" : "MLC, "}${partyName(p.party)}, ${p.seatName}`, party: p.party,
        href: `candidate.html#${p.id}`, key: norm(p.name), rank: 2 });
    });
    const shareText = (s) => (s < 0.995 ? ` (${Math.round(s * 100)}% of area)` : "");
    ((ld && ld.localities) || []).forEach((l) => {
      l.d.forEach(([id, share]) => items.push({
        type: "Suburb", label: `${l.n}${l.p.length ? " " + l.p.join(", ") : ""}`, sub: `${dName[id] || id}${shareText(share)}`,
        href: `lower.html#${id}`, key: norm(l.n), postcodes: l.p, rank: 1, share,
      }));
    });
    ((ld && ld.postcodes) || []).forEach((p) => {
      p.d.forEach(([id, share]) => items.push({
        type: "Postcode", label: p.p, sub: `${dName[id] || id}${shareText(share)}`, href: `lower.html#${id}`,
        key: p.p, postcodes: [p.p], rank: 0, share,
      }));
    });
    searchIndex = items;
    return items;
  }

  function searchItems(items, query, limit) {
    const q = norm(query);
    if (!q) return [];
    const isPostcode = /^\d{3,4}$/.test(q);
    const scored = [];
    for (const it of items) {
      let score = null;
      if (isPostcode) {
        if (it.type === "Postcode" && it.key.startsWith(q)) score = it.key === q ? 0 : 3;
        else if (it.type === "Suburb" && it.postcodes.some((p) => p.startsWith(q))) score = it.postcodes.includes(q) ? 1 : 4;
      } else if (it.type !== "Postcode") {
        if (it.key === q) score = 0;
        else if (it.key.startsWith(q)) score = 1;
        else if (it.key.split(" ").some((w) => w.startsWith(q))) score = 2;
        else if (q.length >= 3 && it.key.includes(q)) score = 3;
      }
      if (score != null) scored.push({ it, score: score * 10 + it.rank - (it.share || 0) });
    }
    scored.sort((a, b) => a.score - b.score || a.it.label.localeCompare(b.it.label));
    // A postcode can cover a dozen or more suburbs; show them all.
    return scored.slice(0, limit || (isPostcode ? 24 : 12)).map((s) => s.it);
  }

  /* ---- Main navigation: four groups, dropdowns on desktop, a menu button on phones ---- */
  // The single source of the site's navigation; pages carry only a no-JS fallback.
  const NAV = [
    { label: "Overview", items: [["Home", "index.html"], ["Results", "results.html"], ["Map", "index.html#state-map"], ["Pendulum", "pendulum.html"],
      ["Scenarios", "pendulum.html#scenarios"], ["Timeline", "timeline.html"]] },
    { label: "Lower house", items: [["Seats", "lower.html"], ["Candidates", "candidate.html"], ["My seats", "myseats.html"]] },
    { label: "Upper house", items: [["Regions", "upper.html"], ["Quota calculator", "upper.html#quota"]] },
    { label: "About", items: [["Methodology", "about.html"], ["Data", "data/"], ["Polls", "poll.html"], ["Policies", "policies.html"]] },
  ];

  function initNav() {
    const nav = document.querySelector(".site-header .nav");
    if (!nav) return;
    // The current page relative to the site root ("lower.html", "data/", "" for the home page).
    const page = decodeURIComponent(location.pathname).slice(decodeURIComponent(ROOT.pathname).length)
      .replace(/(^|\/)index\.html$/, "$1") || "index.html";
    const isHere = (href) => !href.includes("#") && (href === page || (href === "index.html" && page === ""));
    nav.id = "main-nav";
    nav.innerHTML = NAV.map((g, i) => {
      const current = g.items.some(([, href]) => href.split("#")[0] === page || (page === "" && href.startsWith("index.html")));
      return `<div class="nav-group${current ? " is-current" : ""}">
          <button type="button" class="nav-top" aria-expanded="false" aria-controls="nav-menu-${i}">${escapeHtml(g.label)}<span class="nav-caret" aria-hidden="true"></span></button>
          <ul class="nav-menu" id="nav-menu-${i}">${g.items.map(([label, href]) =>
            `<li><a href="${new URL(href, ROOT).href}"${isHere(href) ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a></li>`).join("")}</ul>
        </div>`;
    }).join("");

    initResultsNav(nav, page);

    let toggle = nav.parentNode.querySelector(".nav-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "icon-btn nav-toggle";
      toggle.setAttribute("aria-controls", "main-nav");
      toggle.setAttribute("aria-expanded", "false");
      toggle.innerHTML = '<span class="nav-burger" aria-hidden="true"></span>Menu';
      nav.parentNode.insertBefore(toggle, nav);
    }

    const groups = [...nav.querySelectorAll(".nav-group")];
    const closeAll = (except) => groups.forEach((g) => {
      if (g === except) return;
      g.classList.remove("open");
      g.querySelector(".nav-top").setAttribute("aria-expanded", "false");
    });
    const header = nav.closest(".site-header");
    const setMenu = (open) => {
      if (open && header) {
        document.documentElement.style.setProperty("--nav-top", `${Math.max(0, Math.round(header.getBoundingClientRect().bottom))}px`);
      }
      nav.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      document.documentElement.classList.toggle("nav-open", open);   // CSS locks the page's scroll while open
    };
    groups.forEach((g) => {
      const btn = g.querySelector(".nav-top");
      btn.addEventListener("click", () => {
        const open = !g.classList.contains("open");
        closeAll(g);
        g.classList.toggle("open", open);
        btn.setAttribute("aria-expanded", String(open));
        if (open) g.querySelector("a").focus({ preventScroll: true });
      });
    });
    toggle.addEventListener("click", () => setMenu(!nav.classList.contains("open")));
    document.addEventListener("click", (e) => {
      if (!nav.contains(e.target)) closeAll();
      if (!nav.contains(e.target) && !toggle.contains(e.target)) setMenu(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const open = groups.find((g) => g.classList.contains("open"));
      if (open) { closeAll(); open.querySelector(".nav-top").focus(); }
      if (nav.classList.contains("open")) { setMenu(false); toggle.focus(); }
    });
    // Following a same-page link (Map, Scenarios, Quota calculator) closes the menus.
    nav.addEventListener("click", (e) => { if (e.target.closest("a, .nav-install-btn")) { closeAll(); setMenu(false); } });
    initInstall(nav);
  }

  // "Results" stays out of the menu until results.json has votes in it (scripts/results.py, from 6 pm on 28 Nov),
  // except on the results page itself. Checked after the first paint, so it costs the page nothing.
  function initResultsNav(nav, page) {
    const link = [...nav.querySelectorAll("a")].find((a) => /results\.html$/.test(a.getAttribute("href") || ""));
    if (!link || page === "results.html") return;
    const li = link.closest("li");
    li.hidden = true;
    afterPaint(() => loadJSON("results")).then((r) => {
      if (Object.values((r && r.districts) || {}).some((d) => d.total)) li.hidden = false;
    }, () => {});
  }

  /* ---- App: the service worker (sw.js), its update toast, and "Install app" in the menu ---- */
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let installPrompt = null;   // Android and desktop Chromium: the deferred beforeinstallprompt event
  const installListeners = [];
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    installListeners.forEach((fn) => fn());
  });

  // The last menu group (About) gets "Install app" where the browser can install the site (it fired
  // beforeinstallprompt) and on iPhone/iPad, where it opens instructions instead. Hidden once installed.
  function initInstall(nav) {
    const menu = nav.querySelector(".nav-group:last-child .nav-menu");
    if (!menu) return;
    const li = document.createElement("li");
    li.className = "nav-install";
    li.innerHTML = '<button type="button" class="nav-install-btn">Install app</button>';
    menu.append(li);
    const update = () => { li.hidden = isStandalone() || !(installPrompt || isIOS()); };
    update();
    installListeners.push(update);
    window.addEventListener("appinstalled", () => { installPrompt = null; li.hidden = true; });
    li.querySelector("button").addEventListener("click", async () => {
      if (installPrompt) {
        const prompt = installPrompt;
        installPrompt = null;
        prompt.prompt();
        try { await prompt.userChoice; } catch (e) { /* dismissed */ }
        update();
      } else if (isIOS()) {
        showIosInstall();
      }
    });
  }

  function showIosInstall() {
    let sheet = document.getElementById("ios-install");
    if (!sheet) {
      sheet = document.createElement("dialog");
      sheet.id = "ios-install";
      sheet.className = "ios-sheet";
      sheet.setAttribute("aria-labelledby", "ios-install-title");
      sheet.innerHTML = `<h2 id="ios-install-title">Add to your Home Screen</h2>
        <ol>
          <li>Tap the <b>Share</b> button <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" class="ios-share-icon"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> in Safari's toolbar.</li>
          <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
          <li>Tap <b>Add</b>. The tracker then opens from your Home Screen like an app.</li>
        </ol>
        <form method="dialog"><button type="submit" class="icon-btn">Got it</button></form>`;
      sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });   // a tap on the backdrop
      document.body.append(sheet);
    }
    if (sheet.showModal) sheet.showModal(); else sheet.setAttribute("open", "");
  }

  function showUpdateToast(onTap, text = "Update available, tap to refresh") {
    if (document.querySelector(".sw-toast")) return;
    const wrap = document.createElement("div");
    wrap.className = "sw-toast";
    wrap.setAttribute("role", "status");
    wrap.innerHTML = `<button type="button">${escapeHtml(text)}</button>`;
    const btn = wrap.querySelector("button");
    btn.addEventListener("click", () => { btn.disabled = true; btn.textContent = "Updating…"; onTap(); });
    document.body.append(wrap);
  }

  // A page left open (or an app sent to the background) comes back to a refresh that happened meanwhile:
  // after 5 minutes away, check meta.json and offer a reload if the data is newer than what's shown.
  let shownUpdate = null;   // meta.last_updated as rendered in the footer
  function watchForNewData() {
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      if (!shownUpdate || Date.now() - hiddenAt < 5 * 60 * 1000) return;
      fetch(new URL("data/meta.json", ROOT), { cache: "no-cache" }).then((r) => r.json()).then((m) => {
        if (m.last_updated && m.last_updated > shownUpdate) showUpdateToast(() => location.reload(), "New data available, tap to refresh");
      }).catch(() => {});
    });
  }

  // Registered after the page has loaded, so precaching never competes with the first paint.
  function initServiceWorker() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    let reloadOnChange = false;   // only after "tap to refresh", never on the first install
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadOnChange) { reloadOnChange = false; location.reload(); }
    });
    const register = () => navigator.serviceWorker.register(new URL("sw.js", ROOT)).then((reg) => {
      const offer = (worker) => showUpdateToast(() => { reloadOnChange = true; worker.postMessage({ type: "SKIP_WAITING" }); });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
        });
      });
      // An installed app can stay open for days: look for a new version whenever it comes back.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
      watchForNewData();
    }).catch((err) => console.warn("Service worker not registered:", err));
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }

  const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  // Result groups, in the order the dropdown shows them, with how many of each to show.
  const SEARCH_GROUPS = [
    { name: "Seats", types: ["District", "Region"], max: 6 },
    { name: "Candidates", types: ["Candidate", "MLC"], max: 8 },
    { name: "Suburbs", types: ["Suburb"], max: 8 },
    { name: "Postcodes", types: ["Postcode"], max: 8 },
  ];

  // The search box: in the home page's headline card (#hero-search), elsewhere in the header. On the home page
  // the header keeps a compact button that brings the same box into view and focuses it.
  function initSearch() {
    const header = document.querySelector(".site-header .container");
    if (!header) return;
    const heroSlot = document.getElementById("hero-search");
    const headSlot = header.querySelector(".search");
    let wrap = heroSlot;
    if (!wrap) {
      wrap = headSlot || document.createElement("div");
      if (!headSlot) header.insertBefore(wrap, document.getElementById("theme-toggle"));
    }
    wrap.classList.add("search");
    wrap.setAttribute("role", "search");
    wrap.innerHTML = `
      <label class="sr-only" for="site-search">Search a seat, candidate, suburb or postcode</label>
      <span class="search-icon">${SEARCH_ICON}</span>
      <input id="site-search" type="search" autocomplete="off" spellcheck="false" enterkeyhint="go"
        placeholder="Search a seat, candidate, suburb or postcode"
        role="combobox" aria-expanded="false" aria-controls="site-search-results" aria-autocomplete="list">
      <kbd class="search-kbd" aria-hidden="true" title="Press / to search">/</kbd>
      <button type="button" class="search-clear" aria-label="Clear search" hidden><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      <ul id="site-search-results" class="search-results" role="listbox" aria-label="Search results" hidden></ul>`;

    const input = wrap.querySelector("input");
    const list = wrap.querySelector("ul");
    const clear = wrap.querySelector(".search-clear");
    let results = [];
    let active = -1;

    const focusSearch = () => {
      if (heroSlot) {
        const r = wrap.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight) wrap.scrollIntoView({ block: "center" });
      }
      input.focus({ preventScroll: !!heroSlot });
      input.select();
    };
    if (heroSlot && headSlot) {   // home page: the header's compact button opens the hero's search
      headSlot.classList.add("search-compact");
      headSlot.innerHTML = `<button type="button" class="icon-btn search-open" aria-label="Search a seat, candidate, suburb or postcode" aria-controls="site-search">${SEARCH_ICON}</button>`;
      headSlot.querySelector("button").addEventListener("click", focusSearch);
    }

    const setText = (has) => { clear.hidden = !has; wrap.classList.toggle("has-text", has); };
    const close = () => {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    };
    const go = (it) => {
      if (!it) return;
      close();
      input.value = "";
      setText(false);
      input.blur();
      location.href = new URL(it.href, ROOT).href;
    };
    const option = (it, i) => {
      const dot = it.party ? `<span class="sr-dot" style="background:var(${partyVar(it.party)})" title="${escapeHtml(partyName(it.party))}"></span>` : "";
      return `<li id="sr-${i}" role="option" aria-selected="${i === active}" class="${i === active ? "active" : ""}" data-i="${i}">
          <span class="sr-label">${dot}${escapeHtml(it.label)}</span>
          <span class="sr-sub">${escapeHtml(it.sub)}</span>
        </li>`;
    };
    const paint = () => {
      if (!results.length) {
        list.innerHTML = '<li class="sr-empty" role="option" aria-disabled="true">No matches</li>';
      } else {
        let i = 0;
        list.innerHTML = SEARCH_GROUPS.map((g) => {
          const items = results.filter((it) => g.types.includes(it.type));
          if (!items.length) return "";
          return `<li class="sr-group" role="presentation">${g.name}</li>` + items.map((it) => option(it, i++)).join("");
        }).join("");
      }
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      if (active >= 0) {
        input.setAttribute("aria-activedescendant", `sr-${active}`);
        const li = list.querySelector(`#sr-${active}`);
        if (li) li.scrollIntoView({ block: "nearest" });
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    };
    // The scored matches, grouped (Seats, Candidates, Suburbs, Postcodes) so the arrow keys follow the list's order.
    const grouped = (matches) => SEARCH_GROUPS.flatMap((g) => matches.filter((it) => g.types.includes(it.type)).slice(0, g.max));

    input.addEventListener("focus", () => { buildSearchIndex(); }, { once: true });
    input.addEventListener("input", async () => {
      const q = input.value;
      setText(!!q);
      if (!q.trim()) { close(); return; }
      const items = await buildSearchIndex();
      if (input.value !== q) return;   // a newer keystroke is in flight
      results = grouped(searchItems(items, q, 60));
      active = results.length ? 0 : -1;
      paint();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!list.hidden) close();
        else if (input.value) { input.value = ""; setText(false); }
        else input.blur();
        return;
      }
      if (list.hidden) {
        if (e.key === "ArrowDown" && input.value.trim()) { e.preventDefault(); input.dispatchEvent(new Event("input")); }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!results.length) return;
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
        paint();
      } else if (e.key === "Enter") {
        e.preventDefault();
        go(results[active] || results[0]);
      }
    });
    clear.addEventListener("click", () => {
      input.value = "";
      setText(false);
      close();
      input.focus();
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[data-i]");
      if (li) { e.preventDefault(); go(results[Number(li.dataset.i)]); }
    });
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) close(); });
    // "/" anywhere outside a text field focuses the search.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      focusSearch();
    });
  }

  /* ---- Footer + sample banner ---- */
  function renderChrome(meta) {
    const footer = document.getElementById("last-updated");
    if (footer) {
      if (meta && meta.last_updated) {
        footer.innerHTML = `<time datetime="${escapeHtml(meta.last_updated)}">${escapeHtml(dataUpdatedText(meta.last_updated))}</time>`;
        shownUpdate = meta.last_updated;
      } else {
        footer.textContent = "Data last updated: unknown";
      }
      const rec = meta && meta.reconciliation;
      if (rec && rec.date) {
        const p = document.createElement("p");
        const total = rec.tracked_all ?? (rec.totals && rec.totals.tracker);
        p.textContent = `${Number(total).toLocaleString("en-AU")} candidates tracked, last reconciled ${fmtDate(rec.date)}`;
        p.title = `Lower house: ${rec.totals.tracker} in the tracker, ${rec.totals.abc_list} on the ABC list; ` +
          `${rec.only_in_tracker} only in the tracker, ${rec.only_on_abc} only on the ABC list`;
        footer.after(p);
      }
    }

    const banner = document.getElementById("sample-banner");
    if (banner && meta && meta.sample_data) {
      const sample = Object.keys(meta.sample_data).filter((k) => meta.sample_data[k]);
      if (sample.length) {
        banner.textContent = `Sample data: ${sample.join(", ")} currently contain placeholder rows, not real information.`;
        banner.hidden = false;
      }
    }
    renderKeyDates(meta);
  }

  function showError(el, err) {
    console.error(err);
    if (el) el.innerHTML = `<p class="empty">Couldn't load data (${escapeHtml(err.message)}). If you opened the file directly, serve the folder over HTTP instead.</p>`;
  }

  async function copyLink(btn) {
    try {
      await navigator.clipboard.writeText(location.href);
      const old = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = old; }, 1500);
    } catch (e) {
      window.prompt("Copy this link:", location.href);
    }
  }

  /* ---- "Download CSV" under every table (tables in map popups excepted) ---- */
  // textContent, not innerText: innerText applies CSS (uppercase headers) and is empty inside closed <details>.
  function csvCell(cell) {
    const field = cell.querySelector("input, select");
    const raw = cell.dataset.csv != null ? cell.dataset.csv : field ? field.value : cell.textContent;   // data-csv: explicit value
    const text = raw.replace(/\s+/g, " ").trim();
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function tableToCsv(table) {
    // Drop control columns (the My seats star) from every row, header included.
    const first = table.tBodies[0] && table.tBodies[0].rows[0];
    const skip = new Set(first ? [...first.cells].map((c, i) => (c.classList.contains("star-cell") ? i : -1)).filter((i) => i >= 0) : []);
    return [...table.rows].map((row) => [...row.cells].filter((c, i) => !skip.has(i)).map(csvCell).join(",")).join("\r\n");
  }

  // Named after the nearest heading above the table, e.g. "sydenham-voting-centres-2026-10-31.csv".
  function csvFilename(table) {
    let heading = null;
    for (let el = table.closest(".table-scroll, details") || table; el && !heading; el = el.parentElement) {
      for (let sib = el.previousElementSibling; sib && !heading; sib = sib.previousElementSibling) {
        heading = /^H[1-4]$/.test(sib.tagName) ? sib : [...sib.querySelectorAll("h1, h2, h3, h4")].pop() || null;
      }
      if (el.matches && el.matches("main")) break;
    }
    const base = slugify((heading && heading.textContent) || "table");
    const page = slugify(document.title.split("·")[0]);
    return `${page && !base.startsWith(page) ? `${page}-` : ""}${base}-${melbourneToday()}.csv`;
  }

  function addCsvButtons() {
    document.querySelectorAll("main table:not([data-csv])").forEach((table) => {
      table.dataset.csv = "1";
      if (table.closest(".leaflet-container") || table.dataset.noCsv != null) return;
      const bar = document.createElement("div");
      bar.className = "csv-bar";
      bar.innerHTML = '<button type="button" class="icon-btn csv-btn">Download CSV</button>';
      bar.querySelector("button").addEventListener("click", () => {
        // The byte-order mark makes Excel read the file as UTF-8.
        const blob = new Blob(["﻿" + tableToCsv(table)], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = csvFilename(table);
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      (table.closest(".table-scroll") || table).insertAdjacentElement("afterend", bar);
    });
  }

  let csvQueued = false;
  new MutationObserver(() => {
    if (csvQueued) return;
    csvQueued = true;
    setTimeout(() => { csvQueued = false; addCsvButtons(); }, 50);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Libraries a page only needs after its first paint (maps, share images), loaded on demand from
  // cdnjs with SRI, once per page. Keeping them off the critical path lets the content paint first.
  const LIBS = {
    leaflet: {
      css: ["https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css", "sha384-c6Rcwz4e4CITMbu/NBmnNS8yN2sC3cUElMEMfP3vqqKFp7GOYaaBBCqmaWBjmkjb"],
      js: ["https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js", "sha384-NElt3Op+9NBMCYaef5HxeJmU4Xeard/Lku8ek6hoPTvYkQPh3zLIrJP7KiRocsxO"],
    },
    chart: {   // Chart.js: the home page's poll-of-polls chart (poll.html still loads it with a script tag)
      js: ["https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js", "sha384-bs/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW+S3zjqSKR5ZEaD"],
    },
    htmlToImage: {
      js: ["https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js", "sha512-7tWCgq9tTYS/QkGVyKrtLpqAoMV9XIUxoou+sPUypsaZx56cYR/qio84fPK9EvJJtKvJEwt7vkn6je5UVzGevw=="],
    },
  };
  const libs = {};
  function loadLib(name) {
    if (!libs[name]) {
      const add = (tag, props) => new Promise((resolve, reject) => {
        const el = Object.assign(document.createElement(tag), props, { crossOrigin: "anonymous", referrerPolicy: "no-referrer" });
        el.onload = resolve;
        el.onerror = () => reject(new Error(`The ${name} library failed to load`));
        document.head.append(el);
      });
      const { css, js } = LIBS[name];
      libs[name] = Promise.all([
        css && add("link", { rel: "stylesheet", href: css[0], integrity: css[1] }),
        add("script", { src: js[0], integrity: js[1] }),
      ]).catch((err) => { delete libs[name]; throw err; });
    }
    return libs[name];
  }

  // Runs fn once the browser has painted what's on the page now and its web fonts have arrived
  // (for work that can wait: fetching it any sooner would hold up the fonts).
  function afterPaint(fn) {
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      .then(() => document.fonts && document.fonts.ready)
      .then(() => fn && fn());
  }

  function start() {
    initServiceWorker();
    initTheme();
    initNav();
    initSearch();
    loadJSON("meta").then(renderChrome).catch((err) => {
      console.error(err);
      renderChrome(null);
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    // Chart.js loads after this file, so its defaults are set once every deferred script has run.
    if (window.Chart) {
      Chart.defaults.font.family = cssVar("--font-body") || "system-ui, sans-serif";
    }
  });

  window.App = {
    PARTIES, STATUSES, COALITION, loadJSON, escapeHtml, partyName, partyShort, partyVar, partyColor, partyBadge, statusBadge,
    slugify, parseDate, fmtDate, fmtMonth, fmtDateTime, dataUpdatedText, fmtPrice, fmtMargin, fmtSwing, melbourneToday, daysBetween,
    hashId, cssVar, currentTheme, showError, copyLink,
    DAY, preparePolls, smoothedSeries, pollRecords, statewideSwing, swingAdjusted, projectSeats, BLOCS, blocOf, modelLink, quotaBars,
    getWatchlist, setWatchlist, isWatched, toggleWatch, starButton, storageWorks,
    buildSearchIndex, searchItems,
    candidateId, givenFirst, loadHeadshots, avatar, photoCredits, initials, inkFor, inkVar, newsList,
    ROOT, tableToCsv, loadLib, afterPaint,
    profileHref, profileLink, isPlaceholder, buildPeople, loadPeople, ballotPaper,
  };

  // Scripts are deferred and this one loads first, so the page is already parsed: build the header,
  // search and key-dates strip now instead of waiting for the chart and map libraries to download.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
