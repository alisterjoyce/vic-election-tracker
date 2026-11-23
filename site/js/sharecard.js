/* Share cards: 1200x630 PNG images in the current theme's colours, made in the browser.
   Candidate cards are drawn on a canvas (photo or initials, photo credit printed on the card).
   Seat and home-headline cards are built as HTML and rendered with html-to-image (pinned on cdnjs),
   then shared with the Web Share API where the browser supports files, or downloaded. */
(function () {
  "use strict";
  const App = window.App;
  const { escapeHtml, partyName, partyColor, cssVar, initials, inkFor, candidateId, fmtDate } = App;

  const W = 1200, H = 630, FOOT = 64;
  const DISPLAY = '"Archivo", "Inter", system-ui, sans-serif';
  const BODY = '"Inter", system-ui, sans-serif';

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function fontsReady() {
    if (!document.fonts) return;
    try {
      await Promise.all([`800 64px ${DISPLAY}`, `600 32px ${BODY}`, `500 28px ${BODY}`].map((f) => document.fonts.load(f)));
    } catch (e) { /* fall back to system fonts */ }
  }

  // Largest size (down to min) at which text fits maxWidth on at most `lines` lines.
  function fitText(ctx, text, { weight, family, max, min, maxWidth, lines = 1 }) {
    for (let size = max; size >= min; size -= 2) {
      ctx.font = `${weight} ${size}px ${family}`;
      const out = wrap(ctx, text, maxWidth);
      if (out.length <= lines && out.every((l) => ctx.measureText(l).width <= maxWidth)) return { size, lines: out };
    }
    ctx.font = `${weight} ${min}px ${family}`;
    return { size: min, lines: wrap(ctx, text, maxWidth).slice(0, lines) };
  }

  function wrap(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const out = [];
    let line = "";
    words.forEach((w) => {
      const next = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(next).width > maxWidth) { out.push(line); line = w; } else line = next;
    });
    if (line) out.push(line);
    return out;
  }

  function ellipsis(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }

  // Photo (cover-cropped) or initials, clipped to a circle with a party-colour ring.
  function drawFace(ctx, { img, name, party, x, y, r, ring = 8 }) {
    const color = partyColor(party) || cssVar("--p-oth");
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (img) {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = inkFor(party);
      ctx.font = `800 ${Math.round(r * 0.8)}px ${DISPLAY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(name), x, y + r * 0.04);
    }
    ctx.restore();
    if (ring) {
      ctx.beginPath();
      ctx.arc(x, y, r + ring / 2, 0, Math.PI * 2);
      ctx.lineWidth = ring;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }

  function frame(ctx, accent, credit) {
    ctx.fillStyle = cssVar("--surface") || "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 16, H);
    ctx.fillStyle = cssVar("--surface-2") || "#eef1f5";
    ctx.fillRect(16, H - FOOT, W - 16, FOOT);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = cssVar("--text");
    ctx.font = `800 26px ${DISPLAY}`;
    ctx.fillText("Vic Election 2026", 56, H - FOOT / 2);
    const left = 56 + ctx.measureText("Vic Election 2026").width + 32;
    ctx.fillStyle = cssVar("--muted");
    ctx.font = `500 22px ${BODY}`;
    ctx.fillText("Polling day Sat 28 Nov 2026", left, H - FOOT / 2);
    if (credit) {
      ctx.textAlign = "right";
      ctx.font = `500 18px ${BODY}`;
      ctx.fillText(ellipsis(ctx, credit, W - 56 - left - 330), W - 40, H - FOOT / 2);
    }
    ctx.textAlign = "left";
  }

  function kicker(ctx, text, x, y) {
    ctx.fillStyle = cssVar("--muted");
    ctx.font = `600 24px ${BODY}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text.toUpperCase(), x, y);
  }

  /* person: from App.loadPeople(); seat: districts.json row (lower house) or null; shot: headshot or undefined */
  async function drawCandidate(canvas, { person, seat, shot }) {
    await fontsReady();
    const img = shot ? await loadImage(shot.files["320"]) : null;
    const ctx = canvas.getContext("2d");
    const color = partyColor(person.party) || cssVar("--p-oth");
    frame(ctx, color, shot ? `Photo: ${shot.source.credit}` : "");

    drawFace(ctx, { img, name: person.name, party: person.party, x: 250, y: 283, r: 165, ring: 10 });

    const x = 470, maxW = W - x - 56;
    kicker(ctx, person.contesting ? "2026 Victorian state election" : "Victorian Legislative Council", x, 150);

    const nameFit = fitText(ctx, person.name, { weight: 800, family: DISPLAY, max: 76, min: 44, maxWidth: maxW, lines: 2 });
    ctx.fillStyle = cssVar("--text");
    ctx.textBaseline = "alphabetic";
    let y = 150 + 18 + nameFit.size;
    nameFit.lines.forEach((l, i) => { ctx.fillText(l, x, y + i * nameFit.size * 1.05); });
    y += (nameFit.lines.length - 1) * nameFit.size * 1.05 + 58;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 11, y - 12, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cssVar("--text");
    ctx.font = `600 34px ${BODY}`;
    ctx.fillText(ellipsis(ctx, partyName(person.party), maxW - 36), x + 36, y);

    y += 62;
    ctx.font = `500 32px ${BODY}`;
    const where = person.house === "lower" ? person.seatName : `${person.seatName} Region`;
    const role = person.contesting ? `Candidate for ${where}` : `MLC for ${where}`;
    ctx.fillText(ellipsis(ctx, role, maxW), x, y);

    y += 46;
    ctx.fillStyle = cssVar("--muted");
    ctx.font = `500 26px ${BODY}`;
    const bits = [person.house === "lower" ? "Legislative Assembly" : "Legislative Council"];
    if (person.house === "lower" && seat && seat.margin && seat.margin.pct != null) {
      bits.push(`Margin ${App.fmtMargin(seat.margin.party, seat.margin.pct)}${seat.margin.vs ? ` vs ${App.partyShort(seat.margin.vs)}` : ""}`);
    }
    if (person.house === "upper" && person.ticket_position && person.contesting) bits.push(`No. ${person.ticket_position} on the ticket`);
    if (person.incumbent || (person.mlc && person.contesting)) bits.push("Sitting member");
    ctx.fillText(ellipsis(ctx, bits.join(" · "), maxW), x, y);
  }

  /* Preview image plus Download and Share buttons; redraws when the theme changes. */
  function mount(el, { draw, filename, title, url = location.href }) {
    el.innerHTML = `
      <img class="sharecard-preview" alt="${escapeHtml(`Share card: ${title}`)}" width="${W}" height="${H}">
      <div class="card-actions sharecard-actions">
        <a class="icon-btn" data-download download="${escapeHtml(filename)}" href="#" aria-disabled="true">Download image</a>
        <button class="icon-btn" type="button" data-share hidden>Share…</button>
      </div>
      <p class="muted small sharecard-note">The card uses the current ${escapeHtml(App.currentTheme())} theme. Photo credits are printed on the card.</p>`;
    const preview = el.querySelector("img");
    const dl = el.querySelector("[data-download]");
    const shareBtn = el.querySelector("[data-share]");
    const note = el.querySelector(".sharecard-note");
    let blob = null, objectUrl = null;

    async function render() {
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      await draw(canvas);
      blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      if (!blob) return;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      preview.src = objectUrl;
      dl.href = objectUrl;
      dl.removeAttribute("aria-disabled");
      note.textContent = `The card uses the current ${App.currentTheme()} theme. Photo credits are printed on the card.`;
      const file = new File([blob], filename, { type: "image/png" });
      shareBtn.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    }

    shareBtn.addEventListener("click", async () => {
      if (!blob) return;
      try {
        await navigator.share({ files: [new File([blob], filename, { type: "image/png" })], title, url });
      } catch (e) { /* cancelled */ }
    });
    // Drawn once the card is near the screen and the page has painted: it sits below the profile, and drawing
    // takes ~150 ms of main thread on a phone, which would otherwise hold up the page's first paint.
    let drawn = null;
    const go = () => drawn || (drawn = App.afterPaint(render));
    const onTheme = () => {
      if (!el.isConnected) document.removeEventListener("themechange", onTheme);
      else if (drawn) render();
    };
    document.addEventListener("themechange", onTheme);
    if (!("IntersectionObserver" in window)) return go();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); go(); }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return Promise.resolve();
  }

  /* ---------- HTML cards: built as DOM, rendered with html-to-image (seat and home headline) ---------- */
  const today = () => fmtDate(App.melbourneToday());
  const siteLink = (hash = "") => `${App.ROOT.host}${App.ROOT.pathname.replace(/\/$/, "")}/${hash}`.replace(/^\/+/, "");

  // The image needs the fonts inlined: @font-face rules for the self-hosted Latin files (css/style.css),
  // with each file as a data URL.
  const CARD_FONTS = [["Archivo", "600 800", "archivo-latin.woff2"], ["Inter", "400 700", "inter-latin.woff2"]];
  let fontCss = null;
  function embeddedFonts() {
    if (!fontCss) {
      fontCss = Promise.all(CARD_FONTS.map(async ([family, weight, file]) => {
        const blob = await (await fetch(new URL(`fonts/${file}`, App.ROOT))).blob();
        const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
        return `@font-face { font-family: "${family}"; font-weight: ${weight}; font-display: block; src: url(${data}) format("woff2"); }`;
      })).then((faces) => faces.join("\n")).catch(() => "");
    }
    return fontCss;
  }

  async function renderHtmlCard(inner, accent) {
    if (!window.htmlToImage) await App.loadLib("htmlToImage");
    const host = document.createElement("div");
    host.className = "hc-host";
    host.innerHTML = `<div class="hc-card" style="--hc-accent: var(${accent || "--accent"})">${inner}</div>`;
    document.body.append(host);
    try {
      await fontsReady();
      await Promise.all([...host.querySelectorAll("img")].map((img) => (img.decode ? img.decode().catch(() => {}) : null)));
      const fonts = await embeddedFonts();
      return await window.htmlToImage.toBlob(host.firstElementChild, {
        width: W, height: H, pixelRatio: 1, backgroundColor: cssVar("--surface") || "#fff",
        fontEmbedCSS: fonts, skipFonts: !fonts,
      });
    } finally {
      host.remove();
    }
  }

  // Native share sheet where the browser can share files; otherwise a download.
  async function shareOrDownload(blob, { filename, title, url }) {
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title, url });
        return "Shared";
      } catch (e) {
        if (e.name === "AbortError") return null;
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return "Downloaded";
  }

  /* build: async () => {inner, accent, filename, title, url} */
  function shareButton(btn, build) {
    // Start fetching the image library as soon as the button is approached, before the click.
    const warm = () => App.loadLib("htmlToImage").catch(() => {});
    btn.addEventListener("pointerenter", warm, { once: true });
    btn.addEventListener("focus", warm, { once: true });
    // An icon button (.icon-only) keeps its icon and reports progress in its tooltip and accessible name.
    const iconOnly = btn.classList.contains("icon-only");
    const label = iconOnly ? btn.getAttribute("aria-label") : btn.textContent;
    const say = (text) => {
      if (iconOnly) { btn.setAttribute("aria-label", text); btn.title = text; } else btn.textContent = text;
    };
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      say("Making image…");
      let done = null;
      try {
        const card = await build();
        done = await shareOrDownload(await renderHtmlCard(card.inner, card.accent), card);
      } catch (err) {
        console.error(err);
        done = "Couldn't make the image";
      }
      say(done || label);
      setTimeout(() => { say(label); btn.disabled = false; }, done ? 2000 : 0);
    });
  }

  const eager = (html) => html.replace(' loading="lazy"', "");

  /* seat: districts.json row; cands: active candidates; odds: seat_odds.json row or null */
  function seatCard({ seat, cands, shots, odds, oddsDate, classification }) {
    const m = seat.margin;
    // Candidates in the VEC's ballot order (never by betting price), the first five.
    const top = cands.slice().sort(App.candidateOrder).slice(0, 5);
    const fav = odds && (odds.favourite || (odds.joint_favourites || []).length)
      ? (odds.favourite ? `${odds.favourite_candidate ? escapeHtml(odds.favourite_candidate) : escapeHtml(partyName(odds.favourite))} ${App.fmtPrice(odds.price)}`
        : `${odds.joint_favourites.map((p) => escapeHtml(partyName(p))).join(" / ")} (joint)`)
      : "No clear favourite";
    const credits = [...new Set(top.map((c) => shots[candidateId(seat.id, c.name)]).filter(Boolean).map((s) => s.source.credit))];
    return {
      accent: App.partyVar(seat.party),
      filename: `${seat.id}-${App.melbourneToday()}.png`,
      title: `${seat.name}, Vic Election 2026`,
      url: new URL(`lower.html#${seat.id}`, App.ROOT).href,
      inner: `
        <div class="hc-body">
          <div class="hc-kicker">2026 Victorian state election · Legislative Assembly</div>
          <div class="hc-title">${escapeHtml(seat.name)}</div>
          <div class="hc-facts">
            <div><span class="hc-label">Held by</span><span class="hc-value"><i style="background:var(${App.partyVar(seat.party)})"></i>${escapeHtml(partyName(seat.party))}</span>
              <span class="hc-sub">${escapeHtml(seat.sitting_mp || "")}${seat.retiring ? " (retiring)" : ""}</span></div>
            <div><span class="hc-label">Margin</span><span class="hc-value">${m && m.pct != null ? escapeHtml(App.fmtMargin(m.party, m.pct)) : "–"}</span>
              <span class="hc-sub">${m && m.vs ? `vs ${escapeHtml(App.partyShort(m.vs))}` : ""}${classification ? ` · ${escapeHtml(classification)}` : ""}</span></div>
            <div><span class="hc-label">Sportsbet favourite</span><span class="hc-value">${fav}</span>
              <span class="hc-sub">${oddsDate ? `as at ${escapeHtml(fmtDate(oddsDate))}` : ""}</span></div>
          </div>
          <div class="hc-label">Candidates in ballot-paper order${cands.length > top.length ? ` (first ${top.length} of ${cands.length})` : ""}</div>
          <div class="hc-people">${top.map((c) => `
            <div class="hc-person">${eager(App.avatar(shots, seat.id, c.name, c.party, { size: 72 }))}
              <span class="hc-name">${escapeHtml(c.name)}</span><span class="hc-party">${escapeHtml(partyName(c.party))}</span></div>`).join("")}</div>
        </div>
        <div class="hc-foot"><strong>Vic Election 2026</strong><span>${escapeHtml(siteLink(`lower.html#${seat.id}`))}</span>
          <span>${credits.length ? `Photos: ${escapeHtml(credits.join(", "))} · ` : ""}${escapeHtml(today())}</span></div>`,
    };
  }

  // The seat models' projection (App.modelSeats) as share-card rows: per bloc the span from the lowest to the
  // highest model, a dot at the median and the majority mark, in the fixed party order; and the models, dated.
  const MV_BLOC = { GRN: ["Greens", "--p-grn"], ALP: ["Labor", "--p-alp"], LNP: ["Coalition", "--p-lib"], ONP: ["One Nation", "--p-onp"], OTH: ["Others", "--p-ind"] };
  function modelRows(ms) {
    const r = Math.round, pos = (n) => (100 * Math.min(n, 88)) / 88;
    return App.BLOCS.filter((b) => ms.summary[b] && ms.summary[b].hi >= 0.5).map((b) => {
      const s = ms.summary[b], [label, v] = MV_BLOC[b];
      return `<div class="hc-bar"><span>${label}</span><span class="hc-track"><b style="left:${pos(s.lo)}%;width:${pos(s.hi) - pos(s.lo)}%;background:var(${v})"></b><i style="left:${pos(45)}%"></i><em style="left:${pos(s.median)}%;background:var(${v})"></em></span>
        <strong>${r(s.median)}${r(s.lo) !== r(s.hi) ? `<small>${r(s.lo)}–${r(s.hi)}</small>` : ""}</strong></div>`;
    }).join("");
  }
  const modelNames = (ms) => ms.models.map(({ model: m, when }) => `${m.name}${when ? ` (${when})` : ""}`).join(" · ");

  /* avg: {LNP2pp, ALP2pp, primaries: {code: %}, n}; ms: App.modelSeats(seat_models.json); days: days to go */
  function homeCard({ avg, ms, days, electionDate }) {
    const lead = avg.LNP2pp >= 50 ? ["Coalition", avg.LNP2pp] : ["Labor", avg.ALP2pp];
    return {
      accent: avg.LNP2pp >= 50 ? "--p-lib" : "--p-alp",
      filename: `vic-election-2026-headline-${App.melbourneToday()}.png`,
      title: "Vic Election 2026: where it stands",
      url: App.ROOT.href,
      inner: `
        <div class="hc-body">
          <div class="hc-kicker">2026 Victorian state election · ${escapeHtml(fmtDate(electionDate))}${days > 0 ? ` · ${days} days to go` : ""}</div>
          <div class="hc-title">${lead[0]} ahead, ${lead[1].toFixed(1)}–${(100 - lead[1]).toFixed(1)}</div>
          <div class="hc-facts">
            <div><span class="hc-label">Poll of polls, 2PP</span><span class="hc-value">Labor ${avg.ALP2pp.toFixed(1)} · L/NP ${avg.LNP2pp.toFixed(1)}</span>
              <span class="hc-sub">Smoothed average of ${avg.n} published polls</span></div>
            <div><span class="hc-label">Primary vote</span><span class="hc-value">${Object.entries(avg.primaries).sort(([a], [b]) => App.partyOrder(a, b)).map(([k, v]) => `${escapeHtml(App.partyShort(k))} ${v.toFixed(0)}`).join(" · ")}</span>
              <span class="hc-sub">Poll-of-polls averages</span></div>
          </div>
          <div class="hc-label">Seats: median of ${ms.models.length} seat models, shaded from lowest to highest (45 for a majority)</div>
          <div class="hc-bars hc-mv">${modelRows(ms)}</div>
          <div class="hc-models">${escapeHtml(modelNames(ms))}</div>
        </div>
        <div class="hc-foot"><strong>Vic Election 2026</strong><span>${escapeHtml(siteLink())}</span><span>${escapeHtml(today())}</span></div>`,
    };
  }

  /* Your ballot (ballot.html): the district's Assembly paper in ballot order, and a line on its Council paper.
     district: districts.json row; entry, regionEntry: vec_nominations.json → districts[id], regions[id] */
  function ballotCard({ district, entry, regionEntry }) {
    const drawn = !!entry.ballot_drawn;
    const cands = entry.candidates.slice().sort((a, b) => (drawn ? a.ballot_position - b.ballot_position : (a.nominated || 0) - (b.nominated || 0)));
    const n = cands.length;
    // Two columns, filled down then across; a long paper gets a smaller type size so it still fits.
    const perCol = Math.ceil(n / 2);
    const size = perCol <= 6 ? 1 : perCol <= 8 ? 0.8 : 0.66;
    const name = (c) => {
      const b = String(c.ballot_name || c.name), i = b.indexOf(",");
      return i < 0 ? `<b>${escapeHtml(b)}</b>` : `<b>${escapeHtml(b.slice(0, i))}</b>, ${escapeHtml(b.slice(i + 1).trim())}`;
    };
    const lc = regionEntry ? `${escapeHtml(regionEntry.name)} Region: ${regionEntry.candidates.length} candidates${regionEntry.ballot_drawn
      ? ` in ${(regionEntry.groups || []).length} groups` : ""}. Number at least 5 boxes, above the line or below it.` : "";
    return {
      accent: "--accent",
      filename: `ballot-${district.id}-${App.melbourneToday()}.png`,
      title: `Your ballot: ${district.name}, Vic Election 2026`,
      url: new URL(`ballot.html#${district.id}`, App.ROOT).href,
      inner: `
        <div class="hc-body">
          <div class="hc-kicker">2026 Victorian state election · Your ballot</div>
          <div class="hc-title hc-title-sm">${escapeHtml(district.name)} District: Legislative Assembly</div>
          <div class="hc-ballot-instr">${drawn ? `Number every box from 1 to ${n} in the order of your choice` : "Ballot order not yet published: candidates in nominating order"}</div>
          <ol class="hc-ballot" style="--hc-rows:${perCol};font-size:${(26 * size).toFixed(1)}px">${cands.map((c) => `
            <li style="--party-color: var(${App.partyVar(c.party)})"><span class="hc-box"></span><span class="hc-bname"><span>${name(c)}</span>
              <span class="hc-bparty">${escapeHtml(c.party_label || "Independent")}</span></span></li>`).join("")}</ol>
          ${lc ? `<div class="hc-sub"><b>Legislative Council</b>, ${lc}</div>` : ""}
        </div>
        <div class="hc-foot"><strong>Vic Election 2026</strong><span>${escapeHtml(siteLink(`ballot.html#${district.id}`))}</span>
          <span>Ballot order: VEC · ${escapeHtml(today())}</span></div>`,
    };
  }

  /* ---------- This week (home page button; scripts/build_share.py saves it as share/this-week.png each refresh) ---------- */
  const MOVE_DAYS = 7;
  const MOVE_MIN = 1;   // percentage points: smaller moves aren't news
  const isoMinus = (iso, n) => { const d = App.parseDate(iso); d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  // The seats whose model win probability or Sportsbet price moved most between the latest snapshot in
  // seat_history.json and the one MOVE_DAYS earlier. A price counts by its implied chance (100 / price), so both
  // are in percentage points. [{id, kind: "model" | "odds", party, from, to, by}], biggest first.
  function seatMovers(history, n = 3) {
    const keys = Object.keys((history && history.days) || {}).sort();
    if (keys.length < 2) return { movers: [], since: null };
    const latest = keys[keys.length - 1];
    const since = keys.filter((k) => k <= isoMinus(latest, MOVE_DAYS)).pop() || keys[0];
    const now = history.days[latest].seats, then = history.days[since].seats;
    const best = [];
    Object.keys(now).forEach((id) => {
      const a = then[id] || {}, b = now[id];
      let top = null;
      const consider = (kind, party, from, to, by) => { if (!top || Math.abs(by) > Math.abs(top.by)) top = { id, kind, party, from, to, by }; };
      const mParties = new Set([...Object.keys(a.model || {}), ...Object.keys(b.model || {})]);
      if (a.model && b.model) mParties.forEach((p) => consider("model", p, a.model[p] || 0, b.model[p] || 0, (b.model[p] || 0) - (a.model[p] || 0)));
      if (a.odds && b.odds) Object.keys(b.odds).forEach((p) => {
        if (a.odds[p] != null) consider("odds", p, a.odds[p], b.odds[p], 100 / b.odds[p] - 100 / a.odds[p]);
      });
      if (top && Math.abs(top.by) >= MOVE_MIN) best.push(top);
    });
    best.sort((x, y) => Math.abs(y.by) - Math.abs(x.by) || x.id.localeCompare(y.id));
    return { movers: best.slice(0, n), since, latest };
  }

  // Everything the weekly card shows, from the published data files.
  async function weekly() {
    const [meta, dd, pollData, history, models] = await Promise.all([
      App.loadJSON("meta"), App.loadJSON("districts"), App.loadJSON("polls"), App.loadJSON("seat_history").catch(() => null),
      App.loadJSON("seat_models").catch(() => null)]);
    const districts = dd.districts;
    const all = App.preparePolls(pollData);
    const last = (fn) => { const ser = App.smoothedSeries(all, fn); return ser.length ? ser[ser.length - 1].y : null; };
    const s = App.statewideSwing(meta, pollData);
    if (!s) throw new Error("No poll average available");
    const primaries = {};
    ["LNP", "ALP", "ONP", "GRN"].sort(App.partyOrder).forEach((k) => {
      const v = last((p) => (p.primary && p.primary[k] != null ? p.primary[k] : null));
      if (v != null) primaries[k] = v;
    });
    const ms = App.modelSeats(models);   // the home page's seat projection: the seat models' median and range
    const today = App.melbourneToday();
    const next = ((meta.key_dates && meta.key_dates.events) || []).filter((e) => !e.ongoing && e.from > today)
      .sort((a, b) => a.from.localeCompare(b.from))[0] || null;
    const names = Object.fromEntries(districts.map((d) => [d.id, d.name]));
    const moves = seatMovers(history);
    return weekCard({ today, s, primaries, ms, n: all.filter((p) => !App.pollExclusion(p)).length, next, moves, names,
      days: App.daysBetween(today, meta.election_date), electionDate: meta.election_date });
  }

  function weekCard({ today: day, s, primaries, ms, n, next, moves, names, days, electionDate }) {
    const lnp = s.current, alp = 100 - s.current;
    const lead = lnp >= 50 ? ["Coalition", lnp, "Labor", alp] : ["Labor", alp, "Coalition", lnp];
    const BLOC = { LNP: ["Coalition", "--p-lib"], ALP: ["Labor", "--p-alp"], GRN: ["Greens", "--p-grn"], ONP: ["One Nation", "--p-onp"], OTH: ["Others", "--p-ind"] };
    const BLOC_SHORT = { LNP: "L/NP", ALP: "ALP", GRN: "GRN", ONP: "ONP", OTH: "OTH" };
    const seats = App.BLOCS.filter((b) => ms.summary[b] && Math.round(ms.summary[b].median) > 0);   // the fixed party order, never by size
    const pct = (v) => `${Math.round(v)}%`;
    const move = (m) => {
      const party = escapeHtml(App.partyName(m.party));
      const what = m.kind === "model"
        ? `${party} win chance ${pct(m.from)} → ${pct(m.to)} <span class="hc-sub">(AEF model)</span>`
        : `${party} ${App.fmtPrice(m.from)} → ${App.fmtPrice(m.to)} <span class="hc-sub">(Sportsbet)</span>`;
      return `<li style="--party-color: var(${App.partyVar(m.party)})"><b>${escapeHtml(names[m.id] || m.id)}</b> ${what}</li>`;
    };
    const short = (iso) => fmtDate(iso).replace(/ \d{4}$/, "");
    return {
      accent: lnp >= 50 ? "--p-lib" : "--p-alp",
      filename: `vic-election-2026-this-week-${day}.png`,
      title: `Vic Election 2026: this week (${fmtDate(day)})`,
      url: App.ROOT.href,
      inner: `
        <div class="hc-body hc-week">
          <div class="hc-kicker">This week · ${escapeHtml(fmtDate(day))}${days > 0 ? ` · ${days} days to election day` : ` · election day ${escapeHtml(fmtDate(electionDate))}`}</div>
          <div class="hc-title hc-title-sm">${lead[0]} ${lead[1].toFixed(1)} – ${lead[2]} ${lead[3].toFixed(1)} <span class="hc-sub">2PP, poll of polls</span></div>
          <div class="hc-facts">
            <div><span class="hc-label">Primary vote</span><span class="hc-value">${Object.entries(primaries).map(([k, v]) => `${escapeHtml(App.partyShort(k))} ${v.toFixed(0)}`).join(" · ")}</span>
              <span class="hc-sub">Average of ${n} polls</span></div>
            <div><span class="hc-label">Seat models, median of ${ms.models.length} (45 to win)</span>
              ${seats.length ? `<div class="hc-seatrow">${App.modelsHemicycle(ms)}<ul class="hc-seatlist">${seats.map((b) => {
                const m = ms.summary[b], r = Math.round;
                return `<li><i style="background:var(${BLOC[b][1]})"></i>${BLOC[b][0]} <b>${r(m.median)}</b>${r(m.lo) !== r(m.hi) ? ` <span class="hc-sub">${r(m.lo)}–${r(m.hi)}</span>` : ""}</li>`;
              }).join("")}</ul></div>` : '<span class="hc-value">No model loaded</span>'}</div>
          </div>
          <div class="hc-week-cols">
            <div><div class="hc-label">Biggest seat moves${moves.since ? ` since ${escapeHtml(short(moves.since))}` : ""}</div>
              ${moves.movers.length ? `<ol class="hc-moves">${moves.movers.map(move).join("")}</ol>`
                : '<div class="hc-sub">No seat moved by a point or more this week.</div>'}</div>
            <div><div class="hc-label">Next key date</div>
              ${next ? `<div class="hc-next"><b>${escapeHtml(short(next.from))}</b> ${escapeHtml(next.short || next.text)}</div>` : '<div class="hc-sub">None scheduled</div>'}</div>
          </div>
        </div>
        <div class="hc-foot"><strong>Vic Election 2026</strong><span>${escapeHtml(siteLink())}</span><span>${escapeHtml(fmtDate(day))}</span></div>`,
    };
  }

  /* ---------- Build your own prediction (predict.html): the reader's parliament and totals ---------- */
  function predictCard({ counts, changed }) {
    const blocs = App.BLOCS.filter((b) => counts[b]);   // the fixed party order
    const top = App.BLOCS.reduce((a, b) => (counts[b] > counts[a] ? b : a));
    const L = App.BLOC_LABEL, C = App.BLOC_COLOR;
    const title = counts[top] >= 45 ? `${L[top]} majority, ${counts[top]} seats` : `No majority: ${L[top]} ${counts[top]}, ${45 - counts[top]} short`;
    const hemi = App.hemicycle({ segments: blocs.map((b) => ({ code: C[b], n: counts[b] })), label: title });
    return {
      accent: top === "ALP" ? "--p-alp" : top === "LNP" ? "--p-lib" : "--accent",
      filename: `my-vic-election-prediction-${App.melbourneToday()}.png`,
      title: `My prediction: ${title}`,
      url: new URL("predict.html", App.ROOT).href,
      inner: `
        <div class="hc-body">
          <div class="hc-kicker">My prediction · 2026 Victorian state election · Legislative Assembly</div>
          <div class="hc-title hc-title-sm">${escapeHtml(title)}</div>
          <div class="hc-pred">${hemi}
            <ul class="hc-pred-list">${blocs.map((b) => `<li><i style="background:var(${App.partyVar(C[b])})"></i>${L[b]}<b>${counts[b]}</b></li>`).join("")}
              <li class="hc-sub">45 seats for a majority</li></ul></div>
          <div class="hc-sub">${changed ? `${changed} seat${changed === 1 ? "" : "s"} changed from the starting picks (seat models and Sportsbet)` : "The starting picks: what most seat models and Sportsbet favour in each seat"}</div>
        </div>
        <div class="hc-foot"><strong>Vic Election 2026</strong><span>${escapeHtml(siteLink("predict.html"))}</span><span>${escapeHtml(today())}</span></div>`,
    };
  }

  // For scripts/build_share.py: the card as a PNG data URL.
  async function weeklyPng() {
    const card = await weekly();
    const blob = await renderHtmlCard(card.inner, card.accent);
    return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  }

  App.ShareCard = { drawCandidate, mount, shareButton, seatCard, homeCard, ballotCard, predictCard, weekly, weeklyPng, seatMovers, W, H };
})();
