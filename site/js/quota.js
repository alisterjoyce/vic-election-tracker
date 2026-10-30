/* Upper-house quota calculator (upper.html, one per region).
   2026 rules: 5 members per region, Droop quota (1/6 of formal votes + 1, so 16.7%), no group voting
   tickets; above-the-line voters number at least 5 boxes, so preferences go only where voters send them.
   Model: each party is one group. Whole quotas elect members; the party's remainder stays with its next
   candidate. Then the lowest party is excluded: a set share of its votes exhausts and the rest flows to
   continuing parties of the same bloc in proportion to their votes (or to everyone if its bloc is gone). */
(function () {
  "use strict";
  const App = window.App;
  const { escapeHtml, partyName, partyVar, fmtDate } = App;

  const SEATS = 5;
  const QUOTA = 100 / (SEATS + 1);
  const DEFAULT_EXHAUST = 20;
  // Rough preference blocs. Anything not listed (IND, OTH) flows to everyone in proportion.
  const BLOC = { ALP: "left", GRN: "left", VS: "left", AJP: "left", LCV: "left",
    LNP: "right", LIB: "right", NAT: "right", ONP: "right", FF: "right", LBT: "right", DLP: "right", SFF: "right" };
  const EXTRA = ["LCV", "AJP", "FF", "LBT", "VS", "DLP", "SFF", "SUS", "IND"];   // parties the viewer can add
  const label = (code) => (code === "OTH" ? "Others (several parties)" : partyName(code));
  const fmt = (v) => v.toFixed(1);

  // rows: [{code, votes}] -> {seats: {code: n}, order: [code...], steps: [text], last: {winner, runnerUp, margin}}
  function count(rows, exhaustPct) {
    const total = rows.reduce((a, r) => a + (r.votes > 0 ? r.votes : 0), 0);
    const st = rows.filter((r) => r.votes > 0).map((r) => ({ code: r.code, votes: (100 * r.votes) / total, seats: 0, out: false,
      electable: r.code !== "OTH" }));
    const steps = [];
    const order = [];
    let filled = 0, last = null;
    const live = () => st.filter((p) => !p.out);
    const electable = () => live().filter((p) => p.electable);
    const elect = (p, how) => {
      p.seats++; filled++; order.push(p.code);
      steps.push(`${label(p.code)} elected ${how} (seat ${filled}, ${fmt(p.votes)}%)`);
    };

    let guard = 0;
    while (filled < SEATS && guard++ < 100) {
      // Whole quotas first, biggest party first.
      let changed = false;
      for (const p of electable().sort((a, b) => b.votes - a.votes)) {
        while (p.votes >= QUOTA - 1e-9 && filled < SEATS) {
          if (filled === SEATS - 1) {
            // Keep the margin from the final exclusion when nobody is left to compare with.
            const rival = electable().filter((x) => x !== p).sort((a, b) => b.votes - a.votes)[0];
            if (rival) last = { winner: p.code, runnerUp: rival.code, margin: p.votes - rival.votes, byQuota: true };
          }
          elect(p, "with a quota");
          p.votes -= QUOTA;
          changed = true;
        }
      }
      if (filled >= SEATS) break;
      if (changed) continue;
      const remaining = SEATS - filled;
      const cands = electable().sort((a, b) => b.votes - a.votes);
      if (cands.length <= remaining) {
        cands.forEach((p) => elect(p, "as one of the last continuing parties"));
        break;
      }
      // Exclude the lowest (a lumped "Others" first: it can't win as a group).
      const pool = live();
      const loser = pool.find((p) => !p.electable && p.votes > 0) || cands[cands.length - 1];
      const before = cands.filter((p) => p !== loser);
      if (before.length <= remaining) {
        // This exclusion decides the last seat(s): the weakest survivor beat the excluded party.
        const weakest = before[before.length - 1];
        last = { winner: weakest.code, runnerUp: loser.code, margin: weakest.votes - loser.votes, byQuota: false };
      }
      const v = loser.votes;
      const exhausted = (v * exhaustPct) / 100;
      const flow = v - exhausted;
      let to = electable().filter((p) => p !== loser && BLOC[p.code] && BLOC[p.code] === BLOC[loser.code]);
      if (!to.length) to = electable().filter((p) => p !== loser);
      const base = to.reduce((a, p) => a + Math.max(p.votes, 0.01), 0);
      to.forEach((p) => { p.votes += (flow * Math.max(p.votes, 0.01)) / base; });
      loser.out = true; loser.votes = 0;
      steps.push(`${label(loser.code)} excluded with ${fmt(v)}%: ${fmt(exhausted)} exhausts, ${fmt(flow)} flows to ${to.map((p) => label(p.code)).join(", ")}`);
    }
    const seats = Object.fromEntries(st.map((p) => [p.code, p.seats]));
    const final = Object.fromEntries(st.map((p) => [p.code, p.out ? null : p.votes + p.seats * QUOTA]));
    return { seats, order, steps, last, final };
  }

  function mount(el, region, poll) {
    const seed = poll && poll.regions[region.id];
    let rows = seed ? Object.entries(seed).map(([code, votes]) => ({ code, votes })) : [
      { code: "ALP", votes: 0 }, { code: "LNP", votes: 0 }, { code: "GRN", votes: 0 }, { code: "ONP", votes: 0 }, { code: "OTH", votes: 0 }];
    let exhaust = DEFAULT_EXHAUST;

    el.innerHTML = `
      <div class="card-head"><h2>Quota calculator</h2><span class="muted small">Quota ${fmt(QUOTA)}%</span></div>
      <p class="muted small" style="margin-top:0">${seed
        ? `Seeded from <a href="${escapeHtml(poll.source_url)}" target="_blank" rel="noopener">${escapeHtml(poll.pollster)}</a>
           (fieldwork ${escapeHtml(poll.fieldwork_label)}, published ${escapeHtml(fmtDate(poll.published))}, about
           ${Math.round(poll.sample_size / 8)} electors per region, so roughly ±5 points). Edit any figure.`
        : "No published regional poll for this region yet. Enter primary votes to try a result."}</p>
      <div class="table-scroll"><table class="quota-table">
        <thead><tr><th>Party</th><th class="num">Primary %</th><th class="num">Quotas</th><th class="num">Seats</th><th class="num">Final count</th></tr></thead>
        <tbody></tbody>
        <tfoot><tr><th>Total</th><th class="num" data-total></th><th colspan="3"></th></tr></tfoot>
      </table></div>
      <div class="quota-controls">
        <label class="field">Add a party
          <span class="quota-add"><select data-add><option value="">Choose…</option></select>
          <button type="button" class="icon-btn" data-add-btn>Add</button></span>
        </label>
        <label class="field"><span>Exhaustion: <strong data-exhaust-out></strong> of an excluded party's votes</span>
          <input type="range" min="0" max="80" step="5" data-exhaust value="${exhaust}">
        </label>
        <button type="button" class="icon-btn" data-reset>${seed ? "Reset to the poll" : "Clear"}</button>
      </div>
      <div class="quota-result" aria-live="polite"></div>
      <details class="quota-steps"><summary>How the count went</summary><ol></ol></details>
      <p class="muted small">Rules: 5 members, quota of one-sixth of formal votes plus one. Group voting tickets are gone, and above-the-line
        voters number at least 5 boxes, so a party's preferences go only where its voters send them. The model treats each party
        as one group and sends non-exhausted preferences to parties of the same leaning (Labor, Greens, Socialists, Animal Justice,
        Legalise Cannabis on one side; Coalition, One Nation, Family First, Libertarians, DLP, Shooters on the other) in proportion
        to their votes. "Others" is several small parties, so it can't win a seat as a group and is excluded first.</p>`;

    const tbody = el.querySelector("tbody");
    const add = el.querySelector("[data-add]");
    const out = el.querySelector(".quota-result");

    function fillAdd() {
      const used = new Set(rows.map((r) => r.code));
      add.innerHTML = '<option value="">Choose…</option>' + EXTRA.filter((c) => !used.has(c))
        .map((c) => `<option value="${c}">${escapeHtml(partyName(c))}</option>`).join("");
    }

    function renderRows() {
      tbody.innerHTML = rows.map((r, i) => `
        <tr>
          <td><span class="party" style="--party-color: var(${partyVar(r.code)})">${escapeHtml(label(r.code))}</span></td>
          <td class="num"><input type="number" inputmode="decimal" min="0" max="100" step="0.5" value="${r.votes}" data-i="${i}"
            aria-label="${escapeHtml(label(r.code))} primary vote %"></td>
          <td class="num" data-q="${i}"></td><td class="num" data-s="${i}"></td><td class="num" data-f="${i}"></td>
        </tr>`).join("");
      fillAdd();
      recount();
    }

    function recount() {
      const total = rows.reduce((a, r) => a + (r.votes > 0 ? r.votes : 0), 0);
      const totalCell = el.querySelector("[data-total]");
      totalCell.textContent = `${fmt(total)}%`;
      totalCell.classList.toggle("warn", Math.abs(total - 100) > 0.05);
      totalCell.title = Math.abs(total - 100) > 0.05 ? "Doesn't add to 100; the count scales the figures to 100" : "";
      el.querySelector("[data-exhaust-out]").textContent = `${exhaust}%`;
      if (total <= 0) { out.innerHTML = '<p class="empty">Enter some primary votes.</p>'; return; }
      const res = count(rows, exhaust);
      rows.forEach((r, i) => {
        const share = r.votes > 0 ? (100 * r.votes) / total : 0;
        el.querySelector(`[data-q="${i}"]`).textContent = (share / QUOTA).toFixed(2);
        el.querySelector(`[data-s="${i}"]`).innerHTML = res.seats[r.code]
          ? `<span class="seat-dots" style="--party-color: var(${partyVar(r.code)})" aria-label="${res.seats[r.code]} seats">${"●".repeat(res.seats[r.code])}</span>` : "0";
        const f = res.final[r.code];
        el.querySelector(`[data-f="${i}"]`).textContent = f == null ? (r.votes > 0 ? "Excluded" : "–") : `${fmt(f)}%`;
      });
      const last = res.last;
      out.innerHTML = `
        <div class="seat-row" role="img" aria-label="${escapeHtml(res.order.map(label).join(", "))}">
          ${res.order.map((c, i) => `<span class="seat-chip" style="background:var(${partyVar(c)});color:${App.inkFor(c)}" title="Seat ${i + 1}: ${escapeHtml(label(c))}">${i + 1}</span>`).join("")}
        </div>
        <p>${res.order.length ? Object.entries(res.seats).filter(([, n]) => n).sort((a, b) => b[1] - a[1])
          .map(([c, n]) => `${escapeHtml(label(c))} ${n}`).join(", ") : "No seats filled."}</p>
        ${last && last.runnerUp ? `<p><strong>Last seat:</strong> ${escapeHtml(label(last.winner))} ahead of ${escapeHtml(label(last.runnerUp))}
          by <strong>${fmt(last.margin)}</strong> points ${last.byQuota ? "when it reached a quota" : `when ${escapeHtml(label(last.runnerUp))} was excluded`}.</p>` : ""}`;
      el.querySelector(".quota-steps ol").innerHTML = res.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    }

    tbody.addEventListener("input", (e) => {
      const i = e.target.dataset.i;
      if (i == null) return;
      const v = parseFloat(e.target.value);
      rows[i].votes = isNaN(v) || v < 0 ? 0 : v;
      recount();
    });
    el.querySelector("[data-add-btn]").addEventListener("click", () => {
      if (!add.value) return;
      rows.push({ code: add.value, votes: 0 });
      renderRows();
      tbody.querySelector(`[data-i="${rows.length - 1}"]`).focus();
    });
    el.querySelector("[data-exhaust]").addEventListener("input", (e) => { exhaust = Number(e.target.value); recount(); });
    el.querySelector("[data-reset]").addEventListener("click", () => {
      rows = seed ? Object.entries(seed).map(([code, votes]) => ({ code, votes })) : rows.map((r) => ({ code: r.code, votes: 0 }));
      exhaust = DEFAULT_EXHAUST;
      el.querySelector("[data-exhaust]").value = String(exhaust);
      renderRows();
    });
    renderRows();
  }

  App.Quota = { mount, count, QUOTA, SEATS };
})();
