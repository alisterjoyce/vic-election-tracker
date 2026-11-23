/* Voting page (voting.html): the district picker, linked to each seat page's "Where to vote" section, and every
   district's count of early and election-day voting centres (data/voting_centres/index.json, scripts/vec_voting.py).
   The rest of the page is static text from the VEC's pages, each linked where it is used. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml } = App;
  const $ = (id) => document.getElementById(id);
  const seatHref = (id) => `lower.html#${encodeURIComponent(id)}/where-to-vote`;

  async function init() {
    const sel = $("vote-district"), go = $("vote-go");
    try {
      const [dd, vc] = await Promise.all([loadJSON("districts"), loadJSON("voting_centres/index").catch(() => null)]);
      const districts = dd.districts.slice().sort((a, b) => a.name.localeCompare(b.name));
      sel.insertAdjacentHTML("beforeend", districts.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join(""));
      const update = () => {
        go.href = sel.value ? seatHref(sel.value) : "lower.html";
        go.setAttribute("aria-disabled", String(!sel.value));
      };
      sel.addEventListener("change", () => { update(); if (sel.value) go.focus(); });
      update();
      const counts = (vc && vc.districts) || {};
      const asAt = vc && vc.source && vc.source.spreadsheet_as_at;
      $("vote-all").innerHTML = `<div class="table-scroll"><table>
          <thead><tr><th>District</th><th class="num">Early voting centres</th><th class="num">Election-day centres</th></tr></thead>
          <tbody>${districts.map((d) => {
            const c = counts[d.id] || {};
            return `<tr><td><a href="${seatHref(d.id)}">${escapeHtml(d.name)}</a></td><td class="num">${c.early ?? "–"}</td><td class="num">${c.election_day ?? "–"}</td></tr>`;
          }).join("")}</tbody></table></div>
        <p class="muted small">Counts include centres shared with a neighbouring district. From the VEC's venues spreadsheet${asAt ? ` (as at ${escapeHtml(asAt)})` : ""}, read once a day.</p>`;
    } catch (err) {
      App.showError($("vote-all"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
