# Vic Election 2026 Tracker: project conventions

A static tracker for the 2026 Victorian state election (polling day Sat 28 Nov 2026). Plain HTML, CSS and vanilla JS with **no build step**, published from `site/` by Netlify. Data lives in JSON files, refreshed daily by `scripts/refresh.py` through a GitHub Action.

## File layout

```
site/                     # published as-is (netlify.toml: publish = "site", no build command)
  index.html              # home: countdown, seat counts, poll-of-polls chart, latest polls
  lower.html              # Legislative Assembly: filters, district detail, seat outlook (#district-id)
  upper.html              # Legislative Council: 8 regions, MLCs, tickets (#region-id)
  myseats.html            # watchlist ("My seats"), stored in localStorage
  about.html              # about and methodology, sources, credits
  css/style.css           # all styles; design tokens on :root
  js/common.js            # shared: data loading, theme, formats, party palette, header chrome
                          #   (key-dates strip, search, footer), poll smoothing, seat-outlook maths
  js/home.js, lower.js, upper.js, myseats.js
  data/*.json             # every file has a "_schema" key describing its fields
scripts/refresh.py        # daily refresh (see "Data pipeline")
scripts/build_localities.py  # rebuilds data/localities.json from Vicmap Admin polygons (run by hand; needs shapely)
scripts/build_boundaries.py  # data/geo/{districts,regions}.geojson, topology-preserving simplification (needs shapely, topojson)
scripts/results_format.py    # the vec-contest-v1 results format (2022 history and 2026 election night)
scripts/build_results_2022.py  # data/results_2022/ from VEC 2022 results by voting centre (one-off)
scripts/vec_feed.py       # VEC media feed (XML) -> vec-contest-v1; --selftest <samples folder>
site/js/maps.js           # Leaflet: home choropleth with metro inset, seat-page booth map
.github/workflows/refresh.yml   # 20:00 UTC daily + workflow_dispatch; commits site/data if changed
```

Not committed: the research report `.md` in the repo root, source screenshots and PDFs, `.cache/` (Vicmap downloads) and `.claude/`, all via `.gitignore` except the report, which is simply never added.

## Data files

Each file's `_schema` is the authoritative field list. Keep it in sync when adding fields.

| File | Contents | Maintained by |
|---|---|---|
| `districts.json` | 88 districts: region (from the VEC), sitting MP, party, margin `{party, vs, pct}`, ABC classification/code/url, retiring, needs_check | seed + refresh.py (ABC) |
| `candidates.json` | Candidates for both houses. Assembly rows have `district`; Council rows have `region` + `ticket_position` | seed + refresh.py (Wikipedia, ABC) |
| `regions.json` | 8 regions: MLCs (with retiring), tickets, notes | seed + refresh.py (MLC retiring only) |
| `polls.json` | Statewide polls (primaries, 2PP) | refresh.py (Wikipedia), fully rewritten each run |
| `meta.json` | last_updated, previous_election 2PP baseline, key_dates, source status, reconciliation summary | refresh.py + hand |
| `seat_models.json` | MRP seat estimates, one entry per district per model; `null` = not published | hand |
| `seat_odds.json` | Sportsbet market per district: options, favourite, joint_favourites, partial, date_checked | hand (refresh.py tries Sportsbet; it is blocked, so the file is kept as manual) |
| `seat_polls.json` | Single-seat polls | hand |
| `geo/districts.geojson`, `geo/regions.geojson` | Simplified boundaries (keep both under 1.5 MB together) | `scripts/build_boundaries.py` (Vicmap Admin; the VEC only offers PDF/PNG maps) |
| `results_2022/<district>.json`, `results_2022/index.json` | 2022 results by voting centre in vec-contest-v1 format, plus swings from notional 2018 | `scripts/build_results_2022.py` (one-off) |
| `results_2026/index.json` (+ per-district files on election night) | 2026 results in the same format; empty until 28 Nov, when the home map's Result mode switches on | `scripts/vec_feed.py` |
| `localities.json` | Suburb/locality and postcode → district(s) with area shares, for search | `scripts/build_localities.py` (Vicmap Admin boundaries; the VEC publishes no downloadable locality list) |

Party codes: ALP, LIB, NAT, LNP (joint Coalition), GRN, ONP, IND, ILAB (Independent Labor), AJP, LCV, VS, LBT, FF, SAL, ND, WEST, SFF, DLP, SUS, OTH.

## Data pipeline and merge rules (`scripts/refresh.py`)

Order each run: polls → Wikipedia candidates → ABC guide (district pages, then retiring MPs, then the A-Z reconciliation) → Sportsbet → VEC placeholder → meta.json.

- **Never delete a candidate row.** Rows only change status.
- **Wikipedia** adds names not already present as `announced` (`source: "wikipedia"`, `date_added`) and never changes existing rows.
- **ABC guide is the primary lower-house source.** ABC-listed candidates become `endorsed` (`source: "abc"`, ABC page URL). A `vec_nominated` row is never overridden.
- **Supersede rule:** an ABC entry for a party in a seat supersedes every other active row for that party in that seat. The older row is kept with `status: "superseded"`, `superseded_by`, `superseded_on` and a note, and a warning is logged. District pages hide superseded rows.
  - Independents (IND/OTH) can field several people in one seat, so one is only superseded by a near-identical spelling of the same person: first name AND surname must closely match. A shared surname alone never counts.
- Name matching ignores case, accents, punctuation and titles. An accent-only difference keeps the existing spelling. An unrecognised ABC party label never replaces a known party.
- **Reconciliation:** every name on the ABC A-Z list is checked against the tracker. Missing names are added under the same rules. A summary goes to `meta.json` → `reconciliation`.
- **Politeness:** ABC requests are made one per second, with a descriptive User-Agent, and three tries per page. If any page fails three times, the whole ABC step is skipped and no file changes. Check robots.txt before adding any new scraped source.
- **Failure handling:** if any fetch or parse fails, log it (plus a `::warning::` in Actions), keep the existing file, and exit 0.

## Results format (vec-contest-v1)

2022 history and 2026 election night use one JSON shape that mirrors the VEC media feed (AEC mediafeed/EML), so `maps.js`'s booth map and the seat-page result panels read both. The format is defined in `scripts/results_format.py`, which also maps feed elements to JSON keys. Don't add fields to one source only; add them to the format, both builders, and `vec_feed.py --selftest`, which checks that the keys match `results_2022`. The VEC feed and its sample files are covered by the VEC's terms of use, so keep them out of the repo (the samples folder is git-ignored).

## Copyright: link, never copy

Never copy article text, ABC prose (candidate profiles, biographies, seat descriptions, "Held by" sentences), or any other publisher's editorial text into data files or pages. Store only facts (names, parties, numbers, dates, classifications) and **link** to the source page (e.g. `abc_url`).

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
- The header (brand, nav, search, theme toggle) and the key-dates strip are rendered by `common.js` on every page. Add new pages to the nav in all HTML files.
- Shareable URLs use the hash: `lower.html#bendigo-east`, `upper.html#northern-victoria`.
- `localStorage` is only for per-viewer conveniences (theme, watchlist). Wrap every access in try/catch, and the page must work without it.
- Mobile first: 16px side gutter, no horizontal page scroll; tables scroll inside `.table-scroll`.

## Working on the project
- Preview: `python -m http.server 8000 --directory site`.
- Test refresh.py against a copy, never the live data: `python scripts/refresh.py --data-dir <copy-of-site/data>`.
- Commit with the repo-local identity (GitHub noreply address). The workflow's bot commits data refreshes; pull before committing.
- After changing refresh.py or data, run the workflow (`gh workflow run refresh.yml --ref main`) and check its log.
