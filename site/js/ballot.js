/* Your ballot (ballot.html#<district id>): mock-ups of both ballot papers for a district, in the VEC's ballot
   order (data/vec_nominations.json): the Legislative Assembly paper for the district and the Legislative Council
   paper for its region, groups above the line and candidates below. Beside each, every how-to-vote card
   registered for that contest (data/htv/<district or region>.json, shown by js/htv.js), labelled as the registering party's or candidate's own
   recommendation, and the VEC's rules for a formal vote. Facts only: this site recommends nothing.
   Printable (print styles in style.css) and shareable as an image (sharecard.js ballotCard). */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyVar, hashId } = App;
  const $ = (id) => document.getElementById(id);

  // The VEC's rules for a formal vote, as its voter guide gives them (checked 16 Nov 2026). Since group voting tickets
  // ended (Aug 2026) the Council instruction is at least 5 boxes either side of the line. The savings rules are the
  // VEC's counting rules from its scrutineer handbook (Appendix 6), shown as that, not as advice.
  const GUIDE = "https://www.vec.vic.gov.au/voting/learn-to-vote/how-to-fill-out-state-ballot-papers";
  const HANDBOOK = "https://www.vec.vic.gov.au/-/media/a601cc5549c04608951cc7c87b196624.pdf";
  const RULES = {
    la: {
      url: GUIDE,
      text: (n) => `<p>Number <strong>every box</strong> in the order of your choice: 1 beside your first choice, 2 beside your
        second, and so on until there is a number in every box (here, 1 to ${n}). Use numbers only: ticks, crosses, a repeated
        or missing number, or a zero can make the vote informal.</p>
        <p class="muted small">In the count, the VEC accepts a paper with one box left blank if that box would have held the last number
        (<a href="${HANDBOOK}" target="_blank" rel="noopener">scrutineer handbook ↗</a>, Appendix 6).</p>`,
    },
    lc: {
      url: GUIDE,
      text: () => `<p>Number <strong>at least 5 boxes</strong>, either <strong>above</strong> the line <strong>or below</strong> it, not both:</p>
        <ul><li><strong>Above the line:</strong> number the group boxes 1, 2, 3 and so on in the order of your choice until you have
          numbered at least 5. Don't write any numbers below the line.</li>
        <li><strong>Below the line:</strong> number the candidate boxes 1, 2, 3 and so on until you have numbered at least 5. Don't write
          any numbers above the line.</li></ul>
        <p class="muted small">Group voting tickets no longer exist: your preferences go only where you number them. In the count, the VEC
          still accepts an above-the-line vote with only a first preference, and a below-the-line vote with 1 to 5 in sequence, ignoring
          mistakes after 5; if both sides are formal, the below-the-line vote counts
          (<a href="${HANDBOOK}" target="_blank" rel="noopener">scrutineer handbook ↗</a>, Appendix 6).</p>`,
    },
  };

  let districts = [], regions = {}, vec = null;

  /* ---------- How-to-vote cards (js/htv.js): every registered card for the contest, side by side ---------- */
  const htvDocs = {};
  const loadHtv = (area) => (area in htvDocs ? Promise.resolve(htvDocs[area])
    : App.Htv.load(area).catch(() => null).then((doc) => (htvDocs[area] = doc)));

  function htvPanel(area) {
    return `<div class="yb-htv">${App.Htv.section(htvDocs[area] || null, { area })}</div>`;
  }

  /* ---------- The two papers ---------- */
  const nameHtml = (c) => {
    const b = String(c.ballot_name || c.name), i = b.indexOf(",");
    const inner = i < 0 ? `<span class="bp-sur">${escapeHtml(b)}</span>`
      : `<span class="bp-sur">${escapeHtml(b.slice(0, i))}</span>, ${escapeHtml(b.slice(i + 1).trim())}`;
    return c.id ? `<a class="bp-name" href="candidate.html#${escapeHtml(c.id)}">${inner}</a>` : `<span class="bp-name">${inner}</span>`;
  };
  const partyLabel = (c) => `<span class="bp-party" style="--party-color: var(${partyVar(c.party)})">${escapeHtml(c.party_label || (c.party === "IND" ? "Independent" : ""))}</span>`;
  const pendingNote = `<p class="bp-note">The VEC hasn't published the ballot order for this contest yet, so these are in the order
    the candidates nominated, which is not the order on the ballot paper.</p>`;

  function assembly(d, entry) {
    const drawn = !!entry.ballot_drawn;
    const cands = entry.candidates.slice().sort((a, b) => (drawn ? a.ballot_position - b.ballot_position : (a.nominated || 0) - (b.nominated || 0)));
    const n = cands.length;
    return `<section class="card yb-house" aria-labelledby="yb-la-h">
      <div class="card-head"><h2 id="yb-la-h">Legislative Assembly</h2><span class="muted small">${escapeHtml(entry.name)} District · 1 member · ${n} candidates</span></div>
      <div class="yb-grid">
        <div class="yb-paper" role="group" aria-label="Mock-up of the Legislative Assembly ballot paper for ${escapeHtml(entry.name)} District">
          <p class="yb-paper-kicker">Mock-up, not an official ballot paper</p>
          <p class="yb-paper-title">Legislative Assembly<span>${escapeHtml(entry.name)} District</span></p>
          ${drawn ? "" : pendingNote}
          <p class="yb-paper-instr">Number every box from 1 to ${n} in the order of your choice</p>
          <ol class="yb-la-list">${cands.map((c) => `<li style="--party-color: var(${partyVar(c.party)})">
            <span class="yb-box" aria-hidden="true"></span>
            <span class="bp-who">${nameHtml(c)}${partyLabel(c)}</span></li>`).join("")}</ol>
        </div>
        ${htvPanel(d.id)}
      </div>
      <div class="yb-rules"><h3>For your Assembly vote to count</h3>${RULES.la.text(n)}
        <p class="muted small">The VEC's guide: <a href="${escapeHtml(RULES.la.url)}" target="_blank" rel="noopener">how to fill out state ballot papers ↗</a></p></div>
    </section>`;
  }

  function council(region, entry) {
    const drawn = !!entry.ballot_drawn;
    // The VEC lists a group without a name as "Unnamed-1": the ballot prints no name above its box.
    const gLabel = (g) => (!g.label || /^unnamed/i.test(g.label) ? "(no group name)" : g.label);
    const groups = drawn ? (entry.groups || []).map((g) => ({ ...g, label: gLabel(g), members: entry.candidates.filter((c) => c.group === g.group).sort((a, b) => (a.group_position || 0) - (b.group_position || 0)) })) : [];
    const loose = drawn ? entry.candidates.filter((c) => !c.group).sort((a, b) => a.ballot_position - b.ballot_position)
      : entry.candidates.slice().sort((a, b) => (a.nominated || 0) - (b.nominated || 0));
    const col = (letter, label, party, members, atl) => `<div class="yb-col" style="--party-color: var(${partyVar(party)})">
        <div class="yb-atl">${atl ? `<span class="yb-box" aria-hidden="true"></span><span class="yb-letter">${escapeHtml(letter)}</span><span class="yb-glabel">${escapeHtml(label)}</span>`
          : `<span class="yb-glabel muted">${escapeHtml(label)}</span>`}</div>
        <ol class="yb-btl">${members.map((c) => `<li style="--party-color: var(${partyVar(c.party)})"><span class="yb-box" aria-hidden="true"></span>
          <span class="bp-who">${nameHtml(c)}${atl && c.party_label === label ? "" : partyLabel(c)}</span></li>`).join("")}</ol>
      </div>`;
    const paper = drawn
      ? `<div class="yb-lc-scroll" tabindex="0" role="group" aria-label="Mock-up of the Legislative Council ballot paper for ${escapeHtml(entry.name)} Region (scrolls sideways)">
          <div class="yb-lc">
            <div class="yb-lc-cols">${groups.map((g) => col(g.group, g.label, g.party || "OTH", g.members, true)).join("")}
              ${loose.length ? col("", "Ungrouped", "IND", loose, false) : ""}</div>
          </div></div>`
      : `<div class="yb-paper">${pendingNote}<ul class="bp-list bp-cols">${loose.map((c) => `<li><span class="bp-who">${nameHtml(c)}${partyLabel(c)}</span></li>`).join("")}</ul></div>`;
    return `<section class="card yb-house" aria-labelledby="yb-lc-h">
      <div class="card-head"><h2 id="yb-lc-h">Legislative Council</h2><span class="muted small">${escapeHtml(entry.name)} Region · ${entry.vacancies || 5} members · ${entry.candidates.length} candidates${drawn ? ` in ${groups.length} groups${loose.length ? ` and ${loose.length} ungrouped` : ""}` : ""}</span></div>
      <p class="yb-paper-kicker">Mock-up, not an official ballot paper</p>
      <p class="yb-paper-title">Legislative Council<span>${escapeHtml(entry.name)} Region</span></p>
      ${drawn ? `<div class="yb-lc-key small"><span><strong>Above the line:</strong> one box per group (the top row)</span><span><strong>Below the line:</strong> one box per candidate (the columns)</span><span>Number at least 5 boxes on one side</span></div>` : ""}
      ${paper}
      <div class="yb-grid yb-grid-lc">
        ${htvPanel(region.id)}
        <div class="yb-rules"><h3>For your Council vote to count</h3>${RULES.lc.text()}
          <p class="muted small">The VEC's guide: <a href="${escapeHtml(RULES.lc.url)}" target="_blank" rel="noopener">how to fill out state ballot papers ↗</a></p></div>
      </div>
    </section>`;
  }

  /* ---------- The page ---------- */
  async function render() {
    const id = hashId();
    const d = districts.find((x) => x.id === id);
    const view = $("yb-view");
    $("yb-district").value = d ? d.id : "";
    if (!d) {
      document.title = "Your ballot · Vic Election 2026";
      $("yb-title").textContent = "Your ballot";
      view.innerHTML = id ? `<p class="empty">No district called “${escapeHtml(id)}”. Choose one above.</p>` : "";
      document.documentElement.classList.remove("has-hash");
      return;
    }
    const entry = vec && vec.districts && vec.districts[d.id];
    const region = regions[d.region];
    const rEntry = vec && vec.regions && vec.regions[d.region];
    document.title = `Your ballot: ${d.name} · Vic Election 2026`;
    $("yb-title").textContent = `Your ballot: ${d.name}`;
    if (!entry) {
      view.innerHTML = '<p class="empty">The VEC\'s list of candidates isn\'t loaded yet.</p>';
      return;
    }
    await Promise.all([loadHtv(d.id), loadHtv(d.region)]);
    if (hashId() !== id) return;   // the reader moved on while the cards loaded
    view.innerHTML = `
      <div class="yb-actions card-actions">
        <a class="icon-btn" href="lower.html#${escapeHtml(d.id)}">${escapeHtml(d.name)} seat page</a>
        <button class="icon-btn" type="button" id="yb-print">Print</button>
        <button class="icon-btn" type="button" id="yb-share" title="Share or download a 1200x630 image of this ballot paper">Share image</button>
      </div>
      <p class="yb-voters small">If you are enrolled in ${escapeHtml(d.name)} District, you vote for 1 member of the Legislative Assembly
        for ${escapeHtml(d.name)} and 5 members of the Legislative Council for ${escapeHtml(region ? region.name : d.region)} Region.
        Check your enrolment and district with the <a href="https://www.vec.vic.gov.au/enrolment/check-my-enrolment" target="_blank" rel="noopener">VEC ↗</a>.</p>
      ${assembly(d, entry)}
      ${region && rEntry ? council(region, rEntry) : '<p class="empty">The Council ballot for this region isn\'t loaded yet.</p>'}
      <p class="muted small yb-src">Candidates, ballot order and party names as printed, from the
        <a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener">VEC's nominations for ${escapeHtml(d.name)}</a>${rEntry ? ` and <a href="${escapeHtml(rEntry.url)}" target="_blank" rel="noopener">${escapeHtml(rEntry.name)} Region</a>` : ""}
        (nominations closed noon Mon 9 Nov 2026; the ballot draw was at 4 pm). The real ballot papers' layout, wording and design differ;
        follow the instructions printed on them. This site recommends no candidate or party.</p>`;
    $("yb-print").addEventListener("click", () => window.print());
    App.ShareCard.shareButton($("yb-share"), async () => App.ShareCard.ballotCard({ district: d, entry, regionEntry: rEntry }));
  }

  async function init() {
    try {
      const first = hashId();
      const [dd, rd, vecData] = await Promise.all([
        loadJSON("districts"), loadJSON("regions"),
        loadJSON("vec_nominations").catch(() => null),
        first ? loadHtv(first) : null,   // the district's cards alongside (its region's follow in render)
      ]);
      districts = dd.districts.slice().sort((a, b) => a.name.localeCompare(b.name));
      rd.regions.forEach((r) => { regions[r.id] = r; });
      vec = vecData;
      const sel = $("yb-district");
      districts.forEach((d) => sel.add(new Option(d.name, d.id)));
      sel.addEventListener("change", () => { location.hash = sel.value; if (!sel.value) render(); });
      window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
      render();
    } catch (err) {
      App.showError($("yb-view"), err);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
