/* Lower house page: filter districts, show the selected one (selected via #district-id). */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyBadge, partyShort, statusBadge, fmtDate, hashId, copyLink } = window.App;

  // Strongest confirmation first.
  const STATUS_RANK = ["vec_nominated", "endorsed", "reported", "announced"];

  let districts = [];
  let candidates = [];
  let regionsById = {};
  // Seat outlook inputs: statewide swing, MRP models, betting, seat polls.
  let outlook = { swing: null, models: null, odds: null, seatPolls: null };
  let shots = {};   // candidate id -> headshot (data/headshots.json)

  const $ = (id) => document.getElementById(id);

  function marginLabel(pct) {
    if (pct == null) return "";
    if (pct < 6) return "Marginal";
    if (pct < 10) return "Fairly safe";
    return "Safe";
  }

  /* ---------- Seat outlook ---------- */
  const fmt1 = (n) => Number(n).toFixed(1);

  function outlookRow(label, body) {
    return `<div class="outlook-row"><dt>${escapeHtml(label)}</dt><dd>${body}</dd></div>`;
  }

  function renderOutlook(d) {
    const s = outlook.swing;
    const adj = App.swingAdjusted(d.margin, s);
    let swingCell;
    if (!s) swingCell = '<span class="muted">n/a (no two-party-preferred polling)</span>';
    else if (!adj) swingCell = '<span class="muted">n/a (not a Labor-Coalition contest)</span>';
    else {
      swingCell = `<strong>${escapeHtml(adj.before)} → ${escapeHtml(adj.after)}</strong> on current polling
        <div class="muted small">Statewide swing to L/NP ${App.fmtSwing(s.swing)}: L/NP ${fmt1(s.current)}% 2PP now vs ${fmt1(s.base)}% in ${escapeHtml(s.year)}</div>`;
    }

    const models = (outlook.models && outlook.models.models) || [];
    const modelCell = models.length ? models.map((mod) => {
      const e = (outlook.models.seats || []).find((x) => x.district === d.id && x.model === mod.id);
      const name = `${escapeHtml(mod.name)} <span class="muted small">(${escapeHtml(mod.fieldwork || "")})</span>`;
      if (!e || !e.winner) return `<div>${name}: <span class="muted">not published</span></div>`;
      const vs = e.runner_up ? ` over ${escapeHtml(App.partyName(e.runner_up))}` : "";
      const share = e.winner_2cp != null ? `, ${fmt1(e.winner_2cp)}% 2CP` : "";
      const prob = e.win_probability != null ? `win probability ${fmt1(e.win_probability)}%` : '<span class="muted">win probability not published</span>';
      const link = mod.source_url ? ` <a class="small" href="${escapeHtml(mod.source_url)}" rel="noopener" target="_blank">source</a>` : "";
      return `<div>${name}: ${partyBadge(e.winner)}${vs}${share} · ${prob}${link}</div>`;
    }).join("") : '<span class="muted">not published</span>';

    const odds = outlook.odds;
    const seatOdds = odds && (odds.seats || []).find((x) => x.district === d.id);
    let oddsCell;
    const price = App.fmtPrice;
    const favLabel = (code, candidate) => (candidate ? `${escapeHtml(candidate)} (Ind)`
      : App.PARTIES[code] ? partyBadge(code) : escapeHtml(code));
    if (seatOdds && (seatOdds.favourite || seatOdds.joint_favourites || (seatOdds.options || []).length)) {
      const date = seatOdds.date_checked || odds.date_checked;
      let head;
      if (seatOdds.favourite) head = `${favLabel(seatOdds.favourite, seatOdds.favourite_candidate)} ${price(seatOdds.price)}`;
      else if (seatOdds.joint_favourites) head = `${seatOdds.joint_favourites.map((p) => favLabel(p)).join(" / ")} ${price(seatOdds.price)} <span class="muted small">(joint favourites)</span>`;
      else head = '<span class="muted">favourite not visible (partial market)</span>';
      const market = (seatOdds.options || []).map((o) => `${escapeHtml(o.label)} ${price(o.price)}`).join(" · ");
      oddsCell = `${head} <span class="muted small">${escapeHtml(odds.source || "")}${date ? `, as at ${escapeHtml(fmtDate(date))}` : ""}</span>
        ${market ? `<div class="muted small">${market}${seatOdds.more_options_hidden ? " · more options not shown" : ""}</div>` : ""}`;
    } else {
      oddsCell = '<span class="muted">not recorded</span>';
    }

    const polls = ((outlook.seatPolls && outlook.seatPolls.polls) || []).filter((p) => p.district === d.id)
      .sort((a, b) => (b.end_date || "").localeCompare(a.end_date || ""));
    const pollsCell = polls.length ? polls.map((p) => {
      const tcp = p.tcp ? Object.entries(p.tcp).map(([k, v]) => `${escapeHtml(partyShort(k))} ${fmt1(v)}`).join(" – ") : "";
      const prim = p.primary ? Object.entries(p.primary).map(([k, v]) => `${escapeHtml(partyShort(k))} ${v}`).join(", ") : "";
      return `<div>${escapeHtml(p.pollster)}, ${escapeHtml(fmtDate(p.end_date))}${p.sample_size ? `, n=${p.sample_size}` : ""}:
        ${tcp ? `<strong>2CP ${tcp}</strong>` : ""}${prim ? ` <span class="muted small">(primaries ${prim})</span>` : ""}
        ${p.source_url ? ` <a class="small" href="${escapeHtml(p.source_url)}" rel="noopener" target="_blank">source</a>` : ""}</div>`;
    }).join("") : '<span class="muted">none published</span>';

    return `
      <section class="outlook" aria-label="Seat outlook">
        <h3>Seat outlook</h3>
        <dl>
          ${outlookRow("Swing-adjusted margin", swingCell)}
          ${outlookRow("MRP estimates", modelCell)}
          ${outlookRow("Betting favourite", oddsCell)}
          ${outlookRow("Seat polls", pollsCell)}
        </dl>
        <p class="muted small outlook-note">The swing-adjusted figure is a uniform-swing estimate; One Nation's vote breaks uniform swing in outer-suburban and regional seats.</p>
      </section>`;
  }

  // The ABC's classification ("Very Safe Labor") when we have it.
  function seatLabel(d) {
    return d.classification || marginLabel(d.margin && d.margin.pct);
  }

  function marginText(m) {
    if (!m || m.pct == null) return "–";
    return `${escapeHtml(partyShort(m.party))} ${Number(m.pct).toFixed(1)}%${m.vs ? ` vs ${escapeHtml(partyShort(m.vs))}` : ""}`;
  }

  function filtered() {
    const region = $("f-region").value;
    const area = $("f-area").value;
    return districts.filter((d) => (!region || d.region === region) && (!area || d.area === area));
  }

  function renderDistrictOptions() {
    const sel = $("f-district");
    const current = hashId();
    const list = filtered();
    sel.innerHTML = '<option value="">Choose a district…</option>' +
      list.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join("");
    sel.value = list.some((d) => d.id === current) ? current : "";
  }

  function renderList() {
    const list = filtered();
    const current = hashId();
    $("list-count").textContent = `${list.length} of ${districts.length} shown`;
    if (!list.length) {
      $("district-list").innerHTML = '<p class="empty">No districts match these filters.</p>';
      return;
    }
    $("district-list").innerHTML = `
      <table>
        <thead><tr><th><span class="sr-only">My seats</span></th><th>District</th><th>Region</th><th>Held by</th><th class="num">Margin</th><th>Seat</th></tr></thead>
        <tbody>
          ${list.map((d) => `
            <tr class="clickable${d.id === current ? " selected" : ""}" data-id="${escapeHtml(d.id)}">
              <td class="star-cell">${App.starButton(d.id, d.name)}</td>
              <td><a href="#${escapeHtml(d.id)}">${escapeHtml(d.name)}</a></td>
              <td>${escapeHtml(regionsById[d.region] ? regionsById[d.region].name : d.region)}</td>
              <td>${partyBadge(d.party, { full: false })}</td>
              <td class="num">${d.margin && d.margin.pct != null ? Number(d.margin.pct).toFixed(1) : "–"}</td>
              <td>${escapeHtml(seatLabel(d))}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  }

  const isInactive = (c) => c.status === "withdrawn" || c.status === "superseded";

  function candidateSort(a, b) {
    const wa = isInactive(a), wb = isInactive(b);
    if (wa !== wb) return wa ? 1 : -1;
    const pa = a.ballot_position ?? Infinity, pb = b.ballot_position ?? Infinity;
    const rank = (s) => STATUS_RANK.indexOf(s) + 1 || STATUS_RANK.length + 1;
    return pa - pb || rank(a.status) - rank(b.status) || a.name.localeCompare(b.name);
  }

  function renderDetail() {
    const el = $("district-detail");
    const id = hashId();
    const d = districts.find((x) => x.id === id);
    if (!d) {
      el.hidden = true;
      if (id) {
        el.hidden = false;
        el.innerHTML = `<p class="empty">No district called “${escapeHtml(id)}”. Choose one from the list.</p>`;
      }
      document.title = "Lower House Districts · Vic Election 2026";
      return;
    }
    document.title = `${d.name} · Vic Election 2026`;
    const region = regionsById[d.region];
    // Superseded rows stay in candidates.json for the record but aren't shown.
    const cands = candidates.filter((c) => c.district === d.id && c.status !== "superseded").sort(candidateSort);
    const anyBallot = cands.some((c) => c.ballot_position != null);

    el.hidden = false;
    el.innerHTML = `
      <div class="card-head">
        <h2>${App.starButton(d.id, d.name)} ${escapeHtml(d.name)}</h2>
        <div class="card-actions">
          ${d.abc_url ? `<a class="icon-btn" href="${escapeHtml(d.abc_url)}" target="_blank" rel="noopener">ABC guide ↗</a>` : ""}
          <button class="icon-btn" type="button" id="copy-link">Copy link</button>
        </div>
      </div>
      <div class="facts">
        <div class="fact"><div class="label">Sitting MP</div><div class="value">${escapeHtml(d.sitting_mp || "–")}${d.retiring ? ' <span class="badge neutral">Retiring</span>' : ""}</div></div>
        <div class="fact"><div class="label">Held by</div><div class="value">${partyBadge(d.party)}</div></div>
        <div class="fact"><div class="label">Margin</div><div class="value">${marginText(d.margin)}</div><div class="muted small">${escapeHtml(seatLabel(d))}</div></div>
        <div class="fact"><div class="label">Region</div><div class="value">${region ? `<a href="upper.html#${escapeHtml(region.id)}">${escapeHtml(region.name)}</a>` : escapeHtml(d.region)}${d.needs_check ? ' <span class="badge reported" title="Region allocation flagged for checking">Check</span>' : ""}</div><div class="muted small">${d.area === "regional" ? "Regional" : "Metro"}</div></div>
      </div>
      ${renderOutlook(d)}
      ${d.notes ? `<p>${escapeHtml(d.notes)}</p>` : ""}
      ${d.region_note ? `<p class="muted small">${escapeHtml(d.region_note)}</p>` : ""}
      <h3>Candidates</h3>
      ${cands.length ? `
        <ul class="people">
          ${cands.map((c) => `
            <li class="${isInactive(c) ? "is-withdrawn" : ""}">
              ${anyBallot ? `<span class="pos" title="Ballot position">${c.ballot_position ?? "–"}</span>` : ""}
              ${App.avatar(shots, d.id, c.name, c.party)}
              <span class="name">${App.profileLink(d.id, c.name)}${c.incumbent ? ' <span class="muted small">(sitting MP)</span>' : ""}</span>
              ${partyBadge(c.party)}
              ${statusBadge(c.status)}
              ${c.source_url ? `<a class="small" href="${escapeHtml(c.source_url)}" rel="noopener">source</a>` : ""}
              ${c.notes ? `<span class="note muted small">${escapeHtml(c.notes)}</span>` : ""}
            </li>`).join("")}
        </ul>
        <p class="muted small" style="margin-top:8px">Last checked ${escapeHtml(fmtDate(cands.map((c) => c.updated).filter(Boolean).sort().pop()))}</p>
        ${App.photoCredits(shots, cands.map((c) => [d.id, c.name]))}
        <details class="sharecard-wrap" id="seat-share-wrap"><summary>Share card for this seat</summary><div class="sharecard" id="seat-share"></div></details>`
        : '<p class="empty">No candidates recorded yet.</p>'}
      <section class="r22" id="r22" aria-labelledby="r22-h">
        <h3 id="r22-h">How it voted in 2022</h3>
        <p class="empty">Loading 2022 results…</p>
      </section>`;
    $("copy-link").addEventListener("click", (e) => copyLink(e.currentTarget));
    const shareWrap = $("seat-share-wrap");
    if (shareWrap) shareWrap.addEventListener("toggle", () => {
      if (!shareWrap.open || shareWrap.dataset.drawn) return;
      shareWrap.dataset.drawn = "1";
      const running = cands.filter((c) => !isInactive(c));
      App.ShareCard.mount($("seat-share"), {
        draw: (canvas) => App.ShareCard.drawSeat(canvas, { seat: d, people: running, shots }),
        filename: `${d.id}.png`,
        title: `${d.name}: who is standing`,
      });
    });
    renderResults2022(d);
  }

  /* ---------- How it voted in 2022 (vec-contest-v1 format, shared with the 2026 feed) ---------- */
  const pct = (n, total) => (total ? (100 * n) / total : 0);
  const swingSpan = (v) => (v == null ? "" :
    ` <span class="small ${v >= 0 ? "swing-up" : "swing-down"}" title="Swing since the notional 2018 result">${App.fmtSwing(v)}</span>`);
  const TYPE_LABELS = { Ordinary: "Voting centres", EVCEarly: "Early voting centres", MobileVotingEarly: "Mobile voting",
    Early: "Early votes", Postal: "Postal", Absent: "Absent", MarkedAsVoted: "Marked as voted", Provisional: "Provisional" };

  async function renderResults2022(d) {
    const el = $("r22");
    let r;
    try {
      r = await loadJSON(`results_2022/${d.id}`);
    } catch (err) {
      el.innerHTML = '<h3 id="r22-h">How it voted in 2022</h3><p class="empty">2022 results are not available for this district.</p>';
      return;
    }
    if (hashId() !== d.id || !document.getElementById("r22")) return;   // user moved on
    const cand = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
    const fp = r.first_preferences;
    const sw = (r.swing && r.swing.first_preferences) || {};
    const tsw = (r.swing && r.swing.tcp) || {};
    const fpRows = Object.entries(fp.candidates).sort((a, b) => b[1] - a[1]);
    const maxShare = Math.max(...fpRows.map(([, v]) => pct(v, fp.formal)));
    const label = (c) => `${escapeHtml(App.partyName(c.party))} <span class="muted small">${escapeHtml(c.name)}</span>`;

    // Booth-level 2CP is the VEC's indicative count. The headline uses the final distribution
    // of preferences when it ended with two candidates (it stops early once someone passes 50%).
    const tcpEntries = r.tcp ? Object.entries(r.tcp.candidates).sort((a, b) => b[1] - a[1]) : [];
    const dist = r.distribution && Object.keys(r.distribution.candidates).length === 2 ? r.distribution.candidates : null;
    const headEntries = dist ? Object.entries(dist).sort((a, b) => b[1] - a[1]) : tcpEntries;
    const headTotal = headEntries.reduce((a, [, v]) => a + v, 0);
    const byType = r.tcp ? Object.keys(r.tcp.by_type) : [];
    const elected = r.candidates.find((c) => c.elected);
    const name = (id) => `${escapeHtml(App.partyName(cand[id].party))} (${escapeHtml(cand[id].name.split(",")[0])})`;
    const notes = [];
    if (dist && r.tcp && !Object.keys(dist).every((id) => id in r.tcp.candidates)) {
      notes.push(`The VEC's voting-centre count was between ${tcpEntries.map(([id]) => name(id)).join(" and ")}, so the booth map compares those two; the final count was between ${headEntries.map(([id]) => name(id)).join(" and ")}.`);
    } else if (elected && tcpEntries.length && tcpEntries[0][0] !== elected.id) {
      notes.push(`${name(elected.id)} trailed in the VEC's indicative two-candidate count but won after the full distribution of preferences.`);
    }

    el.innerHTML = `
      <h3 id="r22-h">How it voted in 2022</h3>
      <p class="muted small" style="margin-top:0">${r.event.name && !/^State Election 2022/.test(r.event.name)
        ? `${escapeHtml(r.event.name)} (${escapeHtml(App.fmtDate(r.event.date))}), held after the November 2022 poll failed; results from the`
        : "Final 2022 results from the"} <a href="${escapeHtml(r.event.source)}" rel="noopener" target="_blank">VEC</a>.
        Swings compare with the notional 2018 result on today's boundaries (<a href="${escapeHtml((r.swing && r.swing.source) || "#")}" rel="noopener" target="_blank">Wikipedia</a>).</p>
      <h4>First preferences</h4>
      <ul class="vote-bars">
        ${fpRows.map(([id, v]) => {
          const c = cand[id];
          return `<li><span class="vb-name">${label(c)}</span>
            <span class="vb-track"><span class="vb-fill" style="display:block;width:${(100 * pct(v, fp.formal)) / maxShare}%;background:var(${App.partyVar(c.party)})"></span></span>
            <span class="vb-num">${pct(v, fp.formal).toFixed(1)}%${swingSpan(sw[id])}</span></li>`;
        }).join("")}
      </ul>
      <p class="muted small">${fp.formal.toLocaleString("en-AU")} formal votes, ${fp.informal.toLocaleString("en-AU")} informal (${pct(fp.informal, fp.total).toFixed(1)}%)${r.contest.enrolment ? `; enrolment ${r.contest.enrolment.toLocaleString("en-AU")}` : ""}.</p>
      ${headEntries.length ? `
        <h4>${dist ? "After preferences" : "Two-candidate preferred"}</h4>
        <div class="tcp-bar" role="img" aria-label="${headEntries.map(([id, v]) => `${App.partyName(cand[id].party)} ${pct(v, headTotal).toFixed(1)}%`).join(", ")}">
          ${headEntries.map(([id, v]) => `<span style="width:${pct(v, headTotal)}%;background:var(${App.partyVar(cand[id].party)})"></span>`).join("")}
        </div>
        <p>${headEntries.map(([id, v]) => `${label(cand[id])} <strong>${pct(v, headTotal).toFixed(1)}%</strong>${swingSpan(tsw[id])}`).join(" · ")}</p>
        ${notes.map((n) => `<p class="muted small">${n}</p>`).join("")}` : ""}
      <h4>Voting centres</h4>
      <div class="booth-map" id="booth-map"></div>
      <p class="muted small" id="booth-note"></p>
      ${byType.length ? `
        <div class="table-scroll"><table>
          <thead><tr><th>Vote type (2CP)</th>${tcpEntries.map(([id]) => `<th class="num">${escapeHtml(App.partyShort(cand[id].party))}</th>`).join("")}<th class="num">Votes</th></tr></thead>
          <tbody>${byType.map((t) => {
            const row = r.tcp.by_type[t];
            const sum = Object.values(row).reduce((a, b) => a + (b || 0), 0);
            return `<tr><td>${escapeHtml(TYPE_LABELS[t] || t)}</td>${tcpEntries.map(([id]) => `<td class="num">${pct(row[id] || 0, sum).toFixed(1)}%</td>`).join("")}<td class="num">${sum.toLocaleString("en-AU")}</td></tr>`;
          }).join("")}</tbody>
        </table></div>` : ""}
      <details class="booth-table"><summary>All ${r.polling_places.length} voting centres</summary>
        <div class="table-scroll"><table>
          <thead><tr><th>Voting centre</th><th class="num">Votes</th>${tcpEntries.map(([id]) => `<th class="num">${escapeHtml(App.partyShort(cand[id].party))} 2CP</th>`).join("")}</tr></thead>
          <tbody>${r.polling_places.slice().sort((a, b) => (b.total || 0) - (a.total || 0)).map((p) => {
            const s = p.tcp ? Object.values(p.tcp).reduce((a, b) => a + (b || 0), 0) : 0;
            return `<tr><td>${escapeHtml(p.name)}${p.lat == null ? ' <span class="muted small">(not mapped)</span>' : ""}</td><td class="num">${(p.total ?? 0).toLocaleString("en-AU")}</td>${tcpEntries.map(([id]) => `<td class="num">${p.tcp ? `${pct(p.tcp[id] || 0, s).toFixed(1)}%` : "–"}</td>`).join("")}</tr>`;
          }).join("")}</tbody>
        </table></div>
      </details>`;

    if (window.L && App.Maps) {
      const { placed, total } = await App.Maps.boothMap($("booth-map"), d.id, r);
      $("booth-note").textContent = `${placed} of ${total} voting centres mapped. Circles are sized by votes and coloured by the two-candidate-preferred leader; tap one for its numbers. Early, postal, absent and other declaration votes aren't tied to a place, so they're in the table below instead.`;
    } else {
      $("booth-map").remove();
      $("booth-note").textContent = "The map library failed to load; the voting-centre table below has every result.";
    }
  }

  function onHashChange() {
    const id = hashId();
    const d = districts.find((x) => x.id === id);
    // If a shared link points outside the current filters, clear them so it shows up.
    if (d && !filtered().includes(d)) { $("f-region").value = ""; $("f-area").value = ""; }
    renderDistrictOptions();
    renderList();
    renderDetail();
    if (d) $("district-detail").scrollIntoView({ block: "nearest" });
  }

  async function init() {
    try {
      const optional = (name) => loadJSON(name).catch((err) => { console.warn(err); return null; });
      const [dd, cd, rd, meta, pollData, models, odds, seatPolls] = await Promise.all([
        loadJSON("districts"), loadJSON("candidates"), loadJSON("regions"),
        optional("meta"), optional("polls"), optional("seat_models"), optional("seat_odds"), optional("seat_polls"),
      ]);
      shots = await App.loadHeadshots();
      outlook = { swing: App.statewideSwing(meta, pollData), models, odds, seatPolls };
      districts = dd.districts.slice().sort((a, b) => a.name.localeCompare(b.name));
      candidates = cd.candidates || [];
      rd.regions.forEach((r) => { regionsById[r.id] = r; });

      $("f-region").innerHTML += rd.regions.slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join("");

      $("f-region").addEventListener("change", () => { renderDistrictOptions(); renderList(); });
      $("f-area").addEventListener("change", () => { renderDistrictOptions(); renderList(); });
      $("f-district").addEventListener("change", (e) => {
        if (e.target.value) {
          location.hash = e.target.value;
        } else {
          history.replaceState(null, "", location.pathname + location.search);
          onHashChange();
        }
      });
      $("district-list").addEventListener("click", (e) => {
        const row = e.target.closest("tr[data-id]");
        if (row && !e.target.closest("a, [data-star]")) location.hash = row.dataset.id;
      });
      window.addEventListener("hashchange", onHashChange);
      onHashChange();
    } catch (err) {
      window.App.showError($("district-list"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
