/* Shared helpers for every page: data loading, theme, party/status badges, footer. */
(function () {
  "use strict";

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
    ND: { name: "New Democrats", color: "--p-nd" },
    WEST: { name: "West Party", color: "--p-west" },
    SAL: { name: "Socialist Alliance", color: "--p-sal" },
    LBT: { name: "Libertarian", color: "--p-lbt" },
    FF: { name: "Family First", color: "--p-ff" },
    SFF: { name: "Shooters, Fishers and Farmers", color: "--p-sff" },
    DLP: { name: "Democratic Labour", color: "--p-dlp" },
    SUS: { name: "Sustainable Australia", color: "--p-sus" },
    ILAB: { name: "Independent Labor", color: "--p-ilab" },
    IND: { name: "Independent", color: "--p-ind" },
    OTH: { name: "Other", color: "--p-oth" },
  };

  // Short labels where the code alone would mislead (LNP is a Queensland party).
  const SHORT = { LNP: "L/NP", ILAB: "Ind. Labor" };

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

  function parseDate(iso) {
    // Date-only strings are treated as local midnight so they don't shift a day.
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, d] = iso.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date(iso);
  }

  function fmtDate(iso, opts = { day: "numeric", month: "short", year: "numeric" }) {
    if (!iso) return "";
    return parseDate(iso).toLocaleDateString("en-AU", opts);
  }

  function hashId() {
    return decodeURIComponent(location.hash.replace(/^#/, "")).trim().toLowerCase();
  }

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

  /* ---- Footer + sample banner ---- */
  function renderChrome(meta) {
    const footer = document.getElementById("last-updated");
    if (footer) {
      if (meta && meta.last_updated) {
        const d = new Date(meta.last_updated);
        const text = d.toLocaleString("en-AU", {
          timeZone: "Australia/Melbourne", day: "numeric", month: "short", year: "numeric",
          hour: "numeric", minute: "2-digit", timeZoneName: "short",
        });
        footer.innerHTML = `Data last updated <time datetime="${escapeHtml(meta.last_updated)}">${escapeHtml(text)}</time>`;
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
    loadJSON("meta").then(renderChrome).catch((err) => {
      console.error(err);
      renderChrome(null);
    });
  });

  window.App = {
    PARTIES, STATUSES, loadJSON, escapeHtml, partyName, partyShort, partyVar, partyColor, partyBadge, statusBadge,
    slugify, parseDate, fmtDate, hashId, cssVar, currentTheme, showError, copyLink,
  };
})();
