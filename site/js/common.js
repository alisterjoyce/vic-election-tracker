/* Shared helpers for every page: data loading, theme, formats, party palette,
   header chrome (search, key-dates strip), watchlist, poll smoothing, seat-outlook maths, footer.
   Conventions (palette, formats, copyright) are documented in CLAUDE.md. */
(function () {
  "use strict";

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
      cache[name] = fetch(`data/${name}.json`, { cache: "no-cache" }).then((r) => {
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
    const strip = document.createElement("div");
    strip.className = "key-dates";
    strip.setAttribute("role", "region");
    strip.setAttribute("aria-label", "Key dates");

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
    let note;
    if (current) {
      note = `<strong>Today:</strong> ${escapeHtml(current.text)}`;
    } else {
      const next = events.filter((e) => e.from > today).sort((a, b) => a.from.localeCompare(b.from))[0];
      note = next
        ? `<strong>Today:</strong> no scheduled milestone. Next, ${escapeHtml(fmtDate(next.from))}: ${escapeHtml(next.text)}`
        : "<strong>Today:</strong> no scheduled milestone.";
    }
    strip.innerHTML = `<div class="container"><ul class="kd-list">${items}</ul><p class="kd-today">${note}</p></div>`;
    header.after(strip);
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
    ((cd && cd.candidates) || []).forEach((c) => {
      if (c.status === "superseded" || c.status === "withdrawn") return;
      const where = c.district ? dName[c.district] : rName[c.region];
      if (!where) return;
      items.push({ type: "Candidate", label: c.name, sub: `${partyName(c.party)}, ${where}`,
        href: c.district ? `lower.html#${c.district}` : `upper.html#${c.region}`, key: norm(c.name), rank: 2 });
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

  function initSearch() {
    const header = document.querySelector(".site-header .container");
    if (!header) return;
    const wrap = document.createElement("div");
    wrap.className = "search";
    wrap.innerHTML = `
      <label class="sr-only" for="site-search">Search districts, regions, candidates, suburbs or postcodes</label>
      <input id="site-search" type="search" autocomplete="off" spellcheck="false"
        placeholder="Seat, candidate, suburb, postcode"
        role="combobox" aria-expanded="false" aria-controls="site-search-results" aria-autocomplete="list">
      <ul id="site-search-results" class="search-results" role="listbox" hidden></ul>`;
    const toggle = document.getElementById("theme-toggle");
    header.insertBefore(wrap, toggle || null);

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
      location.href = it.href;
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

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initSearch();
    if (window.Chart) {
      Chart.defaults.font.family = cssVar("--font-body") || "system-ui, sans-serif";
    }
    loadJSON("meta").then(renderChrome).catch((err) => {
      console.error(err);
      renderChrome(null);
    });
  });

  window.App = {
    PARTIES, STATUSES, COALITION, loadJSON, escapeHtml, partyName, partyShort, partyVar, partyColor, partyBadge, statusBadge,
    slugify, parseDate, fmtDate, fmtMonth, fmtDateTime, fmtPrice, fmtMargin, fmtSwing, melbourneToday, daysBetween,
    hashId, cssVar, currentTheme, showError, copyLink,
    DAY, preparePolls, smoothedSeries, statewideSwing, swingAdjusted,
    getWatchlist, setWatchlist, isWatched, toggleWatch, starButton, storageWorks,
    buildSearchIndex, searchItems,
  };
})();
