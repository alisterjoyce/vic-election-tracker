/* Upper house page: pick one of the 8 regions (via #region-id), show MLCs and tickets. */
(function () {
  "use strict";
  const { loadJSON, escapeHtml, partyName, partyVar, partyBadge, statusBadge, hashId, copyLink } = window.App;

  let regions = [];
  let districts = [];

  function ticketSort(a, b) {
    const wa = a.status === "withdrawn", wb = b.status === "withdrawn";
    if (wa !== wb) return wa ? 1 : -1;
    // Drawn groups (A, B, ... AA) first in ballot order, then undrawn by party.
    if (a.group && b.group) return a.group.length - b.group.length || a.group.localeCompare(b.group);
    if (a.group || b.group) return a.group ? -1 : 1;
    return partyName(a.party).localeCompare(partyName(b.party));
  }

  function renderChips(current) {
    document.getElementById("region-chips").innerHTML = regions.map((r) =>
      `<button type="button" class="chip" data-id="${escapeHtml(r.id)}" aria-pressed="${r.id === current}">${escapeHtml(r.name)}</button>`
    ).join("");
  }

  function renderDetail(r) {
    const el = document.getElementById("region-detail");
    if (!r) {
      el.innerHTML = '<div class="card"><p class="empty">Choose a region above.</p></div>';
      document.title = "Upper House Regions · Vic Election 2026";
      return;
    }
    document.title = `${r.name} Region · Vic Election 2026`;
    const inRegion = districts.filter((d) => d.region === r.id).sort((a, b) => a.name.localeCompare(b.name));
    const tickets = (r.tickets || []).slice().sort(ticketSort);

    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>${escapeHtml(r.name)}</h2>
          <button class="icon-btn" type="button" id="copy-link">Copy link</button>
        </div>
        <p class="muted small" style="margin-top:0">${r.area === "regional" ? "Regional" : "Metropolitan"} region · 5 members</p>
        <h3>Current MLCs</h3>
        ${(r.mlcs || []).length ? `
          <ul class="people">
            ${r.mlcs.map((m) => `
              <li>
                <span class="name">${escapeHtml(m.name)}</span>
                ${partyBadge(m.party)}
                ${m.notes ? `<span class="muted small">${escapeHtml(m.notes)}</span>` : ""}
              </li>`).join("")}
          </ul>` : '<p class="empty">No members recorded.</p>'}
      </div>

      <div class="card">
        <div class="card-head"><h2>2026 tickets</h2><span class="muted small">${tickets.length} group${tickets.length === 1 ? "" : "s"}</span></div>
        ${tickets.length ? `
          <div class="tickets">
            ${tickets.map((t) => `
              <div class="ticket${t.status === "withdrawn" ? " is-withdrawn" : ""}" style="--party-color: var(${partyVar(t.party)})">
                <div class="ticket-head">
                  <strong>${t.group ? `Group ${escapeHtml(t.group)} · ` : ""}${escapeHtml(partyName(t.party))}</strong>
                  ${statusBadge(t.status)}
                </div>
                <ol>${(t.candidates || []).map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ol>
              </div>`).join("")}
          </div>` : '<p class="empty">No tickets recorded yet.</p>'}
      </div>

      <div class="card">
        <h2>Districts in this region</h2>
        ${inRegion.length ? `<div class="chips">${inRegion.map((d) =>
          `<a class="chip" href="lower.html#${escapeHtml(d.id)}" style="text-decoration:none">${escapeHtml(d.name)}</a>`).join("")}</div>`
          : '<p class="empty">No districts in the dataset for this region yet.</p>'}
      </div>`;
    document.getElementById("copy-link").addEventListener("click", (e) => copyLink(e.currentTarget));
  }

  function onHashChange() {
    const id = hashId();
    const r = regions.find((x) => x.id === id);
    renderChips(r ? r.id : "");
    renderDetail(r);
  }

  async function init() {
    try {
      const [rd, dd] = await Promise.all([loadJSON("regions"), loadJSON("districts")]);
      regions = rd.regions.slice().sort((a, b) => a.name.localeCompare(b.name));
      districts = dd.districts;
      document.getElementById("region-chips").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-id]");
        if (btn) location.hash = btn.dataset.id;
      });
      window.addEventListener("hashchange", onHashChange);
      onHashChange();
    } catch (err) {
      window.App.showError(document.getElementById("region-detail"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
