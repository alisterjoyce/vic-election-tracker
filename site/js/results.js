/* Results page: the 2026 count from data/results.json and data/results_lc.json (scripts/results.py, from the
   VEC's public results pages). "Called" is this site's projection unless the VEC has declared the seat. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyBadge, partyShort, partyName } = App;
  const $ = (id) => document.getElementById(id);
  const SEATS = 88, MAJORITY = 45;
  const BLOC_NAMES = { LNP: "Coalition", ALP: "Labor", GRN: "Greens", ONP: "One Nation", OTH: "Others" };
  const BLOC_CODE = { LNP: "LNP", ALP: "ALP", GRN: "GRN", ONP: "ONP", OTH: "IND" };   // colours, as on the home page
  const fmt1 = (n) => Number(n).toFixed(1);
  const statusLabel = (d) => (d.called_by === "vec" ? "Declared (VEC)" : d.status === "called" ? "Called by this site" : d.status === "leading" ? "Leading" : "Undecided");

  function tallyBar(t) {
    const blocs = Object.keys(BLOC_NAMES).map((b) => ({ b, called: (t.called || {})[b] || 0, leading: (t.leading || {})[b] || 0 }))
      .filter((x) => x.called + x.leading > 0).sort((a, b) => (b.called + b.leading) - (a.called + a.leading));
    const segs = blocs.map((x) => {
      const style = `background:var(${App.partyVar(BLOC_CODE[x.b])});color:${App.inkFor(BLOC_CODE[x.b])}`;
      return `${x.called ? `<span class="hb-seg" style="flex:${x.called} 0 0;${style}" title="${BLOC_NAMES[x.b]}: ${x.called} called">${x.called >= 4 ? x.called : ""}</span>` : ""}`
        + `${x.leading ? `<span class="hb-seg hb-lead" style="flex:${x.leading} 0 0;${style}" title="${BLOC_NAMES[x.b]}: ${x.leading} leading">${x.leading >= 4 ? x.leading : ""}</span>` : ""}`;
    }).join("") + (t.undecided ? `<span class="hb-seg hb-und" style="flex:${t.undecided} 0 0" title="${t.undecided} undecided"></span>` : "");
    const lead = blocs[0];
    const verdict = lead && lead.called >= MAJORITY ? `${BLOC_NAMES[lead.b]} has won a majority on these calls`
      : lead && lead.called + lead.leading >= MAJORITY ? `${BLOC_NAMES[lead.b]} is called or leading in enough seats for a majority`
      : "No party is called or leading in 45 seats";
    const key = blocs.map((x) => `<li><span class="swatch" style="background:var(${App.partyVar(BLOC_CODE[x.b])})"></span>${BLOC_NAMES[x.b]}
      <b>${x.called + x.leading}</b> <span class="muted small">(${x.called} called, ${x.leading} leading)</span></li>`).join("")
      + `<li><span class="swatch hb-und"></span>Undecided <b>${t.undecided}</b></li><li class="hb-maj-key"><span class="hb-maj-mark"></span>${MAJORITY} for a majority</li>`;
    return `<p class="res-verdict"><strong>${escapeHtml(verdict)}.</strong></p>
      <div class="hb-track res-track" role="img" aria-label="${escapeHtml(`${blocs.map((x) => `${BLOC_NAMES[x.b]} ${x.called} called, ${x.leading} leading`).join("; ")}; ${t.undecided} undecided. ${MAJORITY} seats needed.`)}">
        ${segs}<span class="hb-majority" style="left:${(100 * MAJORITY) / SEATS}%"></span></div>
      <ul class="hb-key">${key}</ul>
      <p class="muted small">Solid: called (by the VEC's declaration or this site's projection). Lighter: leading, not yet called. Hatched: no clear leader yet.</p>`;
  }

  function leaderPct(d) {
    return d.leader && d.tcp ? (d.tcp.find((r) => r.id === d.leader.id) || {}).pct : null;
  }

  function seatRow(id, d) {
    const pct = leaderPct(d);
    return `<tr data-status="${escapeHtml(d.status)}" data-changes="${d.changes_hands ? 1 : 0}">
      <td><a href="lower.html#${escapeHtml(id)}">${escapeHtml(d.name)}</a></td>
      <td>${d.holder ? partyBadge(d.holder, { full: false }) : "–"}</td>
      <td>${d.leader ? `${partyBadge(d.leader.party, { full: false })} <span class="small">${escapeHtml(d.leader.name)}</span>` : '<span class="muted">–</span>'}</td>
      <td><span class="call ${d.called_by === "vec" ? "call-vec" : d.status === "called" ? "call-site" : d.status === "leading" ? "call-lead" : "call-und"}">${escapeHtml(statusLabel(d))}</span></td>
      <td class="num" data-csv="${pct ?? ""}">${pct != null ? `${fmt1(pct)}%` : (d.leader ? '<span class="muted small">1st prefs</span>' : "–")}</td>
      <td class="num" data-csv="${d.swing_2cp ?? ""}">${d.swing_2cp != null ? App.fmtSwing(d.swing_2cp) : "–"}</td>
      <td class="num" data-csv="${d.counted_pct}">${fmt1(d.counted_pct || 0)}%${d.centres_total ? `<div class="muted small">${d.centres_counted}/${d.centres_total} centres</div>` : ""}</td>
    </tr>`;
  }

  function renderSeats(res) {
    const rows = Object.entries(res.districts).sort((a, b) => a[1].name.localeCompare(b[1].name));
    $("res-seats").innerHTML = `<table>
      <thead><tr><th>Seat</th><th>Held by</th><th>Leading candidate</th><th>Status</th><th class="num">Leader 2CP</th><th class="num" title="Change in the leading party's 2CP share since 2022, same two parties only">Swing to leader</th><th class="num">Counted</th></tr></thead>
      <tbody>${rows.map(([id, d]) => seatRow(id, d)).join("")}</tbody></table>`;
    const filter = () => {
      const v = $("res-filter").value;
      $("res-seats").querySelectorAll("tbody tr").forEach((tr) => {
        tr.hidden = v === "changes" ? tr.dataset.changes !== "1" : v ? tr.dataset.status !== v : false;
      });
    };
    $("res-filter").addEventListener("change", filter);
    filter();
    $("res-seats-card").hidden = false;
  }

  function renderChanges(res) {
    const list = Object.entries(res.districts).filter(([, d]) => d.changes_hands && d.leader)
      .sort((a, b) => (a[1].status === "called" ? 0 : 1) - (b[1].status === "called" ? 0 : 1) || a[1].name.localeCompare(b[1].name));
    $("res-changes-count").textContent = list.length ? `${list.length} seat${list.length === 1 ? "" : "s"}` : "";
    $("res-changes").innerHTML = list.length ? `<ul class="res-changes">${list.map(([id, d]) => {
      const pct = leaderPct(d);
      return `<li><a href="lower.html#${escapeHtml(id)}">${escapeHtml(d.name)}</a>: ${partyBadge(d.holder, { full: false })} → ${partyBadge(d.leader.party, { full: false })}
        <span class="call ${d.called_by === "vec" ? "call-vec" : d.status === "called" ? "call-site" : "call-lead"}">${escapeHtml(statusLabel(d))}</span>
        <span class="muted small">${pct != null ? `${fmt1(pct)}% 2CP` : "on first preferences"}${d.swing_2cp != null ? `, swing ${App.fmtSwing(d.swing_2cp)}` : ""}, ${fmt1(d.counted_pct)}% counted</span></li>`;
    }).join("")}</ul>` : '<p class="muted">No seat is changing hands on the figures so far.</p>';
    $("res-changes-card").hidden = false;
  }

  function renderCouncil(lc) {
    const regions = Object.entries((lc && lc.regions) || {}).filter(([, r]) => r.total);
    if (!regions.length) return;
    $("res-lc").innerHTML = `<div class="lc-grid">${regions.sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, r]) => {
      const groups = r.groups.filter((g) => g.quotas >= 0.15).slice(0, 7);
      return `<div class="lc-region"><h3><a href="upper.html#${escapeHtml(id)}">${escapeHtml(r.name)}</a></h3>
        <p class="muted small">${fmt1(r.counted_pct)}% of enrolment counted · quota ${r.quota ? r.quota.toLocaleString("en-AU") : "–"}${r.elected.length ? ` · ${r.elected.length} of ${r.positions} elected` : ""}</p>
        ${App.quotaBars(groups)}</div>`;
    }).join("")}</div>`;
    $("res-lc-card").hidden = false;
  }

  async function init() {
    let res, lc;
    try {
      [res, lc] = await Promise.all([loadJSON("results"), loadJSON("results_lc").catch(() => null)]);
    } catch (err) {
      App.showError($("res-tally"), err);
      return;
    }
    const counting = Object.values(res.districts || {}).some((d) => d.total);
    $("res-rule").textContent = res.call_rule ? `How seats are called: ${res.call_rule.text}` : "";
    if (!counting) {
      $("res-tally").innerHTML = `<div class="res-wait"><p class="res-wait-big">Counting begins 6 pm Sat 28 Nov</p>
        <p class="muted">Results will appear here as the Victorian Electoral Commission publishes them, refreshed every 5 minutes.</p></div>`;
      return;
    }
    $("res-updated").textContent = res.vec_updated ? `VEC updated ${res.vec_updated}` : (res.updated ? `Checked ${App.fmtDateTime(res.updated)}` : "");
    $("res-tally").innerHTML = tallyBar(res.tally);
    renderChanges(res);
    renderSeats(res);
    renderCouncil(lc);
  }

  init();
})();
