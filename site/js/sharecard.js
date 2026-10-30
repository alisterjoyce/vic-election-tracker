/* Share cards: 1200x630 PNG images for a candidate or a seat, drawn on a canvas in the
   current theme's colours, with the candidate photo (data/headshots.json) or a
   party-colour initials circle, and the photo credit printed on the card. */
(function () {
  "use strict";
  const App = window.App;
  const { escapeHtml, partyName, partyColor, cssVar, initials, inkFor, candidateId } = App;

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

  /* seat: districts.json row; people: active candidates in ballot/display order */
  async function drawSeat(canvas, { seat, people, shots }) {
    await fontsReady();
    const ctx = canvas.getContext("2d");
    const holder = partyColor(seat.party) || cssVar("--p-oth");
    const shown = people.slice(0, 7);
    const imgs = await Promise.all(shown.map((p) => {
      const s = shots[candidateId(seat.id, p.name)];
      return s ? loadImage(s.files["160"]) : null;
    }));
    const credits = [...new Set(shown.map((p) => shots[candidateId(seat.id, p.name)]).filter(Boolean).map((s) => s.source.credit))];
    frame(ctx, holder, "");

    const x = 56;
    kicker(ctx, "2026 Victorian state election · Legislative Assembly", x, 92);
    const nameFit = fitText(ctx, seat.name, { weight: 800, family: DISPLAY, max: 80, min: 48, maxWidth: W - 2 * x });
    ctx.fillStyle = cssVar("--text");
    ctx.fillText(nameFit.lines[0], x, 92 + 16 + nameFit.size);

    ctx.fillStyle = cssVar("--muted");
    ctx.font = `500 28px ${BODY}`;
    const m = seat.margin;
    const sub = [`Held by ${partyName(seat.party)}`];
    if (m && m.pct != null) sub.push(`margin ${App.fmtMargin(m.party, m.pct)}${m.vs ? ` vs ${App.partyShort(m.vs)}` : ""}`);
    sub.push(`${people.length} candidate${people.length === 1 ? "" : "s"}`);
    ctx.fillText(sub.join(" · "), x, 92 + 16 + nameFit.size + 50);

    if (!shown.length) return;
    const slots = shown.length + (people.length > shown.length ? 1 : 0);
    const gap = (W - 2 * x) / Math.max(slots, 5);
    const r = Math.min(64, gap / 2 - 14);
    const cy = 360;
    shown.forEach((p, i) => {
      const cx = x + gap * i + gap / 2;
      drawFace(ctx, { img: imgs[i], name: p.name, party: p.party, x: cx, y: cy, r, ring: 6 });
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = cssVar("--text");
      const surname = App.givenFirst(p.name).split(/\s+/).pop();
      const fit = fitText(ctx, surname, { weight: 600, family: BODY, max: 22, min: 15, maxWidth: gap - 10 });
      ctx.fillText(ellipsis(ctx, fit.lines[0], gap - 10), cx, cy + r + 38);
      ctx.fillStyle = cssVar("--muted");
      ctx.font = `500 18px ${BODY}`;
      ctx.fillText(ellipsis(ctx, partyName(p.party), gap - 10), cx, cy + r + 64);
    });
    if (slots > shown.length) {
      const cx = x + gap * shown.length + gap / 2;
      ctx.fillStyle = cssVar("--surface-2");
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cssVar("--muted");
      ctx.font = `800 ${Math.round(r * 0.6)}px ${DISPLAY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`+${people.length - shown.length}`, cx, cy);
    }
    if (credits.length) {
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = cssVar("--muted");
      ctx.font = `500 16px ${BODY}`;
      wrap(ctx, `Photos: ${credits.join(", ")}`, W - 2 * x).slice(0, 2)
        .forEach((l, i) => ctx.fillText(l, x, H - FOOT - 34 + i * 20));
    }
    ctx.textAlign = "left";
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
    const onTheme = () => { if (el.isConnected) render(); else document.removeEventListener("themechange", onTheme); };
    document.addEventListener("themechange", onTheme);
    return render();
  }

  App.ShareCard = { drawCandidate, drawSeat, mount, W, H };
})();
