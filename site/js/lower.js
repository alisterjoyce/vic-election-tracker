/* Lower house page: filter districts, show the selected one (selected via #district-id). */
(function () {
  "use strict";
  const { loadJSON, escapeHtml, partyBadge, partyShort, statusBadge, fmtDate, hashId, copyLink } = window.App;

  // Strongest confirmation first.
  const STATUS_RANK = ["vec_nominated", "endorsed", "reported", "announced"];

  let districts = [];
  let candidates = [];
  let regionsById = {};

  const $ = (id) => document.getElementById(id);

  function marginLabel(pct) {
    if (pct == null) return "";
    if (pct < 6) return "Marginal";
    if (pct < 10) return "Fairly safe";
    return "Safe";
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
        <thead><tr><th>District</th><th>Region</th><th>Held by</th><th class="num">Margin</th><th>Seat</th></tr></thead>
        <tbody>
          ${list.map((d) => `
            <tr class="clickable${d.id === current ? " selected" : ""}" data-id="${escapeHtml(d.id)}">
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
        <h2>${escapeHtml(d.name)}</h2>
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
      ${d.notes ? `<p>${escapeHtml(d.notes)}</p>` : ""}
      ${d.region_note ? `<p class="muted small">${escapeHtml(d.region_note)}</p>` : ""}
      <h3>Candidates</h3>
      ${cands.length ? `
        <ul class="people">
          ${cands.map((c) => `
            <li class="${isInactive(c) ? "is-withdrawn" : ""}">
              ${anyBallot ? `<span class="pos" title="Ballot position">${c.ballot_position ?? "–"}</span>` : ""}
              <span class="name">${escapeHtml(c.name)}${c.incumbent ? ' <span class="muted small">(sitting MP)</span>' : ""}</span>
              ${partyBadge(c.party)}
              ${statusBadge(c.status)}
              ${c.source_url ? `<a class="small" href="${escapeHtml(c.source_url)}" rel="noopener">source</a>` : ""}
              ${c.notes ? `<span class="note muted small">${escapeHtml(c.notes)}</span>` : ""}
            </li>`).join("")}
        </ul>
        <p class="muted small" style="margin-top:8px">Last checked ${escapeHtml(fmtDate(cands.map((c) => c.updated).filter(Boolean).sort().pop()))}</p>`
        : '<p class="empty">No candidates recorded yet.</p>'}`;
    $("copy-link").addEventListener("click", (e) => copyLink(e.currentTarget));
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
      const [dd, cd, rd] = await Promise.all([loadJSON("districts"), loadJSON("candidates"), loadJSON("regions")]);
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
        if (row && !e.target.closest("a")) location.hash = row.dataset.id;
      });
      window.addEventListener("hashchange", onHashChange);
      onHashChange();
    } catch (err) {
      window.App.showError($("district-list"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
