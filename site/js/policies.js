/* Policies page: a party-by-issue matrix from data/policies.json, which scripts/refresh.py copies each run from
   Australian Election Tracker (OZE)'s open data (policies.json and issues.json, CC BY 4.0). The headlines,
   claim statements and issue summaries are theirs; their caveat is shown as they ask. A ledger of published
   claims, not a rating. Shareable: policies.html#<issue>/<party>. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, fmtDate } = App;
  const $ = (id) => document.getElementById(id);
  const CODES = { greens: "GRN", labor: "ALP", liberal: "LIB", nationals: "NAT", "one-nation": "ONP", coalition: "LNP" };
  const KINDS = { pledge: "Pledge", position: "Position", costed_measure: "Costed measure", opposition_to: "Opposes" };
  const PBO = { pbo_costed: "Costed by the Parliamentary Budget Office", uncosted: "No independent costing cited" };
  const FINANCING = { taxpayer: "funded by the taxpayer", borrowing: "funded by borrowing", mixed: "mixed funding" };
  let doc, view = "combined";
  const records = new Map();   // "party|issue" -> record

  const code = (slug) => CODES[slug] || "OTH";
  const swatch = (slug) => `style="--party-color: var(${App.partyVar(code(slug))})"`;
  const issueOf = (slug) => doc.issues.find((i) => i.slug === slug);
  const coalition = () => (doc.coalitions || [])[0];
  const columns = () => (view === "combined" && doc.combined_parties.length ? doc.combined_parties : doc.parties);
  const label = (slug) => ([...doc.parties, ...doc.combined_parties].find((p) => p.slug === slug) || {}).label || slug;

  // The records behind one cell. In the combined view the Coalition column follows electiontracker.au's
  // coalition table: a shared policy shows the representative party's record; "mixed" adds the other party's
  // own record; "party_specific" shows each party's record, labelled.
  function cell(party, issue) {
    const c = coalition();
    if (party !== "coalition" || !c) {
      const r = records.get(`${party}|${issue}`);
      return { parts: r ? [{ party, record: r }] : [] };
    }
    const rule = (c.issues || []).find((i) => i.issue === issue) || {};
    const own = c.parties.map((p) => ({ party: p, record: records.get(`${p}|${issue}`) })).filter((x) => x.record);
    if (rule.scope === "coalition_shared" || rule.scope === "mixed") {
      const rep = own.find((x) => x.party === rule.representative_party) || own[0];
      const extra = rule.scope === "mixed" ? own.filter((x) => x !== rep) : [];
      return { parts: rep ? [{ ...rep, shared: true }, ...extra] : [], rule };
    }
    return { parts: own, rule, separate: true };
  }

  // How a record is labelled where a cell holds more than one, or stands for the Coalition.
  const partLabel = (x) => (x.shared ? "Shared Coalition policy" : label(x.party));

  function claimCount(parts) {
    return parts.reduce((n, p) => n + p.record.claims.length, 0);
  }

  function renderMatrix() {
    const cols = columns();
    const c = coalition();
    $("pol-view-note").textContent = view === "combined" && c
      ? `${c.label}: where the two parties share a policy, the matrix shows the shared policy (published by the ${label(c.issues.find((i) => i.representative_party)?.representative_party || "liberal")} Party); where they differ, each party's own record is shown.`
      : "The Liberal and National parties shown separately, each with its own published record.";
    const head = cols.map((p) => `<th scope="col" class="pol-party" ${swatch(p.slug)}>${escapeHtml(p.label)}</th>`).join("");
    const rows = doc.issues.map((iss) => {
      const tds = cols.map((p) => {
        const { parts, separate } = cell(p.slug, iss.slug);
        if (!parts.length) {
          return `<td class="pol-cell pol-empty" data-csv=""><span class="muted small">No sourced position in the ledger yet</span></td>`;
        }
        const tag = separate || parts.length > 1;
        const text = parts.map((x) => (tag ? `${partLabel(x)}: ` : "") + x.record.headline).join(" / ");
        const lines = parts.map((x) => `<span class="pol-head">${tag ? `<b>${escapeHtml(partLabel(x))}:</b> ` : ""}${escapeHtml(x.record.headline)}</span>`).join("");
        const n = claimCount(parts);
        return `<td class="pol-cell" data-csv="${escapeHtml(text)}"><a class="pol-link" href="#${escapeHtml(`${iss.slug}/${p.slug}`)}" data-issue="${escapeHtml(iss.slug)}" data-party="${escapeHtml(p.slug)}">${lines}
          <span class="pol-n muted small">${n} sourced claim${n === 1 ? "" : "s"}</span></a></td>`;
      }).join("");
      return `<tr id="issue-${escapeHtml(iss.slug)}"><th scope="row" class="pol-issue">${escapeHtml(iss.name)}</th>${tds}</tr>`;
    }).join("");
    $("pol-matrix").innerHTML = `<table class="pol-table"><caption class="sr-only">Party positions by issue</caption>
      <thead><tr><th scope="col">Issue</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    markSelected();
  }

  function claimHtml(c) {
    const s = c.source || {};
    const f = c.fiscal || {};
    const money = [f.amount_display, f.timeframe && f.timeframe !== "Not specified" ? f.timeframe : null,
      FINANCING[f.financing]].filter(Boolean).join(", ");
    const pbo = f.pbo_status ? (PBO[f.pbo_status] || f.pbo_status.replace(/_/g, " ")) : "";
    const pboLink = f.pbo_ref && f.pbo_ref.url ? ` (<a href="${escapeHtml(f.pbo_ref.url)}" rel="noopener">${escapeHtml(f.pbo_ref.publisher || "source")}</a>)` : "";
    return `<li class="pol-claim">
      <span class="badge neutral pol-kind">${escapeHtml(KINDS[c.kind] || c.kind || "Claim")}</span>
      <p class="pol-statement">${escapeHtml(c.statement)}</p>
      ${money || pbo ? `<p class="small pol-fiscal">${money ? escapeHtml(money.charAt(0).toUpperCase() + money.slice(1)) : ""}${money && pbo ? ". " : ""}${escapeHtml(pbo)}${pboLink}</p>` : ""}
      <p class="small muted pol-src">Source: <a href="${escapeHtml(s.url)}" rel="noopener">${escapeHtml(s.title || s.url)}</a>${s.publisher ? `, ${escapeHtml(s.publisher)}` : ""}${s.published ? `, ${escapeHtml(fmtDate(s.published))}` : ""}</p>
    </li>`;
  }

  function renderDetail(issue, party) {
    const box = $("pol-detail");
    const iss = issueOf(issue);
    const col = party;
    if (!iss || !columns().some((p) => p.slug === col)) { box.hidden = true; return; }
    const { parts, rule } = cell(col, issue);
    const ruleNote = rule && rule.note ? `<p class="small muted">${escapeHtml(rule.note)}</p>`
      : "";
    box.innerHTML = `<div class="card-head"><h2>${escapeHtml(iss.name)}: ${escapeHtml(label(col))}</h2>
        <a class="icon-btn" href="#issue-${escapeHtml(issue)}">Back to the matrix</a></div>
      ${iss.summary ? `<p class="muted">${escapeHtml(iss.summary)}</p>` : ""}
      ${iss.state_role ? `<p class="small"><b>What the state controls:</b> ${escapeHtml(iss.state_role)}</p>` : ""}
      ${ruleNote}
      ${parts.length ? parts.map((x) => `<div class="pol-record" ${swatch(x.party)}>
          <h3>${parts.length > 1 || x.party !== col ? `${escapeHtml(partLabel(x))}: ` : ""}${escapeHtml(x.record.headline)}</h3>
          ${x.shared ? `<p class="small muted">Published by the ${escapeHtml(label(x.party))} Party for the Coalition.</p>` : ""}
          <ol class="pol-claims">${x.record.claims.map(claimHtml).join("")}</ol></div>`).join("")
        : `<p class="empty">No sourced position in the ledger yet. That doesn't mean the party has no view: the ledger only records positions with a published source.</p>`}
      <p class="small muted">Statements, headlines and the issue summary: Australian Election Tracker (OZE), CC BY 4.0.</p>`;
    box.hidden = false;
  }

  function markSelected() {
    const [issue, party] = location.hash.slice(1).split("/");
    document.querySelectorAll(".pol-cell.is-selected").forEach((td) => td.classList.remove("is-selected"));
    const a = issue && party ? document.querySelector(`.pol-link[data-issue="${CSS.escape(issue)}"][data-party="${CSS.escape(party)}"]`) : null;
    if (a) a.closest("td").classList.add("is-selected");
  }

  function fromHash(scroll) {
    const [issue, party] = decodeURIComponent(location.hash.slice(1)).split("/");
    if (issue && party) {
      if (party === "liberal" || party === "nationals") setView("separate");
      if (party === "coalition") setView("combined");
      renderDetail(issue, party);
      markSelected();
      if (scroll && !$("pol-detail").hidden) $("pol-detail").scrollIntoView({ block: "start" });
    } else {
      $("pol-detail").hidden = true;
      markSelected();
    }
  }

  function setView(v) {
    if (v === view) return;
    view = v;
    document.querySelectorAll(".segmented [data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
    renderMatrix();
  }

  function renderCredit() {
    const c = doc.credit || {};
    const accessed = fmtDate(doc.copied);
    $("pol-caveat").innerHTML = `<b>Australian Election Tracker's caveat:</b> ${escapeHtml(doc.caveat)}`;
    $("pol-credit").innerHTML = `<p>Policy ledger from <a href="${escapeHtml(c.url)}" rel="noopener">${escapeHtml(c.name)}</a>
        (<a href="${escapeHtml(c.data_page)}" rel="noopener">open data</a>), used under
        <a href="${escapeHtml(c.licence_url)}" rel="noopener">${escapeHtml(c.licence)}</a>. The headlines, claim statements and
        issue summaries are theirs; this site arranges them into the matrix and links each to its source. Copied ${escapeHtml(accessed)}
        and checked for changes at every data refresh.</p>
      <p class="small muted">Cite as: ${escapeHtml(c.citation)}, accessed ${escapeHtml(accessed)}.</p>
      <p class="small muted">Corrections to a position belong with the ledger: each record there has a source, an author and a date.</p>`;
  }

  async function init() {
    try {
      doc = await loadJSON("policies");
    } catch (err) {
      App.showError($("pol-matrix"), err);
      return;
    }
    doc.policies.forEach((r) => records.set(`${r.party}|${r.issue}`, r));
    view = doc.default_view === "separate" ? "separate" : "combined";
    if (!doc.combined_parties.length) document.querySelector(".segmented").hidden = true;
    document.querySelectorAll(".segmented [data-view]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.view === view));
      b.addEventListener("click", () => {
        setView(b.dataset.view);
        const [issue, party] = location.hash.slice(1).split("/");
        if (issue && party && !columns().some((p) => p.slug === party)) history.replaceState(null, "", location.pathname);
        fromHash(false);
      });
    });
    renderCredit();
    renderMatrix();
    fromHash(true);
    window.addEventListener("hashchange", () => fromHash(true));
  }

  init();
})();
