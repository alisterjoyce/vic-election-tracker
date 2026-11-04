/* Candidate profiles (candidate.html#<seat id>/<name slug>) and, with no hash, the candidate directory. */
(function () {
  "use strict";
  const App = window.App;
  const { loadJSON, escapeHtml, partyName, partyBadge, statusBadge, fmtDate, hashId, copyLink } = App;

  let people = [];
  let shots = {};       // candidate id -> headshot (data/headshots.json)
  let districts = {};   // id -> districts.json row
  let regions = {};     // id -> regions.json row
  let profiles = {};    // candidate id -> researched profile (data/profiles.json)

  const $ = (id) => document.getElementById(id);
  const surname = (p) => App.givenFirst(p.name).split(/\s+/).pop();
  const SOURCES = { abc: "ABC election guide", wikipedia: "Wikipedia", electiontracker: "Party page (found via electiontracker.au)" };
  const ISSUES = "https://github.com/alisterjoyce/vic-election-tracker/issues";

  function seatLink(p) {
    return p.house === "lower"
      ? `<a href="lower.html#${escapeHtml(p.seat)}">${escapeHtml(p.seatName)}</a>`
      : `<a href="upper.html#${escapeHtml(p.seat)}">${escapeHtml(p.seatName)} Region</a>`;
  }

  function marginText(m) {
    if (!m || m.pct == null) return "–";
    return `${escapeHtml(App.fmtMargin(m.party, m.pct))}${m.vs ? ` vs ${escapeHtml(App.partyShort(m.vs))}` : ""}`;
  }

  const fact = (label, value, sub = "") =>
    `<div class="fact"><div class="label">${escapeHtml(label)}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ""}</div>`;

  function badges(p) {
    return [
      partyBadge(p.party),
      p.contesting ? statusBadge(p.status) : "",
      p.incumbent ? '<span class="badge neutral">Sitting MP</span>' : "",
      p.mlc ? '<span class="badge neutral">Current MLC</span>' : "",
      p.mlc && p.mlc.retiring ? '<span class="badge neutral">Retiring</span>' : "",
    ].join(" ");
  }

  function contestLine(p) {
    if (!p.contesting) return `Member of the Legislative Council for ${seatLink(p)}. Not on a 2026 ticket in the tracker.`;
    if (p.house === "lower") return `Candidate for ${seatLink(p)}, Legislative Assembly`;
    const pos = p.ticket_position ? `No. ${p.ticket_position} on the ${escapeHtml(partyName(p.party))} ticket for ` : "Candidate for ";
    return `${pos}${seatLink(p)}, Legislative Council`;
  }

  function facts(p) {
    if (p.house === "lower") {
      const d = districts[p.seat] || {};
      return [
        fact("Seat", seatLink(p), d.classification ? escapeHtml(d.classification) : ""),
        fact("Ballot position", p.ballot_position != null ? String(p.ballot_position) : "Not drawn yet", p.ballot_position != null ? "" : "VEC draw after nominations close 9 Nov"),
        fact("Held by", d.party ? partyBadge(d.party) : "–", d.sitting_mp ? escapeHtml(d.sitting_mp) + (d.retiring ? " (retiring)" : "") : ""),
        fact("Margin", marginText(d.margin)),
        fact("Region", regions[d.region] ? `<a href="upper.html#${escapeHtml(d.region)}">${escapeHtml(regions[d.region].name)}</a>` : "–"),
      ].join("");
    }
    return [
      fact("Region", seatLink(p), "5 members"),
      fact("Ticket position", p.ticket_position ? String(p.ticket_position) : "–", p.on_ticket ? "" : "As reported"),
      fact("Ballot group", p.group ? `Group ${escapeHtml(p.group)}` : "Not drawn yet", "VEC draw after nominations close 9 Nov"),
      fact("Current MLC", p.mlc ? `Yes, ${escapeHtml(partyName(p.mlc.party))}` : "No"),
    ].join("");
  }

  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url; } };
  const ext = (url, text) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(text)} ↗</a>`;

  // Official links only: the website the ABC guide lists for the candidate, and the seat's ABC guide page.
  function links(p) {
    const out = [];
    if (p.website) {
      const host = hostOf(p.website);
      const social = { "facebook.com": "Facebook", "instagram.com": "Instagram", "x.com": "X", "twitter.com": "X", "linkedin.com": "LinkedIn", "tiktok.com": "TikTok" };
      const kind = Object.entries(social).find(([h]) => host === h || host.endsWith(`.${h}`));
      out.push([kind ? kind[1] : "Website", `${ext(p.website, kind ? p.website.replace(/^https?:\/\/(www\.)?/, "") : host)} <span class="muted small">(as listed by the ABC)</span>`]);
    }
    const d = p.house === "lower" ? districts[p.seat] : null;
    if (d && d.abc_url) out.push(["ABC guide", ext(d.abc_url, `${d.name} seat guide`)]);
    if (!out.length) return "";
    return `<dl class="profile-record profile-links">${out.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  }

  function record(p) {
    const rows = [];
    const label = SOURCES[p.source] || (/abc\.net\.au\/news\/\d{4}-/.test(p.source_url || "") ? "ABC News report" : "Source");
    if (p.source_url) rows.push(["Listed by", `<a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">${escapeHtml(label)} ↗</a>`]);
    else if (p.on_ticket) rows.push(["Listed by", `The ${escapeHtml(p.seatName)} ticket list on the <a href="upper.html#${escapeHtml(p.seat)}">upper house page</a>`]);
    if (p.date_added) rows.push(["Added", escapeHtml(fmtDate(p.date_added))]);
    if (p.updated) rows.push(["Last checked", escapeHtml(fmtDate(p.updated))]);
    if (p.notes) rows.push(["Note", escapeHtml(p.notes)]);
    if (p.mlc && p.mlc.notes) rows.push(["MLC note", escapeHtml(p.mlc.notes)]);
    if (!rows.length) return "";
    return `<dl class="profile-record">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  }

  function photoBlock(p) {
    const shot = shots[p.id];
    const caption = shot
      ? `Photo: <a href="${escapeHtml(shot.source.page)}" target="_blank" rel="noopener">${escapeHtml(shot.source.credit)}</a>`
      : "No photo yet";
    return `<figure class="profile-photo">
        ${App.avatar(shots, p.seat, p.name, p.party, { size: 160 })}
        <figcaption class="muted small">${caption}</figcaption>
      </figure>`;
  }

  function photoDetails(p) {
    const shot = shots[p.id];
    if (!shot) return "";
    return `<details class="photo-about">
        <summary>About this photo</summary>
        <p class="small">${escapeHtml(shot.licence)}</p>
        <p class="small muted">Published by ${escapeHtml(shot.source.credit)} at <a href="${escapeHtml(shot.source.page)}" target="_blank" rel="noopener">${escapeHtml(shot.source.page.replace(/^https?:\/\/(www\.)?/, ""))}</a>. Added ${escapeHtml(fmtDate(shot.date_added))}.
        To have it removed or replaced, <a href="${ISSUES}">open an issue</a>.</p>
      </details>`;
  }

  function contestOrder(a, b) {
    return partyName(a.party).localeCompare(partyName(b.party)) || (a.ticket_position || 99) - (b.ticket_position || 99) || a.name.localeCompare(b.name);
  }

  function rivals(p) {
    const others = people.filter((o) => o.seat === p.seat && o.id !== p.id && o.contesting && o.status !== "withdrawn").sort(contestOrder);
    if (!others.length) return "";
    return `
      <div class="card">
        <div class="card-head"><h2>${p.house === "lower" ? "Also standing in" : "Also on tickets in"} ${escapeHtml(p.seatName)}</h2><span class="muted small">${others.length}</span></div>
        <ul class="people">
          ${others.map((o) => `
            <li>
              ${App.avatar(shots, o.seat, o.name, o.party, { size: 32 })}
              <span class="name">${App.profileLink(o.seat, o.name)}${o.ticket_position && o.house === "upper" ? ` <span class="muted small">No. ${o.ticket_position}</span>` : ""}</span>
              ${partyBadge(o.party)}
            </li>`).join("")}
        </ul>
        ${App.photoCredits(shots, others.map((o) => [o.seat, o.name]))}
      </div>`;
  }

  /* ---------- Researched profile (data/profiles.json) ---------- */
  const ROLE_ORDER = (a, b) => (b.to == null) - (a.to == null) || (b.from || 0) - (a.from || 0);
  const LINKS = [["website", "Website"], ["party_page", "Party page"], ["parliament", "Parliament of Victoria"], ["abc", "ABC"],
    ["wikipedia", "Wikipedia"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["x", "X"], ["linkedin", "LinkedIn"]];
  const RESULT = { Won: "Won", Retained: "Won", Lost: "Lost", Withdrew: "Withdrew", Unknown: "Result not found" };

  // [1,2] -> superscript links to the sources list
  const refs = (src) => (src && src.length
    ? `<sup class="refs">${src.map((n) => `<a href="#src-${encodeURIComponent(n)}" aria-label="Source ${escapeHtml(String(n))}">${escapeHtml(String(n))}</a>`).join(" ")}</sup>` : "");
  const unverified = (f) => (f && f.unverified
    ? ` <span class="badge reported" title="${escapeHtml(f.note || "A source says this but we haven't confirmed it")}">Unverified</span>${f.note ? ` <span class="muted small">${escapeHtml(f.note)}</span>` : ""}` : "");
  const years = (r) => (r.from || r.to ? ` <span class="muted">(${r.from || "?"}–${r.to == null ? "present" : r.to})</span>` : "");

  function profileCard(p) {
    const pr = profiles[p.id];
    if (!pr) return "";
    const facts = [
      ["Born", pr.born && pr.born.year, pr.born],
      ["Lives in", pr.lives && pr.lives.place, pr.lives],
      ["Occupation", pr.occupation && pr.occupation.text, pr.occupation],
      ["Faction", pr.faction && pr.faction.name, pr.faction],
    ].filter(([, v]) => v != null && v !== "");
    const roles = (pr.prior_roles || []).slice().sort(ROLE_ORDER);
    const runs = (pr.previous_candidacies || []).slice().sort((a, b) => String(b.election).localeCompare(String(a.election)));
    const links = LINKS.filter(([k]) => pr.links && pr.links[k]);
    const contact = pr.contact || {};
    const sources = pr.sources || [];
    return `
      <section class="card profile-bio" aria-labelledby="bio-h">
        <div class="card-head"><h2 id="bio-h">Profile</h2><span class="muted small">Updated ${escapeHtml(fmtDate(pr.profile_updated))}</span></div>
        ${pr.summary ? `<p class="bio-summary">${escapeHtml(pr.summary.text)}${refs(pr.summary.src)}</p>` : ""}
        ${facts.length ? `<dl class="profile-record">${facts.map(([k, v, f]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}${refs(f.src)}${unverified(f)}</dd>`).join("")}</dl>` : ""}
        ${roles.length ? `<h3>Roles</h3><ul class="bio-list">${roles.map((r) => `<li>${escapeHtml(r.role)}${r.organisation ? `, ${escapeHtml(r.organisation)}` : ""}${years(r)}${refs(r.src)}${unverified(r)}</li>`).join("")}</ul>` : ""}
        ${runs.length ? `<h3>Previous candidacies</h3>
          <div class="table-scroll"><table data-no-csv>
            <thead><tr><th>Election</th><th>Seat</th><th>Party</th><th>Result</th></tr></thead>
            <tbody>${runs.map((r) => `<tr><td>${escapeHtml(r.election)}</td><td>${escapeHtml(r.seat)}</td><td>${escapeHtml(partyName(r.party))}</td><td>${escapeHtml(RESULT[r.result] || r.result || "")}${refs(r.src)}${unverified(r)}</td></tr>`).join("")}</tbody>
          </table></div>` : ""}
        ${(pr.priorities || []).length ? `<h3>Priorities</h3><ul class="bio-list">${pr.priorities.slice(0, 5).map((x) => `<li>${x.quoted ? `“${escapeHtml(x.text)}”` : escapeHtml(x.text)}${refs(x.src)}</li>`).join("")}</ul>
          <p class="muted small">Quoted lines are the candidate's own words; the rest are our summary of what they've said.</p>` : ""}
        ${links.length ? `<h3>Links</h3><ul class="bio-links">${links.map(([k, label]) => `<li><a href="${escapeHtml(pr.links[k])}" target="_blank" rel="noopener">${label} ↗</a></li>`).join("")}</ul>` : ""}
        ${contact.email || contact.phone ? `<h3>Contact</h3><dl class="profile-record">
          ${contact.email ? `<dt>Email</dt><dd><a href="mailto:${escapeHtml(contact.email.value)}">${escapeHtml(contact.email.value)}</a> <span class="muted small">${escapeHtml(contact.email.kind || "")}</span>${refs(contact.email.src)}</dd>` : ""}
          ${contact.phone ? `<dt>Phone</dt><dd><a href="tel:${escapeHtml(contact.phone.value.replace(/[^\d+]/g, ""))}">${escapeHtml(contact.phone.value)}</a> <span class="muted small">${escapeHtml(contact.phone.kind || "")}</span>${refs(contact.phone.src)}</dd>` : ""}
        </dl>` : ""}
        ${sources.length ? `<h3>Sources</h3><ol class="bio-sources">${sources.map((s) => `<li id="src-${escapeHtml(String(s.id))}" value="${Number(s.id) || ""}"><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title || s.url)}</a> <span class="muted small">accessed ${escapeHtml(fmtDate(s.accessed))}</span></li>`).join("")}</ol>` : ""}
        <p class="muted small">Researched from public sources and written in our own words. Spot an error? <a href="${ISSUES}">Open an issue</a>.</p>
      </section>`;
  }

  function renderProfile(p) {
    const el = $("candidate-detail");
    document.title = `${p.name} · Vic Election 2026`;
    el.innerHTML = `
      <article class="card profile">
        <div class="profile-head">
          ${photoBlock(p)}
          <div class="profile-intro">
            <h1>${escapeHtml(p.name)}</h1>
            <p class="profile-badges">${badges(p)}</p>
            <p class="profile-contest">${contestLine(p)}</p>
            <div class="card-actions">
              ${p.house === "lower" ? App.starButton(p.seat, p.seatName) : ""}
              <button class="icon-btn" type="button" id="copy-link">Copy link</button>
              ${p.house === "lower" && districts[p.seat] && districts[p.seat].abc_url ? `<a class="icon-btn" href="${escapeHtml(districts[p.seat].abc_url)}" target="_blank" rel="noopener">ABC guide ↗</a>` : ""}
            </div>
          </div>
        </div>
        <div class="facts">${facts(p)}</div>
        ${p.status === "withdrawn" ? '<p class="banner">This candidate has withdrawn.</p>' : ""}
        ${links(p)}
        ${record(p)}
        ${photoDetails(p)}
      </article>

      ${profileCard(p)}

      <section class="card" aria-labelledby="share-h">
        <h2 id="share-h">Share card</h2>
        <div id="share-card" class="sharecard"><p class="empty">Drawing…</p></div>
      </section>

      ${rivals(p)}

      <p class="small"><a href="candidate.html">All candidates</a></p>`;
    $("copy-link").addEventListener("click", (e) => copyLink(e.currentTarget));
    App.ShareCard.mount($("share-card"), {
      draw: (canvas) => App.ShareCard.drawCandidate(canvas, { person: p, seat: districts[p.seat], shot: shots[p.id] }),
      filename: `${p.id.replace("/", "--")}.png`,
      title: `${p.name}, ${partyName(p.party)}, ${p.seatName}`,
    });
  }

  /* ---------- Directory ---------- */
  function directoryRows() {
    const q = $("c-search").value.trim().toLowerCase();
    const house = $("c-house").value;
    const party = $("c-party").value;
    return people.filter((p) =>
      (!house || p.house === house) &&
      (!party || p.party === party) &&
      (p.status !== "withdrawn" || p.mlc) &&
      (!q || p.name.toLowerCase().includes(q) || p.seatName.toLowerCase().includes(q)));
  }

  function renderDirectory() {
    const rows = directoryRows().sort((a, b) => surname(a).localeCompare(surname(b)) || a.name.localeCompare(b.name));
    $("c-count").textContent = `${rows.length.toLocaleString("en-AU")} ${rows.length === 1 ? "person" : "people"}`;
    $("c-list").innerHTML = rows.length ? rows.map((p) => `
      <li>
        ${App.avatar(shots, p.seat, p.name, p.party, { size: 32 })}
        <span class="name">${App.profileLink(p.seat, p.name)}</span>
        ${partyBadge(p.party)}
        <span class="muted small">${escapeHtml(p.seatName)}${p.house === "upper" ? " Region" : ""}${p.contesting ? "" : " (MLC)"}</span>
      </li>`).join("") : '<li class="empty">No matches.</li>';
  }

  async function onHashChange() {
    const id = hashId();
    if (id && !Object.keys(profiles).length) {   // the directory was opened first
      profiles = await loadJSON("profiles").then((d) => d.profiles || {}).catch(() => ({}));
    }
    const p = people.find((x) => x.id === id);
    $("directory").hidden = !!p;
    $("candidate-detail").hidden = !p && !id;
    if (p) {
      renderProfile(p);
      window.scrollTo(0, 0);
    } else if (id) {
      document.title = "Candidates · Vic Election 2026";
      $("candidate-detail").innerHTML = `<div class="card"><p class="empty">No candidate with the id “${escapeHtml(id)}”. Search for them below.</p></div>`;
    } else {
      document.title = "Candidates · Vic Election 2026";
    }
  }

  async function init() {
    try {
      // All in parallel: the profile photo's URL is only known once headshots.json arrives. Researched
      // profiles load with them (only on a profile's page), so the page renders once, without a jump.
      const [dd, rd, peopleData, shotData, profileData] = await Promise.all([loadJSON("districts"), loadJSON("regions"), App.loadPeople(),
        App.loadHeadshots(), hashId() ? loadJSON("profiles").catch(() => null) : null]);
      profiles = (profileData && profileData.profiles) || {};
      districts = Object.fromEntries(dd.districts.map((d) => [d.id, d]));
      regions = Object.fromEntries(rd.regions.map((r) => [r.id, r]));
      people = peopleData;
      shots = shotData;

      const parties = [...new Set(people.map((p) => p.party))].sort((a, b) => partyName(a).localeCompare(partyName(b)));
      $("c-party").innerHTML = '<option value="">All parties</option>' +
        parties.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(partyName(c))}</option>`).join("");
      ["c-search", "c-house", "c-party"].forEach((id) => $(id).addEventListener("input", renderDirectory));
      renderDirectory();
      window.addEventListener("hashchange", onHashChange);
      onHashChange();
    } catch (err) {
      App.showError($("candidate-detail"), err);
      $("candidate-detail").hidden = false;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
