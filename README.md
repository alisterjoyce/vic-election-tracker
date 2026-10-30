# Vic Election 2026 Tracker

A static tracker for the 2026 Victorian state election (polling day Saturday 28 November 2026). It's plain HTML, CSS and vanilla JS with no build step, hosted on Netlify. A daily GitHub Action refreshes the data.

- **Home** (`index.html`): countdown, headline seat counts, a poll-of-polls chart (Chart.js 4.4.1 from cdnjs) and a table of the latest polls.
- **Lower house** (`lower.html`): filter districts by region and metro/regional, then pick one to see its sitting MP, margin and candidates with status badges.
- **Seat outlook** (on each district page, under the margin cards):
  - **Swing-adjusted margin:** the current poll-of-polls statewide 2PP swing since 2022 (`meta.json` → `previous_election`), applied uniformly to the seat margin. Shown only for Labor-v-Coalition contests.
  - **MRP estimates:** from `seat_models.json`.
  - **Betting favourite:** from `seat_odds.json`.
  - **Seat polls:** from `seat_polls.json`.
- **Upper house** (`upper.html`): pick one of the 8 regions to see its current MLCs and 2026 tickets.
- Shareable links: `lower.html#bendigo-east`, `upper.html#northern-victoria`. A district hash on the home page (`/#bendigo-east`) redirects to the lower-house page.
- Light and dark mode follow the system setting and can be overridden with the toggle in the header.
- The footer shows `last_updated` from `site/data/meta.json`.

## Layout

```
site/                  # published by Netlify
  index.html, lower.html, upper.html
  css/style.css
  js/common.js, home.js, lower.js, upper.js
  data/
    districts.json     # Legislative Assembly districts
    candidates.json    # lower-house candidates
    regions.json       # Legislative Council regions, MLCs, tickets
    polls.json         # written by scripts/refresh.py
    meta.json          # last_updated, source status, sample-data flags
    seat_models.json   # MRP seat estimates (manual; YouGov Jun-Jul 2026, DemosAU slot)
    seat_odds.json     # Sportsbet seat favourites (auto if fetchable, else manual)
    seat_polls.json    # single-seat polls (manual; empty until one is published)
scripts/refresh.py     # data refresh
.github/workflows/refresh.yml
netlify.toml
```

Each JSON file has a `_schema` key that describes its fields.

**Data sources:** the district list and each district's region come from the [VEC district](https://www.vec.vic.gov.au/electoral-boundaries/state-districts) and region pages. Sitting MPs, margins, retiring flags, candidates and upper-house tickets were seeded from a research report dated 30 October 2026, with candidate status `endorsed` or `reported` as the report marks it. The daily refresh then adds names from Wikipedia and makes the ABC election guide the primary source for the lower house (see below). No one is VEC-nominated until nominations close at noon on 9 November. Districts with `needs_check: true` are ones whose region the report flagged as uncertain.

If a file is ever reset to placeholder rows, set `meta.json` → `sample_data.<name>` to `true` to show the "sample data" banner. `refresh.py` clears the `polls` flag itself after a successful fetch.

## Run the refresh script locally

Requires Python 3.10 or newer.

```bash
python -m venv .venv
```

Activate it (`source .venv/bin/activate` on macOS/Linux, `.venv\Scripts\activate` on Windows), then:

```bash
pip install -r requirements.txt
```

```bash
python scripts/refresh.py
```

What it does:

1. Fetches [Opinion polling for the 2026 Victorian state election](https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Victorian_state_election), reads the statewide Legislative Assembly tables (under "Voting intention") with `pandas.read_html`, and writes `site/data/polls.json`.
2. Reads [Candidates of the 2026 Victorian state election](https://en.wikipedia.org/wiki/Candidates_of_the_2026_Victorian_state_election) with `pandas.read_html`, covering the Legislative Assembly table and each Legislative Council region table, and merges it into `candidates.json`:
   - Names not already present are added with status `announced`, `source: "wikipedia"` and a `date_added`. Council candidates get a `region` and `ticket_position` instead of a `district`.
   - Existing rows are never changed, downgraded or deleted. A name counts as already present if it matches ignoring case, accents and punctuation, or if it's a near-identical spelling for the same party and seat. Council names already on a ticket in `regions.json` also count.
   - If Wikipedia lists a second candidate for a party that already has one in a seat, the new row gets a "Conflicts with …" note, and the script logs a warning.
3. Reads the [ABC election guide](https://www.abc.net.au/news/elections/vic/2026/guide/electorates), the **primary source for lower-house candidates**:
   - It collects each district's ABC code from the electorates index and stores it in `districts.json` as `abc_code` and `abc_url`. Each district page on the site links to its ABC page.
   - From each district page it takes only facts: the margin and classification (e.g. "Very Safe Labor 14.6%"), the sitting member, whether the "Held by" line says they are retiring, and the "Candidates in alphabetical order" table. No profile or biography text is stored.
   - ABC-listed candidates are set to `endorsed` with `source: "abc"` and the page URL. A `vec_nominated` row is never overridden.
   - **Supersede rule:** an ABC entry for a party in a seat supersedes any other row for that party there. The older row is kept, not deleted. Its status becomes `superseded`, with `superseded_by`, `superseded_on` and a note, and the script logs a warning. Independents are handled differently because several can stand in one seat. One is only superseded by a near-identical spelling of the same name: a close match on both first name and surname, such as "Ashley Vandenburg" / "Ashleigh Vandenberg". A shared surname alone doesn't count.
   - The [retiring MPs page](https://www.abc.net.au/news/elections/vic/2026/guide/retiring-mps) sets `retiring` for MPs and MLCs. It currently lists only MPs.
   - **Reconciliation:** after the district pages, the ABC's [A-Z candidate list](https://www.abc.net.au/news/elections/vic/2026/guide/candidates) is checked name by name and electorate by electorate. Any name not in `candidates.json` is added under the same rules, and the script logs a warning. A summary goes to `meta.json` → `reconciliation`:
     - the date;
     - totals for the tracker (active lower-house rows) and the ABC list;
     - the tracker's rows by source;
     - how many are only in the tracker, and how many were only on the ABC list.

     The site footer shows "N candidates tracked, last reconciled <date>". N counts active candidates in `candidates.json` for both houses; upper-house ticket names in `regions.json` aren't included.
   - It is polite to the ABC: one request per second and a descriptive User-Agent. If any page fails three times, the whole ABC step is skipped and no file changes. A full run makes about 91 requests, so it takes about a minute and a half.
4. Tries the Sportsbet Victorian election seat markets for `seat_odds.json`, after checking robots.txt. Sportsbet currently refuses the connection (TLS handshake failure) from scripts, so the file is treated as **manual**: the last values are kept and the site shows "as at <date>". Enter favourites and prices by hand, and set `date_checked`. The parser is generic and untested against a live response.
5. Calls `fetch_vec_candidates()`, a clearly marked **placeholder** for the VEC candidate list. It returns `None` until implemented, so this step leaves `candidates.json` alone.
6. Updates `meta.json`: `last_updated` (only when a source refreshed successfully) and the per-source status.

If any fetch or parse fails, the error is logged (and shown as a warning annotation in GitHub Actions), and the existing file is kept as it was.

To try it without touching the committed data, point it at a copy:

```bash
python scripts/refresh.py --data-dir /tmp/data-copy
```

## Preview the site locally

The pages load JSON with `fetch`, so open them over HTTP rather than `file://`:

```bash
python -m http.server 8000 --directory site
```

Then visit http://localhost:8000.

## Automation

`.github/workflows/refresh.yml` runs every day at 20:00 UTC (7am AEDT) and can also be run by hand from the Actions tab (`workflow_dispatch`). It installs `requirements.txt`, runs `scripts/refresh.py`, and commits and pushes `site/data` if anything changed. Netlify redeploys on each push.

## Deploy

Netlify reads `netlify.toml`: it publishes `site/` with an empty build command. Connect the GitHub repo in Netlify and it will deploy on every push to `main`.
