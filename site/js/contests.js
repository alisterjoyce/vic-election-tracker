/* Key contests (contests.html): the seats where the sources favour different winners, or no candidate's median
   chance reaches CLOSE, each with the seat page's forecast comparison (App.Forecasts). Closest first, by the
   leading candidate's median chance. A seat's 2022 final pair is fetched only when its card nears the screen. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyShort } = App;
  const $ = (id) => document.getElementById(id);
  const CLOSE = 60;   // a leader's median chance under this counts as close

  let contests = [];

  function card(x) {
    const { d, b } = x;
    const m = d.margin || {};
    const tags = [b.split ? '<span class="contest-tag">Sources favour different winners</span>' : "",
      b.topMed != null && b.topMed < CLOSE ? `<span class="contest-tag">Leader's median chance ${b.topMed.toFixed(1)}%</span>` : ""].join("");
    return `<section class="card contest" id="contest-${escapeHtml(d.id)}" data-kind="${b.split ? "split" : ""} ${b.topMed != null && b.topMed < CLOSE ? "close" : ""}" aria-labelledby="ch-${escapeHtml(d.id)}">
      <div class="card-head"><h2 id="ch-${escapeHtml(d.id)}"><a href="lower.html#${escapeHtml(d.id)}">${escapeHtml(d.name)}</a></h2>
        <span class="muted small">${escapeHtml(x.region)}${d.party ? ` · held by ${escapeHtml(App.partyName(d.party))}` : ""}${m.pct != null ? ` · margin ${escapeHtml(App.fmtMargin(m.party, m.pct))}${m.vs ? ` v ${escapeHtml(partyShort(m.vs))}` : ""}` : ""}</span></div>
      <p class="contest-tags">${tags}</p>
      ${b.html}
    </section>`;
  }

  function render() {
    const f = $("contests-filter").value;
    const shown = contests.filter((x) => !f || (f === "split" ? x.b.split : x.b.topMed != null && x.b.topMed < CLOSE));
    $("contests-count").textContent = `${shown.length} of 88 seats`;
    $("contests-jump").innerHTML = shown.map((x) => `<li><a href="#contest-${escapeHtml(x.d.id)}">${escapeHtml(x.d.name)}</a></li>`).join("");
    $("contests-list").innerHTML = shown.length ? shown.map(card).join("") : '<p class="empty">No seat matches.</p>';
    // The 2022 final pair, per card, once it nears the screen (each results file is a seat's full 2022 count).
    const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const x = contests.find((c) => `contest-${c.d.id}` === e.target.id);
      if (x) App.Forecasts.fillFinal2022(x.d, e.target);
    }), { rootMargin: "400px 0px" }) : null;
    $("contests-list").querySelectorAll(".contest").forEach((el) => {
      if (io) io.observe(el);
      else { const x = contests.find((c) => `contest-${c.d.id}` === el.id); if (x) App.Forecasts.fillFinal2022(x.d, el); }
    });
  }

  async function init() {
    try {
      const [dd, rd, models, odds, noms] = await Promise.all([loadJSON("districts"), loadJSON("regions"),
        loadJSON("seat_models"), loadJSON("seat_odds").catch(() => null), loadJSON("vec_nominations").catch(() => null)]);
      const regionName = Object.fromEntries(rd.regions.map((r) => [r.id, `${r.name} Region`]));
      contests = dd.districts.map((d) => {
        const cands = ((noms && noms.districts && noms.districts[d.id] && noms.districts[d.id].candidates) || []).slice();
        return { d, region: regionName[d.region] || "", b: App.Forecasts.build(d, { models, odds, cands }) };
      }).filter((x) => x.b.split || (x.b.topMed != null && x.b.topMed < CLOSE))
        .sort((a, b) => (a.b.topMed ?? 0) - (b.b.topMed ?? 0) || a.d.name.localeCompare(b.d.name));
      $("contests-filter").addEventListener("change", render);
      render();
      // A link to one seat (contests.html#melton or #contest-melton): scroll to its card once drawn.
      const id = decodeURIComponent(location.hash.slice(1)).replace(/^contest-/, "");
      const target = id && document.getElementById(`contest-${id}`);
      if (target) target.scrollIntoView();
    } catch (err) {
      App.showError($("contests-list"), err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
