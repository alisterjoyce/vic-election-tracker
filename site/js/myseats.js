/* My seats: the watchlist (localStorage) as a comparison table. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyBadge, fmtPrice } = App;

  let data = null;

  function favourite(odds, id) {
    const s = odds && (odds.seats || []).find((x) => x.district === id);
    if (!s) return '<span class="muted">not recorded</span>';
    if (s.favourite) {
      const who = s.favourite_candidate ? `${escapeHtml(s.favourite_candidate)} (Ind)` : partyBadge(s.favourite, { full: false });
      return `${who} ${fmtPrice(s.price)}`;
    }
    if (s.joint_favourites) return `${s.joint_favourites.map((p) => partyBadge(p, { full: false })).join(" / ")} ${fmtPrice(s.price)}`;
    if (s.partial) return '<span class="muted">partial</span>';
    return '<span class="muted">not recorded</span>';
  }

  function mrp(models, id) {
    const m = models && (models.models || []).find((x) => x.published);
    const e = m && (models.seats || []).find((x) => x.district === id && x.model === m.id);
    return e && e.winner ? partyBadge(e.winner, { full: false }) : '<span class="muted">not published</span>';
  }

  function render() {
    const el = document.getElementById("my-seats");
    const ids = App.getWatchlist();
    document.getElementById("clear-all").hidden = !ids.length;
    if (!data) return;
    const byId = Object.fromEntries(data.districts.map((d) => [d.id, d]));
    const seats = ids.map((id) => byId[id]).filter(Boolean);
    if (!seats.length) {
      el.innerHTML = '<p class="empty">No seats starred yet. Open a district on the <a href="lower.html">lower house page</a> and tap ☆ to add it here.</p>';
      return;
    }
    const oddsDate = data.odds && data.odds.date_checked ? ` (as at ${escapeHtml(App.fmtDate(data.odds.date_checked))})` : "";
    const mrpModel = data.models && (data.models.models || []).find((x) => x.published);
    el.innerHTML = `
      <table>
        <thead><tr>
          <th><span class="sr-only">Remove</span></th><th>District</th><th>Held by</th><th class="num">Margin</th>
          <th>Swing-adjusted</th><th>${escapeHtml(mrpModel ? mrpModel.name : "MRP")}</th><th>Betting favourite${oddsDate}</th>
        </tr></thead>
        <tbody>
          ${seats.map((d) => {
            const adj = App.swingAdjusted(d.margin, data.swing);
            return `<tr>
              <td class="star-cell">${App.starButton(d.id, d.name)}</td>
              <td><a href="lower.html#${escapeHtml(d.id)}">${escapeHtml(d.name)}</a>
                <div class="muted small">${escapeHtml(data.regions[d.region] || "")}${d.retiring ? " · MP retiring" : ""}</div></td>
              <td>${partyBadge(d.party, { full: false })}</td>
              <td class="num">${d.margin && d.margin.pct != null ? escapeHtml(App.fmtMargin(d.margin.party, d.margin.pct)) : "–"}</td>
              <td>${adj ? `${partyBadge(adj.winner, { full: false })} ${escapeHtml(adj.after.split(" ").pop())}` : '<span class="muted small">n/a</span>'}</td>
              <td>${mrp(data.models, d.id)}</td>
              <td>${favourite(data.odds, d.id)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
  }

  async function init() {
    if (!App.storageWorks()) document.getElementById("storage-banner").hidden = false;
    document.getElementById("clear-all").addEventListener("click", () => {
      if (window.confirm("Remove all starred seats?")) App.setWatchlist([]);
    });
    document.addEventListener("watchlistchange", render);
    render();
    try {
      const optional = (n) => loadJSON(n).catch(() => null);
      const [dd, rd, meta, polls, models, odds] = await Promise.all([
        loadJSON("districts"), loadJSON("regions"), optional("meta"), optional("polls"),
        optional("seat_models"), optional("seat_odds"),
      ]);
      data = {
        districts: dd.districts,
        regions: Object.fromEntries(rd.regions.map((r) => [r.id, r.name])),
        swing: App.statewideSwing(meta, polls),
        models, odds,
      };
      render();
    } catch (err) {
      App.showError(document.getElementById("my-seats"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
