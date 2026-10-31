/* Leaflet maps: the home choropleth (with metro inset) and the seat-page booth map.
   Boundaries: data/geo/*.geojson (scripts/build_boundaries.py). Booth results use the
   vec-contest-v1 format (scripts/results_format.py), shared by 2022 history and the 2026 feed.
   No tile layer: polygons are drawn on the page background in the site palette. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyName, partyShort, partyColor, cssVar, fmtPrice } = App;

  const ATTRIBUTION = 'Boundaries: <a href="https://discover.data.vic.gov.au/dataset/vicmap-admin">Vicmap</a> © State of Victoria (CC BY 4.0)';
  const METRO_BOUNDS = [[-38.12, 144.62], [-37.55, 145.42]];
  const BAND_OPACITY = { "Marginal": 0.35, "Safe": 0.65, "Very Safe": 0.95 };

  const geoCache = {};
  function loadGeo(name) {
    if (!geoCache[name]) {
      geoCache[name] = fetch(`data/geo/${name}.geojson`, { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`${name}.geojson: HTTP ${r.status}`);
        return r.json();
      }).catch((err) => { delete geoCache[name]; throw err; });
    }
    return geoCache[name];
  }

  function baseMap(el, opts = {}) {
    const map = L.map(el, {
      zoomSnap: 0.25, scrollWheelZoom: false, attributionControl: opts.attribution !== false,
      zoomControl: opts.zoomControl !== false, preferCanvas: false,
    });
    if (opts.attribution !== false) map.attributionControl.setPrefix(false).addAttribution(ATTRIBUTION);
    return map;
  }

  /* ---------------- Home choropleth ---------------- */
  // Each mode returns {color, opacity, label} for a district, and its legend entries.
  function bandOf(d) {
    const c = d.classification || "";
    return Object.keys(BAND_OPACITY).find((b) => c.startsWith(b)) || null;
  }

  const MODES = {
    holder: {
      label: "Held by",
      style: (d) => ({ code: d.party, opacity: 0.85, text: partyName(d.party) }),
      legend: (ds) => [...new Set(ds.map((d) => d.party))].map((p) => ({ code: p, text: partyName(p) })),
    },
    margin: {
      label: "Margin",
      style: (d) => {
        const band = bandOf(d);
        const m = d.margin || {};
        return { code: m.party || d.party, opacity: BAND_OPACITY[band] || 0.5,
                 text: `${d.classification || "–"}${m.pct != null ? ` (${partyShort(m.party)} ${Number(m.pct).toFixed(1)})` : ""}` };
      },
      legend: () => Object.entries(BAND_OPACITY).map(([b, o]) => ({ code: "OTH", opacity: o, text: b, neutral: true })),
    },
    odds: {
      label: "Betting favourite",
      style: (d, ctx) => {
        const s = ctx.odds[d.id];
        if (!s) return { code: null, opacity: 0.15, text: "not recorded" };
        if (s.favourite) return { code: s.favourite, opacity: 0.85, text: `${partyName(s.favourite)} ${fmtPrice(s.price)}` };
        if (s.joint_favourites) return { code: "OTH", opacity: 0.45, text: `Joint: ${s.joint_favourites.map(partyShort).join(" / ")} ${fmtPrice(s.price)}`, joint: true };
        return { code: null, opacity: 0.15, text: "partial market" };
      },
      legend: (ds, ctx) => {
        const codes = [...new Set(ds.map((d) => ctx.odds[d.id] && ctx.odds[d.id].favourite).filter(Boolean))];
        const items = codes.map((p) => ({ code: p, text: partyName(p) }));
        if (ds.some((d) => ctx.odds[d.id] && ctx.odds[d.id].joint_favourites)) items.push({ code: "OTH", opacity: 0.45, text: "Joint favourites" });
        return items;
      },
    },
    result: {
      label: "Result",
      style: (d, ctx) => {
        const r = ctx.results && ctx.results[d.id];
        return r ? { code: r.leader, opacity: r.declared ? 0.9 : 0.55, text: r.text } : { code: null, opacity: 0.12, text: "no results yet" };
      },
      legend: () => [],
    },
  };

  function regionStyle(r) {
    const counts = {};
    (r.mlcs || []).forEach((m) => { counts[m.party] = (counts[m.party] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const lead = sorted[0] && (!sorted[1] || sorted[0][1] > sorted[1][1]) ? sorted[0][0] : null;
    return { code: lead, opacity: lead ? 0.6 : 0.25,
             text: sorted.map(([p, n]) => `${partyShort(p)} ${n}`).join(", ") || "–" };
  }

  async function homeMap(root) {
    const mainEl = root.querySelector("[data-map=main]");
    const insetEl = root.querySelector("[data-map=inset]");
    const legendEl = root.querySelector("[data-map=legend]");
    const optional = (n) => loadJSON(n).catch(() => null);
    const [dGeo, rGeo, dd, rd, odds, res2026] = await Promise.all([
      loadGeo("districts"), loadGeo("regions"), loadJSON("districts"), loadJSON("regions"),
      optional("seat_odds"), optional("results_2026/index"),
    ]);
    const districts = Object.fromEntries(dd.districts.map((d) => [d.id, d]));
    const regions = Object.fromEntries(rd.regions.map((r) => [r.id, r]));
    const ctx = {
      odds: Object.fromEntries(((odds && odds.seats) || []).map((s) => [s.district, s])),
      results: res2026 && res2026.districts && Object.keys(res2026.districts).length ? res2026.districts : null,
    };
    let mode = "holder";
    let layerKind = "districts";

    // "Result" stays disabled until a 2026 results index exists.
    const resultBtn = root.querySelector('[data-mode="result"]');
    if (resultBtn && !ctx.results) {
      resultBtn.disabled = true;
      resultBtn.title = "Available once counting starts on 28 Nov 2026";
    }

    const main = baseMap(mainEl);
    const inset = baseMap(insetEl, { attribution: false, zoomControl: false });
    inset.dragging.disable(); inset.doubleClickZoom.disable(); inset.boxZoom.disable(); inset.keyboard.disable();
    let layers = [];

    function featureStyle(feature) {
      const kind = layerKind;
      const s = kind === "regions" ? regionStyle(regions[feature.properties.id] || {})
        : MODES[mode].style(districts[feature.properties.id] || {}, ctx);
      return {
        color: cssVar("--surface") || "#fff", weight: kind === "regions" ? 1.5 : 0.8,
        fillColor: s.code ? partyColor(s.code) : cssVar("--border"), fillOpacity: s.opacity,
        dashArray: s.joint ? "3 3" : null,
      };
    }

    function tooltipFor(feature) {
      const id = feature.properties.id;
      if (layerKind === "regions") {
        const r = regions[id] || {};
        return `<strong>${escapeHtml(feature.properties.name)}</strong><br>Current MLCs: ${escapeHtml(regionStyle(r).text)}`;
      }
      const d = districts[id] || {};
      const s = MODES[mode].style(d, ctx);
      return `<strong>${escapeHtml(d.name || feature.properties.name)}</strong><br>${escapeHtml(MODES[mode].label)}: ${escapeHtml(s.text)}`;
    }

    function addLayer(map, geo) {
      const layer = L.geoJSON(geo, {
        style: featureStyle,
        onEachFeature: (feature, lyr) => {
          lyr.bindTooltip(() => tooltipFor(feature), { sticky: true, direction: "top", className: "map-tip" });
          lyr.on({
            mouseover: () => lyr.setStyle({ weight: 2.5, color: cssVar("--text") }),
            mouseout: () => layer.resetStyle(lyr),
            click: () => {
              const id = feature.properties.id;
              location.href = layerKind === "regions" ? `upper.html#${id}` : `lower.html#${id}`;
            },
          });
        },
      }).addTo(map);
      return layer;
    }

    function render() {
      layers.forEach(([map, l]) => map.removeLayer(l));
      const geo = layerKind === "regions" ? rGeo : dGeo;
      layers = [[main, addLayer(main, geo)], [inset, addLayer(inset, geo)]];
      renderLegend();
    }

    function restyle() {
      layers.forEach(([, l]) => l.setStyle(featureStyle));
      renderLegend();
    }

    function renderLegend() {
      let items;
      if (layerKind === "regions") {
        items = [...new Set(rd.regions.map((r) => regionStyle(r).code).filter(Boolean))]
          .map((p) => ({ code: p, text: `${partyName(p)} plurality`, opacity: 0.6 }));
        items.push({ code: null, text: "Tied", opacity: 0.25 });
      } else {
        items = MODES[mode].legend(Object.values(districts), ctx);
      }
      legendEl.innerHTML = items.map((it) => `<li><span class="swatch" style="background:${it.code ? `var(${App.partyVar(it.code)})` : "var(--border)"};opacity:${it.opacity ?? 0.85}"></span>${escapeHtml(it.text)}</li>`).join("")
        + (layerKind === "districts" && mode === "odds" && odds && odds.date_checked ? `<li class="muted">Sportsbet, as at ${escapeHtml(App.fmtDate(odds.date_checked))}</li>` : "");
    }

    // Most districts are too small to see at state zoom. Desktop shows the state with a Melbourne inset;
    // phones (no room for an inset) open on greater Melbourne, with a button for the whole state.
    const phone = window.matchMedia("(max-width: 640px)");
    const viewBtn = root.querySelector("[data-map-view]");
    const stateBounds = L.geoJSON(dGeo).getBounds();
    let showState = !phone.matches;
    function setView() {
      main.fitBounds(showState ? stateBounds : METRO_BOUNDS, { padding: [8, 8] });
      if (viewBtn) {
        viewBtn.textContent = showState ? "Show Melbourne" : "Show all Victoria";
        viewBtn.setAttribute("aria-pressed", String(showState));
      }
    }
    if (viewBtn) viewBtn.addEventListener("click", () => { showState = !showState; setView(); });
    phone.addEventListener("change", () => {
      showState = !phone.matches;
      main.invalidateSize(); inset.invalidateSize();
      setView(); inset.fitBounds(METRO_BOUNDS);
    });
    setView();
    inset.fitBounds(METRO_BOUNDS);
    render();

    root.querySelectorAll("[data-mode]").forEach((btn) => btn.addEventListener("click", () => {
      if (btn.disabled) return;
      mode = btn.dataset.mode;
      layerKind = "districts";
      root.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      root.querySelectorAll("[data-layer]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layer === "districts")));
      render();
    }));
    root.querySelectorAll("[data-layer]").forEach((btn) => btn.addEventListener("click", () => {
      layerKind = btn.dataset.layer;
      root.querySelectorAll("[data-layer]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      root.querySelectorAll("[data-mode]").forEach((b) => { if (!b.disabled) b.toggleAttribute("data-dim", layerKind === "regions"); });
      render();
    }));
    document.addEventListener("themechange", restyle);
    window.addEventListener("resize", () => { main.invalidateSize(); inset.invalidateSize(); });
  }

  /* ---------------- Seat page: booth map ---------------- */
  let boothMapInstance = null;

  function share(n, total) {
    return total ? (100 * n) / total : 0;
  }

  // Returns null if the container left the page while the boundaries loaded (the user
  // switched seats): a map on a detached, zero-size container has no valid view, and
  // Leaflet then throws when the boundary is added.
  async function boothMap(el, districtId, contest) {
    const geo = await loadGeo("districts");
    if (!el.isConnected) return null;
    if (boothMapInstance) { boothMapInstance.remove(); boothMapInstance = null; }
    const feature = geo.features.find((f) => f.properties.id === districtId);
    const map = baseMap(el);
    boothMapInstance = map;
    const cand = Object.fromEntries(contest.candidates.map((c) => [c.id, c]));
    const placed = contest.polling_places.filter((p) => p.lat != null && p.lon != null);

    // Leaflet needs a view before vector layers are added.
    if (feature) map.fitBounds(L.geoJSON(feature).getBounds(), { padding: [10, 10] });
    else if (placed.length) map.fitBounds(L.latLngBounds(placed.map((p) => [p.lat, p.lon])), { padding: [20, 20] });
    else map.setView([-37.8, 145], 8);
    if (feature) {
      L.geoJSON(feature, { style: { color: cssVar("--text"), weight: 1.5, fillColor: cssVar("--surface-2"), fillOpacity: 0.6 }, interactive: false }).addTo(map);
    }
    const maxTotal = Math.max(1, ...placed.map((p) => p.total || 0));
    placed.forEach((p) => {
      let lead = null, tcpText = "";
      if (p.tcp) {
        const entries = Object.entries(p.tcp);
        const sum = entries.reduce((a, [, v]) => a + (v || 0), 0);
        lead = entries.sort((a, b) => b[1] - a[1])[0];
        tcpText = entries.map(([id, v]) => `${escapeHtml(cand[id] ? cand[id].name : id)} (${escapeHtml(partyShort(cand[id] && cand[id].party))}): ${v} (${share(v, sum).toFixed(1)}%)`).join("<br>");
      }
      const party = lead && cand[lead[0]] ? cand[lead[0]].party : null;
      const fpRows = Object.entries(p.first_preferences || {}).sort((a, b) => b[1] - a[1])
        .map(([id, v]) => `<tr><td>${escapeHtml(cand[id] ? cand[id].name : id)}</td><td>${escapeHtml(partyShort(cand[id] && cand[id].party))}</td><td class="num">${v}</td><td class="num">${share(v, p.formal).toFixed(1)}%</td></tr>`).join("");
      const radius = 4 + 14 * Math.sqrt((p.total || 0) / maxTotal);
      const m = L.circleMarker([p.lat, p.lon], {
        radius, weight: 1, color: cssVar("--surface") || "#fff",
        fillColor: party ? partyColor(party) : cssVar("--p-oth"), fillOpacity: 0.85,
      }).addTo(map);
      m.bindPopup(`<div class="booth-pop"><strong>${escapeHtml(p.name)}</strong>
        <div class="muted small">${escapeHtml((p.classification || "").replace(/([a-z])([A-Z])/g, "$1 $2"))} · ${p.total ?? "–"} votes${p.informal != null ? `, ${p.informal} informal` : ""}</div>
        <div class="booth-tcp">${tcpText ? `<strong>2CP</strong><br>${tcpText}` : '<span class="muted">2CP not available</span>'}</div>
        ${fpRows ? `<table class="booth-fp"><thead><tr><th>First preferences</th><th></th><th class="num">Votes</th><th class="num">%</th></tr></thead><tbody>${fpRows}</tbody></table>` : ""}</div>`,
        { maxWidth: 340 });
      m.bindTooltip(escapeHtml(p.name), { direction: "top" });
    });
    return { placed: placed.length, total: contest.polling_places.length };
  }

  /* ---------------- Find my seat: the district containing a point ---------------- */
  // Ray casting over every ring (outer rings and holes alike), so holes come out right.
  function inRings(rings, x, y) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  async function districtAt(lat, lon) {
    const geo = await loadGeo("districts");
    const hit = geo.features.find((f) => {
      const g = f.geometry;
      if (!g) return false;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      return polys.some((rings) => inRings(rings, lon, lat));
    });
    return hit ? hit.properties.id : null;
  }

  App.Maps = { homeMap, boothMap, loadGeo, districtAt };
})();
