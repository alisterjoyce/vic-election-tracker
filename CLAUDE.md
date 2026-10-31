# Vic Election 2026 Tracker: project conventions

A static tracker for the 2026 Victorian state election (polling day Sat 28 Nov 2026). Plain HTML, CSS and vanilla JS with **no build step**, published from `site/` by GitHub Pages. Data lives in JSON files, refreshed daily by `scripts/refresh.py` through a GitHub Action.

**Live site: https://alisterjoyce.github.io/vic-election-tracker/** (GitHub Pages, deployed from Actions). Netlify (https://vic2026tracker.netlify.app) was the first host; its free-tier credits ran out on 31 Oct 2026 and it is no longer the primary host. `netlify.toml` stays so the site can still be deployed there.

The site is served under a base path (`/vic-election-tracker/`) on Pages and at the root elsewhere, so **never use root-absolute URLs** (`/data/...`, `/lower.html`). Pages link relatively, and `common.js` resolves data files and search links against `App.ROOT` (the folder `common.js` is served from). Test under a prefix before changing paths.

## File layout

```
site/                     # published as-is by GitHub Pages (also deployable to Netlify: netlify.toml publish = "site")
  index.html              # home: countdown, seat counts, poll-of-polls chart, latest polls
  lower.html              # Legislative Assembly: filters, district detail, seat outlook (#district-id)
  upper.html              # Legislative Council: 8 regions, MLCs, tickets (#region-id)
  candidate.html          # candidate profiles (#<seat id>/<name slug>) and, with no hash, the candidate directory
  pendulum.html           # interactive pendulum (#swing=3.2) and scenario explorer
  timeline.html           # the 2022-2026 term and election timetable (data/timeline.json)
  changes.html            # "What changed": data/changelog.json grouped by day or week
  data/index.html         # /data/: every published data file, its fields (from _schema), credit and licence
  poll.html               # poll detail (#<poll id>) with the pollster's trend and house effect; no hash = all polls
  myseats.html            # watchlist ("My seats"), stored in localStorage
  about.html              # about and methodology, sources, credits
  css/style.css           # all styles; design tokens on :root
  js/common.js            # shared: data loading, theme, formats, party palette, header chrome
                          #   (key-dates strip, search, footer), poll smoothing, seat-outlook maths
  js/home.js, lower.js, upper.js, myseats.js, candidate.js, pendulum.js, poll.js
  js/quota.js             # upper-house quota calculator (mounted on each region in upper.html)
  js/htv.js               # how-to-vote cards: seat/region section and lower.html's "Preference watch"
  js/timeline.js, changes.js, datafiles.js
  js/sharecard.js         # 1200x630 PNG share cards: candidate (canvas); seat and home headline (HTML rendered with
                          #   html-to-image 1.11.11 from cdnjs, pinned with SRI); Web Share API, else download
  data/*.json             # every file has a "_schema" key describing its fields
scripts/refresh.py        # daily refresh (see "Data pipeline")
scripts/build_localities.py  # rebuilds data/localities.json from Vicmap Admin polygons (run by hand; needs shapely)
scripts/build_boundaries.py  # data/geo/{districts,regions}.geojson, topology-preserving simplification (needs shapely, topojson)
scripts/results_format.py    # the vec-contest-v1 results format (2022 history and 2026 election night)
scripts/build_results_2022.py  # data/results_2022/ from VEC 2022 results by voting centre (one-off)
scripts/vec_feed.py       # VEC media feed (XML) -> vec-contest-v1; --selftest <samples folder>
scripts/build_headshots.py   # headshot zip -> site/photos/{320,160}/*.webp + data/headshots.json (by hand; needs Pillow)
scripts/headshot_overrides.json  # {zip file path: candidate id | null} to resolve photos by hand
site/photos/320/, 160/    # candidate headshots, WebP, each under 25 KB
site/js/maps.js           # Leaflet: home choropleth with metro inset, seat-page booth map
.github/workflows/refresh.yml   # 20:00 UTC daily + workflow_dispatch; commits site/data if changed, then deploys to Pages
.github/workflows/deploy.yml    # deploys site/ to GitHub Pages on every push to main
```

Not committed: the research report `.md` in the repo root, source screenshots and PDFs, the headshot zip (`/*.zip`), `.cache/` (Vicmap downloads) and `.claude/`, all via `.gitignore` except the report, which is simply never added.

## Data files

Each file's `_schema` is the authoritative field list. Keep it in sync when adding fields.

| File | Contents | Maintained by |
|---|---|---|
| `districts.json` | 88 districts: region (from the VEC), sitting MP, party, margin `{party, vs, pct}`, ABC classification/code/url, retiring, needs_check | seed + refresh.py (ABC) |
| `candidates.json` | Candidates for both houses. Assembly rows have `district`; Council rows have `region` + `ticket_position` | seed + refresh.py (Wikipedia, ABC) |
| `regions.json` | 8 regions: MLCs (with retiring), tickets, notes | seed + refresh.py (MLC retiring only) |
| `polls.json` | Statewide polls: id, client, source_url, primaries, 2PP, and where published 3PP, preferred premier and leader approval (matched from Wikipedia's leadership tables by firm and overlapping fieldwork) | refresh.py (Wikipedia), fully rewritten each run |
| `meta.json` | last_updated, previous_election 2PP baseline, key_dates, source status, reconciliation summary | refresh.py + hand |
| `seat_models.json` | MRP seat estimates, one entry per district per model; `null` = not published | hand |
| `seat_odds.json` | Sportsbet market per district: options, favourite, joint_favourites, partial, date_checked | hand (refresh.py tries Sportsbet; it is blocked, so the file is kept as manual) |
| `seat_polls.json` | Single-seat polls | hand |
| `timeline.json` | The term's events and the election timetable: date (YYYY-MM-DD or YYYY-MM), type, one line in our own words, districts/regions, source {label, url} | hand |
| `changelog.json` | What changed at each refresh: new candidates, superseded/withdrawn names, new polls, odds moves of 0.5 or more, retirements, new-headline counts (last 120 days) | refresh.py (`refresh_changelog`, last step); `--backfill-changelog` rebuilds it from git history |
| `changelog_state.json` | Internal: the compact view of the data at the last run, which the next run diffs against (so hand edits between runs are caught too). Not shown or listed on /data/ | refresh.py |
| `htv.json` | How-to-vote cards registered with the VEC (from 10 Nov): seat, registered_by, party, registration, date, card_url, `order` (preference order, entered by hand from the card PDF) | refresh.py records cards; `order` and `notes` by hand and never overwritten |
| `news.json` | Headlines per district (latest 10) and statewide (latest 25): title, outlet, published, url only | refresh.py, fully rewritten each run (seat lists keep earlier items when a search fails) |
| `council_polls.json` | Upper-house primary vote by region (seeds the quota calculator); OTH is a pollster's combined "others", never one party | hand, from the pollster's release |
| `geo/districts.geojson`, `geo/regions.geojson` | Simplified boundaries (keep both under 1.5 MB together) | `scripts/build_boundaries.py` (Vicmap Admin; the VEC only offers PDF/PNG maps) |
| `results_2022/<district>.json`, `results_2022/index.json` | 2022 results by voting centre in vec-contest-v1 format, plus swings from notional 2018 | `scripts/build_results_2022.py` (one-off) |
| `results_2026/index.json` (+ per-district files on election night) | 2026 results in the same format; empty until 28 Nov, when the home map's Result mode switches on | `scripts/vec_feed.py` |
| `headshots.json` | Candidate photos: id, file (320px) and files {320,160}, source {credit, page, image_url}, licence note, match, date_added | `scripts/build_headshots.py` |
| `localities.json` | Suburb/locality and postcode → district(s) with area shares, for search | `scripts/build_localities.py` (Vicmap Admin boundaries; the VEC publishes no downloadable locality list) |

Candidate ids (headshots, avatars) are `<district-or-region id>/<slug of "Given Surname">`, e.g. `bendigo-west/brenton-baldwin`; `App.candidateId(seat, name)` builds them and handles "Surname, Given". Show people with `App.avatar(shots, seat, name, party)`: the photo where `headshots.json` has one, else party-colour initials. Every list that shows photos ends with `App.photoCredits(...)` so each photo's source is credited.

Party codes: ALP, LIB, NAT, LNP (joint Coalition), GRN, ONP, IND, ILAB (Independent Labor), AJP, LCV, VS, LBT, FF, SAL, ND, WEST, SFF, DLP, SUS, OTH.

## Data pipeline and merge rules (`scripts/refresh.py`)

Order each run: polls → Wikipedia candidates → ABC guide (district pages, then retiring MPs, then the A-Z reconciliation) → Sportsbet → VEC placeholder → VEC how-to-vote register → news → change log → meta.json.

- **Never delete a candidate row.** Rows only change status.
- **Wikipedia** adds names not already present as `announced` (`source: "wikipedia"`, `date_added`) and never changes existing rows.
- **ABC guide is the primary lower-house source.** ABC-listed candidates become `endorsed` (`source: "abc"`, ABC page URL). A `vec_nominated` row is never overridden.
- **Supersede rule:** an ABC entry for a party in a seat supersedes every other active row for that party in that seat. The older row is kept with `status: "superseded"`, `superseded_by`, `superseded_on` and a note, and a warning is logged. District pages hide superseded rows.
  - Independents (IND/OTH) can field several people in one seat, so one is only superseded by a near-identical spelling of the same person: first name AND surname must closely match. A shared surname alone never counts.
- Name matching ignores case, accents, punctuation and titles. An accent-only difference keeps the existing spelling. An unrecognised ABC party label never replaces a known party.
- **Reconciliation:** every name on the ABC A-Z list is checked against the tracker. Missing names are added under the same rules. A summary goes to `meta.json` → `reconciliation`.
- **Politeness:** ABC requests are made one per second, with a descriptive User-Agent, and three tries per page. If any page fails three times, the whole ABC step is skipped and no file changes. Check robots.txt before adding any new scraped source.
- **News:** one request per second, one try per feed or search, and a source that fails is skipped (after 5 failed searches in a row the rest are skipped). Google News RSS and the Geelong Advertiser are excluded because their robots.txt disallows us; Bing News RSS search stands in for Google. Store the headline, outlet, date and link only; article summaries are used for matching to seats and then dropped.
- **Failure handling:** if any fetch or parse fails, log it (plus a `::warning::` in Actions), keep the existing file, and exit 0.

## Results format (vec-contest-v1)

2022 history and 2026 election night use one JSON shape that mirrors the VEC media feed (AEC mediafeed/EML), so `maps.js`'s booth map and the seat-page result panels read both. The format is defined in `scripts/results_format.py`, which also maps feed elements to JSON keys. Don't add fields to one source only; add them to the format, both builders, and `vec_feed.py --selftest`, which checks that the keys match `results_2022`. The VEC feed and its sample files are covered by the VEC's terms of use, so keep them out of the repo (the samples folder is git-ignored).

## Copyright: link, never copy

Never copy article text, ABC prose (candidate profiles, biographies, seat descriptions, "Held by" sentences), or any other publisher's editorial text into data files or pages. Store only facts (names, parties, numbers, dates, classifications) and **link** to the source page (e.g. `abc_url`). News is headlines and links only. Timeline entries and profiles are facts in our own words, with no commentary. The same goes for images: ABC-hosted candidate photos are not published (`build_headshots.py --publish non-abc`); those candidates get the initials avatar.

## Design system

All colours are CSS variables on `:root`, redefined for dark mode under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and again under `:root[data-theme="dark"]`. Charts read the same variables (`App.partyColor`).

Party colours (ABC convention). Dark-mode values are lightened for contrast on dark backgrounds.

| Party | Variable | Light | Dark |
|---|---|---|---|
| Labor (ALP) | `--p-alp` | `#E13940` | `#F0646A` |
| Liberal (LIB, LNP) | `--p-lib` | `#1C4F9C` | `#6D9BE0` |
| Nationals (NAT) | `--p-nat` | `#006946` | `#3FB27F` |
| Greens (GRN) | `--p-grn` | `#10C25B` | `#3DDC7E` |
| One Nation (ONP) | `--p-onp` | `#F36C21` | `#FF8A4C` |
| Independents (IND, ILAB) | `--p-ind` | `#008080` | `#33B3B3` |
| Animal Justice (AJP) | `--p-ajp` | `#B8008A` | `#E04DB8` |
| Legalise Cannabis (LCV) | `--p-lcv` | `#6C8F2B` | `#97BF52` |
| Victorian Socialists (VS) | `--p-vs` | `#8B0000` | `#D14B4B` |
| Libertarian (LBT) | `--p-lbt` | `#F2C400` | `#F7D44A` |
| Family First (FF) | `--p-ff` | `#0F3D73` | `#5E7FBF` |
| Other (OTH and all unlisted parties) | `--p-oth` | `#7A7A7A` | `#A3A3A3` |

Typography: **Archivo** (display: headings, brand, big numbers) and **Inter** (body), from Google Fonts, with system fallbacks (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). Every number uses tabular figures (`font-variant-numeric: tabular-nums`, set on `body`).

### Number and date formats (use the helpers in `common.js`)
- **Margins:** one decimal, e.g. `ALP 4.6`. A **swing** carries a sign: `+9.7 to L/NP`. Use `App.fmtMargin`/`App.fmtSwing`.
- **Dates:** `22 Oct 2026` (day, three-letter month, year; never "Sept"). Use `App.fmtDate`.
- **Prices:** decimal odds with two decimals and no currency sign: `1.72`. Use `App.fmtPrice`.
- **Percentages:** one decimal where the source has it (`54.7%`), otherwise as published.

## Pages and UI conventions
- The header (brand, nav, search, theme toggle) and the key-dates strip are rendered by `common.js` on every page. The navigation is the `NAV` list in `common.js`: four groups (Overview, Lower house, Upper house, About), dropdowns on desktop and a "Menu" panel at 760px and below. Add new pages there; each HTML file keeps only a four-link `<nav class="nav">` fallback for when JavaScript doesn't run.
- In-page nav targets: `index.html#state-map` (the map), `pendulum.html#scenarios`, `upper.html#quota` (asks for a region) and `upper.html#<region>/quota` (that region's quota calculator). Pages scroll to these after rendering; `scroll-margin-top` keeps them clear of the sticky header.
- Shareable URLs use the hash: `lower.html#bendigo-east`, `upper.html#northern-victoria`, `candidate.html#bendigo-west/brenton-baldwin`, `pendulum.html#swing=3.2`, `poll.html#newspoll-2026-10-22`. Poll ids are `<pollster slug>-<end date>` (refresh.py), so they survive the daily rewrite. Link a name to its profile with `App.profileLink(seat, name)`; `App.loadPeople()` merges candidates, ticket names and MLCs into one list by candidate id (two ids for one name in different seats are never merged).
- Share cards print the photo credit on the image. Seat pages and the home page have a "Share" button that builds the card on demand, shares it where the browser can share files, and otherwise downloads it. No server is involved.
- Every `<table>` in `<main>` gets a "Download CSV" button from `common.js` (built from the cells' text; a cell's `data-csv` attribute overrides its text; `data-no-csv` on a table opts out; star columns are dropped).
- Pages in subfolders (`data/index.html`) work because `common.js` resolves data files and search links against `App.ROOT`, the site root. Never list or link VEC results-feed data (`results_2026/`) on /data/.
- `localStorage` is only for per-viewer conveniences (theme, watchlist). Wrap every access in try/catch, and the page must work without it.
- Mobile first: 16px side gutter, no horizontal page scroll; tables scroll inside `.table-scroll`.

## Performance and layout stability

Lighthouse (mobile) on the home, seat, pendulum and candidate pages scores 95-100 for performance and 100 for accessibility. Keep it that way:
- Every `<script>` is `defer`, and `common.js` is the first one on each page: it builds the header, search and key-dates strip as soon as it runs rather than waiting for the chart and map libraries. Third-party stylesheets (Google Fonts, Leaflet) load with `rel="preload" ... onload` plus a `<noscript>` fallback.
- Pages paint before scripts run, so anything a script fills in must have its space reserved, or the page jumps (CLS). Each page carries empty placeholders (`#key-dates`, the header's `.search`, the `.nav-toggle` button) and CSS reserves their height; script-filled blocks (`#pref-watch`, `#region-chips`, `.pd-list`, `.tally`, the 2022 results, `#district-detail` when the URL has a seat hash) have `min-height`s. Measure before changing a reserved height.
- The inline head script adds `js` (and on lower.html `has-hash`) to `<html>`; CSS scopes the phone menu and placeholders to `html.js`, so the four fallback nav links still show without JavaScript.
- Large avatars (the profile photo) load eagerly with `fetchpriority="high"`; list avatars stay `loading="lazy"`.

## Working on the project
- Preview: `python -m http.server 8000 --directory site`.
- Test refresh.py against a copy, never the live data: `python scripts/refresh.py --data-dir <copy-of-site/data>`.
- Commit with the repo-local identity (GitHub noreply address). The workflow's bot commits data refreshes; pull before committing.
- **Batch related changes into fewer commits: one push per task, not per file.** Every push to `main` triggers a Pages deploy, so finish and test the whole task first, then commit it together and push once.
- After changing refresh.py or data, run the workflow (`gh workflow run refresh.yml --ref main`) and check its log.
