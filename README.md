# Vic Election 2026 Tracker

A static tracker for the 2026 Victorian state election (polling day Saturday 28 November 2026). It's plain HTML, CSS and vanilla JS with no build step, hosted on Netlify. A daily GitHub Action refreshes the data.

- **Home** (`index.html`): countdown, headline seat counts, a poll-of-polls chart (Chart.js 4.4.1 from cdnjs) and a table of the latest polls.
- **Lower house** (`lower.html`): filter districts by region and metro/regional, then pick one to see its sitting MP, margin and candidates with status badges.
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
scripts/refresh.py     # data refresh
.github/workflows/refresh.yml
netlify.toml
```

Each JSON file has a `_schema` key that describes its fields.

**Data sources:** the district list and each district's region come from the [VEC district](https://www.vec.vic.gov.au/electoral-boundaries/state-districts) and region pages. Sitting MPs, margins, retiring flags, candidates and upper-house tickets come from a research report dated 30 October 2026. Candidate status is `endorsed` or `reported` as the report marks it. No one is VEC-nominated until nominations close at noon on 9 November. Districts with `needs_check: true` are ones whose region the report flagged as uncertain.

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
2. Calls `fetch_vec_candidates()`, a clearly marked **placeholder** for the VEC candidate list. It returns `None` until implemented, so `candidates.json` is left alone.
3. Updates `meta.json`: `last_updated` (only when a source refreshed successfully) and the per-source status.

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
