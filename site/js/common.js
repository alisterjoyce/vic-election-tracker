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

  // "30 Oct 2026, 1:18 pm AEDT" in Melbourne time.
  function fmtDateTime(iso) {
    const p = melbourneParts(new Date(iso));
    return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} ${(p.dayPeriod || "").toLowerCase()} ${p.timeZoneName || ""}`.trim();
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

  // Black or white text, whichever reads better on the party colour.
  function inkFor(code) {
    const m = (partyColor(code) || "").match(/^#?([0-9a-f]{6})$/i);
    if (!m) return "#fff";
    const n = parseInt(m[1], 16);
    const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return lum > 0.5 ? "#111" : "#fff";
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
    return `<span class="avatar avatar-initials" aria-hidden="true" style="${style};font-size:${Math.round(size * 0.38)}px;background:var(${partyVar(party)});color:${inkFor(party)}">${escapeHtml(initials(name))}</span>`;
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
      if (c.status === "superseded") return;
      const seat = c.district || c.region;
      if (!districts[seat] && !regions[seat]) return;
      add(seat, c.name, { party: c.party, status: c.status, ticket_position: c.ticket_position, incumbent: c.incumbent || null,
        source: c.source, source_url: c.source_url, notes: c.notes || null, date_added: c.date_added, updated: c.updated, contesting: true,
        website: c.website, ballot_position: c.ballot_position });
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
      btn.textContent = dark ? "☀ Light" : "☾ Dark";
      btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
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
    const events = (kd.events || []).map((e) => ({ ...e, to: e.to || e.from }));
    const current = events.filter((e) => e.from <= today && today <= e.to)
      .sort((a, b) => daysBetween(a.from, a.to) - daysBetween(b.from, b.to))[0];
    let note, line;
    const next = events.filter((e) => e.from > today).sort((a, b) => a.from.localeCompare(b.from))[0];
    const dayMonth = (iso) => fmtDate(iso).replace(/ \d{4}$/, "");
    if (current) {
      note = `<strong>Today:</strong> ${escapeHtml(current.text)}`;
      const short = current.short ? current.short[0].toUpperCase() + current.short.slice(1) : current.text;
      line = `<strong>Today:</strong> ${escapeHtml(short)}`;
    } else if (next) {
      note = `<strong>Today:</strong> no scheduled milestone. Next, ${escapeHtml(fmtDate(next.from))}: ${escapeHtml(next.text)}`;
      line = `<strong>Next:</strong> ${escapeHtml(dayMonth(next.from))}, ${escapeHtml(next.short || next.text)}`;
    } else {
      note = line = "<strong>Today:</strong> no scheduled milestone.";
    }
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
    regions.forEach((r) => items.push({ type: "Region", label: r.name, sub: "Legislative Council", href: `upper.html#${r.id}`, key: norm(r.name), rank: 0 }));
    buildPeople(cd, rd, dd).forEach((p) => {
      if (p.status === "withdrawn" && !p.mlc) return;
      items.push({ type: p.contesting ? "Candidate" : "MLC", label: p.name, sub: `${partyName(p.party)}, ${p.seatName}`,
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

  function searchItems(items, query) {
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
    return scored.slice(0, isPostcode ? 24 : 12).map((s) => s.it);
  }

  /* ---- Main navigation: four groups, dropdowns on desktop, a menu button on phones ---- */
  // The single source of the site's navigation; pages carry only a no-JS fallback.
  const NAV = [
    { label: "Overview", items: [["Home", "index.html"], ["Map", "index.html#state-map"], ["Pendulum", "pendulum.html"],
      ["Scenarios", "pendulum.html#scenarios"], ["Timeline", "timeline.html"]] },
    { label: "Lower house", items: [["Seats", "lower.html"], ["Candidates", "candidate.html"], ["My seats", "myseats.html"]] },
    { label: "Upper house", items: [["Regions", "upper.html"], ["Quota calculator", "upper.html#quota"]] },
    { label: "About", items: [["Methodology", "about.html"], ["Data", "data/"], ["Polls", "poll.html"]] },
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
    nav.addEventListener("click", (e) => { if (e.target.closest("a")) { closeAll(); setMenu(false); } });
  }

  function initSearch() {
    const header = document.querySelector(".site-header .container");
    if (!header) return;
    const slot = header.querySelector(".search");
    const wrap = slot || document.createElement("div");
    wrap.className = "search";
    wrap.innerHTML = `
      <label class="sr-only" for="site-search">Search districts, regions, candidates, suburbs or postcodes</label>
      <input id="site-search" type="search" autocomplete="off" spellcheck="false"
        placeholder="Seat, candidate, suburb, postcode"
        role="combobox" aria-expanded="false" aria-controls="site-search-results" aria-autocomplete="list">
      <ul id="site-search-results" class="search-results" role="listbox" hidden></ul>`;
    if (!slot) header.insertBefore(wrap, document.getElementById("theme-toggle"));

    const input = wrap.querySelector("input");
    const list = wrap.querySelector("ul");
    let results = [];
    let active = -1;

    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
    const go = (it) => {
      if (!it) return;
      close();
      input.value = "";
      input.blur();
      location.href = new URL(it.href, ROOT).href;
    };
    const paint = () => {
      list.innerHTML = results.length ? results.map((it, i) => `
        <li id="sr-${i}" role="option" aria-selected="${i === active}" class="${i === active ? "active" : ""}" data-i="${i}">
          <span class="sr-type">${escapeHtml(it.type)}</span>
          <span class="sr-label">${escapeHtml(it.label)}</span>
          <span class="sr-sub">${escapeHtml(it.sub)}</span>
        </li>`).join("") : '<li class="sr-empty" role="option" aria-disabled="true">No matches</li>';
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      if (active >= 0) input.setAttribute("aria-activedescendant", `sr-${active}`);
      else input.removeAttribute("aria-activedescendant");
    };

    input.addEventListener("focus", () => { buildSearchIndex(); }, { once: true });
    input.addEventListener("input", async () => {
      const q = input.value;
      if (!q.trim()) { close(); return; }
      const items = await buildSearchIndex();
      if (input.value !== q) return;   // a newer keystroke is in flight
      results = searchItems(items, q);
      active = results.length ? 0 : -1;
      paint();
    });
    input.addEventListener("keydown", (e) => {
      if (list.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!results.length) return;
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
        paint();
      } else if (e.key === "Enter") {
        e.preventDefault();
        go(results[active] || results[0]);
      } else if (e.key === "Escape") {
        close();
      }
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[data-i]");
      if (li) { e.preventDefault(); go(results[Number(li.dataset.i)]); }
    });
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) close(); });
  }

  /* ---- Footer + sample banner ---- */
  function renderChrome(meta) {
    const footer = document.getElementById("last-updated");
    if (footer) {
      if (meta && meta.last_updated) {
        footer.innerHTML = `Data last updated <time datetime="${escapeHtml(meta.last_updated)}">${escapeHtml(fmtDateTime(meta.last_updated))}</time>`;
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
    slugify, parseDate, fmtDate, fmtMonth, fmtDateTime, fmtPrice, fmtMargin, fmtSwing, melbourneToday, daysBetween,
    hashId, cssVar, currentTheme, showError, copyLink,
    DAY, preparePolls, smoothedSeries, statewideSwing, swingAdjusted, projectSeats, BLOCS, blocOf,
    getWatchlist, setWatchlist, isWatched, toggleWatch, starButton, storageWorks,
    buildSearchIndex, searchItems,
    candidateId, givenFirst, loadHeadshots, avatar, photoCredits, initials, inkFor, newsList,
    ROOT, tableToCsv, loadLib, afterPaint,
    profileHref, profileLink, isPlaceholder, buildPeople, loadPeople,
  };

  // Scripts are deferred and this one loads first, so the page is already parsed: build the header,
  // search and key-dates strip now instead of waiting for the chart and map libraries to download.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
