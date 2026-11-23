# Vic Election 2026 Tracker

A static tracker for the 2026 Victorian state election (polling day Saturday 28 November 2026). It's plain HTML, CSS and vanilla JS with no build step, hosted on GitHub Pages. A GitHub Action refreshes the data four times a day and redeploys when it changes. It installs as an app on phones and desktops and works offline.

**Live site: https://alisterjoyce.github.io/vic-election-tracker/**

- **Home** (`index.html`): a headline card first: the poll-of-polls 2PP and its move over the last fortnight, a line with the other aggregates (BludgerTrack, Ace Strategies, electiontracker.au) linked to the Polls page's comparison, the seat projection from the published seat models (each party's median as a dot and the lowest-to-highest range as a bar, beside a hemicycle of the medians as whole seats), a bar of Sportsbet favourites by party (ties and partial markets count as undecided), each with the 45-seat majority line, and the countdown. Then a map of all 88 districts (Leaflet), coloured by holder, margin band, Sportsbet favourite, forecast winner, model disagreement (how many seat-by-seat sources differ on the winner) or (from 28 Nov) result, with a Regions view for the upper house, a party legend and a "Find my seat" button (browser location, asked for once and not stored). Desktop shows the state with a Melbourne inset; phones open on greater Melbourne with a "Show all Victoria" toggle. Below the map: the ten closest seats in the betting (favourite under 2.00) and the five latest statewide headlines, then seat counts, a poll-of-polls chart (Chart.js 4.4.1 from cdnjs: each poll a dot, the average a line with its 95% band, "Since 2022" or "Last 12 months", tap a poll to see it and again to open it), the early and postal votes chart and the latest polls.
- **Lower house** (`lower.html`): filter districts by region and metro/regional, then pick one to see its sitting MP, margin and candidates with status badges. Each district links to its ABC guide page and its page in [The Poll Bludger's guide](https://pollbludger.net/vic2026/) (`LA.htm?s=` + the name without spaces); where the Poll Bludger's guide lists a different margin, a note under ours gives its figure ("Poll Bludger: GRN 12.0% vs LIB (2CP)"), and the Data page lists every such seat.
- **Seat outlook** (on each district page, under the margin cards):
  - **Swing-adjusted margin:** the current poll-of-polls statewide 2PP swing since 2022 (`meta.json` → `previous_election`), applied uniformly to the seat margin. Shown only for Labor-v-Coalition contests.
  - **Forecasts:** a one-line summary of who each source favours, then one row per candidate, sorted by the median win chance across the sources that give one (largest first), with ballot position as a column and a column per source with its date: Australian Election Forecasts' win chance, the YouGov MRP's call, RedBridge's rating (statewide totals only, so "not modelled"), and Sportsbet's price as a chance with the bookmaker's margin removed; each source's favourite is highlighted. Below it, the likeliest final two (the model's top three final pairings with their chance) and the 2022 final pair. From `seat_models.json` and `seat_odds.json`.
  - **Betting favourite:** from `seat_odds.json`, shortest price first.
  - **Seat polls:** from `seat_polls.json`.
- **Upper house** (`upper.html`): pick one of the 8 regions to see its current MLCs and 2026 tickets.
- **Candidates** (`candidate.html`): a directory of every candidate and current MLC (filter by name, seat, house, party), and a profile for each (`candidate.html#bendigo-west/brenton-baldwin`): photo with its source credit, party, status, seat facts, sources, others in the same contest, and a downloadable share card. Seat pages have a share card too.
- **Pendulum** (`pendulum.html`): all 88 seats on a two-sided ladder by notional margin, with a swing slider (−10 to +15, starting at the poll-of-polls swing) that recolours seats that fall and counts seats against the 45-seat majority line. Only Labor-v-Coalition contests swing; it is labelled as a what-if that doesn't model One Nation or independents. Below it, "What the seat models say" (the models' seat ranges) and three scenarios (Coalition majority, Coalition relying on One Nation, Labor-Greens minority), each with the swing and 2PP range it needs, the seats that must fall and which current polls support it, recomputed from `polls.json` and `seat_odds.json` on every load.
- **Key contests** (`contests.html`, Overview menu): every seat where the sources favour different winners or no candidate's median chance reaches 60%, closest first, each with the seat page's forecast comparison (summary line, every candidate source by source, likely final two and the 2022 final pair). `contests.html#melton` links to one seat.
- **Build your own prediction** (`predict.html`, Overview menu): all 88 seats by region, each starting on the party most seat-by-seat sources pick (the seat models that rate each seat and Sportsbet's favourite); tap to change a winner and the hemicycle and party totals update live. "Reset to models" starts again, Share makes a 1200x630 image, and the picks stay in the browser (localStorage).
- **Timeline** (`timeline.html`): the 2022-2026 term from `timeline.json`: by-elections with results, leadership changes, retirements, defections, the end of group voting tickets and the election timetable, each with a date, one line and a source, filterable by type, with a "today" marker.
- **Preferences:** each seat and region page shows every how-to-vote card registered with the VEC side by side (`htv/<seat>.json`): the preference number each card gives each candidate (Council: each group above the line), read from the card PDFs, with a link to each original, the candidates no card covers ("no card registered"), and a flag wherever a Labor, Liberal or Nationals card numbers One Nation or the Greens ahead of the other side of government. The lower-house page has a statewide "Preference watch" and the Data page a coverage count.
- **Your ballot** (`ballot.html#melton`): mock-ups of a district's two ballot papers in the VEC's ballot order (the Assembly paper, and the region's Council paper with groups above the line and candidates below), every registered how-to-vote card's order beside them (labelled as that party's or candidate's recommendation), and the VEC's rules for a formal vote. Printable, and shareable as an image. Reached from a "Your ballot" button on each seat page and from search results.
- **Where to vote** (each seat page): the district's early voting centres and election-day voting centres from the VEC, with address and wheelchair access, pinned on the voting-centre map.
- **Early and postal votes:** a home-page chart of the running totals the VEC publishes, against 2022; each seat page shows its district's figures as a share of enrolment once the VEC publishes them by district; on election night each seat shows how many of those votes are still to be counted.
- **Compare candidates** (each seat page): the candidates side by side in ballot order: party, occupation, prior roles and stated priorities from their researched profiles.
- **This week** (home page): a 1200x630 briefing image with the poll average, the seat models' medians and ranges with a hemicycle, the three seats whose model probability or Sportsbet price moved most in 7 days, and the next key date. The latest is always at `share/this-week.png`, redrawn at each refresh.
- **Data downloads** (`data/`): each JSON file with its fields, credit and licence (CC BY 4.0 for this site's data; VEC, ABC, Wikipedia and Vicmap credited). Every table on the site has a "Download CSV" button.
- **Share buttons:** each seat page and the home page make a 1200x630 image in the browser (seat: holder, margin, Sportsbet favourite, leading candidates; home: poll average and seat projection) and share it, or download it where sharing isn't available.
- **News:** each seat page lists the latest 10 headlines that mention the district, its MP or a candidate, and the home page shows the five latest statewide, with an outlet filter (`news.json`). Headlines and links only. The Data page's "News sources" table shows each source's status and its headlines in the last 7 days.
- **Polls** (`poll.html`): every poll (from Wikipedia, plus any entered by hand in `scripts/polls_manual.json` or listed in electiontracker.au's poll ledger before Wikipedia lists them), with who commissioned it (media, the pollster, a party, a union or an advocacy group); polls the poll of polls leaves out are greyed with the reason. A page per poll (`poll.html#newspoll-2026-10-22`) has pollster, commissioner, fieldwork, sample, primaries, 2PP, preferred premier, approval, source link, and that pollster's trend against the other pollsters' average (its house effect). The list page opens with "Aggregates compared": this site's poll of polls beside BludgerTrack, Ace Strategies and electiontracker.au (primary vote by party, 2PP where published, date and source link), with a line on how this site's average is calculated. A poll that set a new high or low for a party says so ("Lowest Labor primary recorded"), and the home page's poll-of-polls chart marks those polls.
- **Quota calculator** (on each region in `upper.html`): editable primary votes seeded from the latest regional poll (`council_polls.json`), live quota maths under the 2026 rules, and an adjustable exhaustion rate; shows the 5 seats filled and the margin for the last seat.
- **My seats** (`myseats.html`): seats starred with ☆, saved in the browser's localStorage (no backend), shown side by side.
- **Results** (`results.html`, from 6 pm on 28 Nov): a hemicycle (called seats solid, leading seats outlined) and the seat tally (called, leading, undecided) against the 45-seat line, seats changing hands, every seat with its leader, 2CP share, swing and count progress, and upper-house quotas filled by region. Each seat page gets a 2026 panel (count progress, candidate votes, the booth map coloured by 2CP leader) and each region page a quotas-filled panel. "Called" is this site's projection, labelled as such; the VEC is credited on every view. The "Results" menu item appears once counting starts.
- **Policies** (`policies.html`, About menu): a party-by-issue matrix of each major party's published position on 15 issues, from [Australian Election Tracker (OZE)](https://electiontracker.au/elections/vic/2026/parties/matrix)'s policy ledger (CC BY 4.0), copied at every refresh. Each cell opens the claims behind it, each linked to its source; the ledger's caveat is shown as it asks, with a note that it is a ledger of published claims, not a rating. The Liberal and National parties show combined (shared Coalition policies) or separately. Shareable as `policies.html#housing-planning/labor`.
- **Voting** (`voting.html`): key dates and hours, where to vote (a district picker linking to each seat page's voting centres), how to fill in both ballot papers formally, and help with voting (assisted voting, accessible centres, telephone voting for blind or low-vision voters, interpreters and Auslan, postal and interstate voting), each item linked to the VEC page it comes from.
- **Independence, Disclaimer, Privacy, Terms of use** (`independence.html`, `disclaimer.html`, `privacy.html`, `terms.html`): linked from the About menu and every page's footer, which also carries the authorisation line.
- **About** (`about.html`): what each number means, sources and refresh times, limits, corrections and credits.
- **Navigation:** four groups (Overview, Lower house, Upper house, About) with dropdowns on desktop and a Menu button on phones, built by `common.js`.
- **On every page:** a key-dates strip under the header (countdowns plus a "Today:" note, from `meta.json` → `key_dates`), and a search box that matches districts, regions, candidates, suburbs and postcodes, grouped as Seats, Candidates (with party colours), Suburbs and Postcodes, with arrow keys, Enter and a "/" shortcut. On the home page it heads the headline card, with a search button in the header.
- Shareable links: `lower.html#bendigo-east`, `upper.html#northern-victoria`, `candidate.html#bendigo-west/brenton-baldwin`. A district hash on the home page (`/#bendigo-east`) redirects to the lower-house page.
- **Ordering:** anything that shows a number per party or candidate is sorted by that number, largest first (ties in a fixed alphabetical party order); candidate lists without a projection follow the VEC's ballot order.
- Light and dark mode follow the system setting and can be overridden with the toggle in the header.
- The footer shows `last_updated` from `site/data/meta.json`.

## Layout

```
site/                  # published by GitHub Pages
  index.html, lower.html, upper.html, candidate.html, pendulum.html, predict.html, poll.html, ballot.html, voting.html, myseats.html, about.html,
  independence.html, disclaimer.html, privacy.html, terms.html
  css/style.css
  js/common.js, home.js, lower.js, upper.js, candidate.js, sharecard.js, ballot.js, voting.js, predict.js
  data/
    districts.json     # Legislative Assembly districts
    candidates.json    # lower-house candidates
    regions.json       # Legislative Council regions, MLCs, tickets
    polls.json         # written by scripts/refresh.py (Wikipedia, hand entries, electiontracker.au poll ledger)
    poll_ledger.json   # electiontracker.au poll ledger as last read (refresh.py; pages do not load it)
    poll_aggregates.json  # other sites' poll averages: BludgerTrack, Ace Strategies, electiontracker.au (refresh.py)
    pollbludger_margins.json  # The Poll Bludger guide's seat margins and where they differ from ours (refresh.py, daily)
    meta.json          # last_updated, source status, sample-data flags
    seat_models.json   # MRP seat estimates (manual; YouGov Jun-Jul 2026, DemosAU slot)
    seat_odds.json     # Sportsbet seat markets: every option and price, favourite (manual; entered from screenshots, 30 Oct and 17 Nov 2026; earlier prices kept per seat in `history`)
    seat_polls.json    # single-seat polls (manual; empty until one is published)
    seat_history.json  # a daily snapshot of each seat's model probabilities and prices, for the weekly card (refresh.py)
    voting_centres/    # where to vote: <district>.json per district plus index.json (refresh.py via scripts/vec_voting.py, daily)
    early_votes.json   # early and postal votes, enrolment, 2022 comparison (refresh.py via scripts/vec_voting.py)
    council_polls.json # upper-house primary vote by region (manual; seeds the quota calculator)
    timeline.json      # the term's events and the election timetable (manual)
    htv.json           # registered how-to-vote cards and the order each prints (refresh.py via scripts/vec_htv.py);
                       #   htv/<seat>.json per district and region, htv/index.json counts
    news.json          # headlines per seat and statewide (refresh.py)
    news_manual.json   # articles added to the news by hand: url, title, outlet, published, seats
    changelog.json     # internal record of what changed at each refresh (refresh.py); not shown on the site. Plus changelog_state.json
    index.html         # the /data/ page
    localities.json    # suburb/postcode -> district(s) for search (scripts/build_localities.py)
    headshots.json     # candidate photos: files, source credit, licence note (scripts/build_headshots.py)
    profiles.json      # researched candidate profiles, a source for every fact (by hand; rules in CLAUDE.md)
    profiles/          # the same split by seat, <seat id>.json, plus index.json: what the candidate page loads (scripts/profiles_split.py)
  share/this-week.png  # the weekly briefing image (scripts/build_share.py, each refresh)
  photos/320/, 160/    # candidate headshots (WebP)
  fonts/               # Archivo and Inter, self-hosted (SIL Open Font License; scripts/build_fonts.py)
  icons/               # app icons (scripts/build_icons.py)
  manifest.webmanifest # the installable app's manifest
  sw.js                # service worker: offline shell, cached data, update prompt
scripts/refresh.py     # data refresh
scripts/build_localities.py  # rebuilds localities.json from Vicmap boundaries (by hand; needs shapely)
scripts/build_boundaries.py  # map boundaries (by hand; needs shapely + topojson)
scripts/build_results_2022.py  # 2022 results by voting centre (by hand, one-off)
scripts/build_headshots.py  # headshot zip -> WebP photos + headshots.json (by hand; needs Pillow)
scripts/build_fonts.py      # downloads, trims and subsets the web fonts into site/fonts/ (by hand; needs fonttools, brotli)
scripts/build_icons.py      # draws the app icons into site/icons/ (by hand; needs Pillow)
scripts/data_changed.py     # tells the refresh workflow whether the data really changed
scripts/vec_voting.py       # the VEC's voting centres, early and postal votes, and enrolment (run by refresh.py)
scripts/build_share.py      # draws share/this-week.png with the site's own sharecard.js in headless Chromium (refresh workflow)
scripts/vec_feed.py    # converts the VEC election-night media feed to the same format; --selftest on the VEC samples
CLAUDE.md              # project conventions: schemas, merge rules, design system, formats
.github/workflows/refresh.yml
netlify.toml
```

Each JSON file has a `_schema` key that describes its fields.

**Data sources:** the district list and each district's region come from the [VEC district](https://www.vec.vic.gov.au/electoral-boundaries/state-districts) and region pages. Sitting MPs, margins, retiring flags, candidates and upper-house tickets were seeded from a research report dated 30 October 2026, with candidate status `endorsed` or `reported` as the report marks it. The scheduled refresh then adds names from Wikipedia and makes the ABC election guide the primary source for the lower house (see below). No one is VEC-nominated until nominations close at noon on 9 November. Districts with `needs_check: true` are ones whose region the report flagged as uncertain.

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

1. Fetches [Opinion polling for the 2026 Victorian state election](https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Victorian_state_election), reads the statewide Legislative Assembly tables (under "Voting intention") with `pandas.read_html`, and writes `site/data/polls.json`. Each poll gets a stable id, its client and its first citation link; preferred-premier, approval and three-party-preferred rows from the page's other tables are attached to the same firm's poll with overlapping fieldwork.
   - Then reads [electiontracker.au's poll ledger](https://electiontracker.au/elections/vic/2026/polls) (`/data/vic2026/polls.json`, CC BY 4.0; robots.txt checked first) and matches it to Wikipedia's polls (same firm, fieldwork overlapping or ending within 7 days). A matched poll keeps Wikipedia's figures and gains any field its row lacks (client, sample, source link; recorded in `supplemented`); a ledger poll Wikipedia lacks is added (`added_from: "electiontracker"`) and reported in the log and the run summary. Every poll gets `commissioned_by` {category, name}: the ledger's commissioner type where it lists the poll, else the client Wikipedia names, else a firm that publishes its own polls. The poll of polls (`App.pollExclusion` in `common.js`) leaves out party-, union- and advocacy-commissioned polls and samples under 800 or not published, following [electiontracker.au's published rule](https://github.com/coldix/elections/blob/main/docs/poll-methodology.md#which-polls-to-use). If the ledger can't be read, the copy kept in `site/data/poll_ledger.json` is used.
   - Then reads three other sites' poll averages into `site/data/poll_aggregates.json` for the polls page's "Aggregates compared" table: [electiontracker.au](https://electiontracker.au/elections/vic/2026/polls)'s open `poll-average.json` (CC BY 4.0) on every run, and once a day the XML file [BludgerTrack Victoria](https://www.pollbludger.net/vic2026/bludgertrack/)'s page draws from and [Ace Strategies' polls page](https://acestrategies.au/victoria-election-2026/polls) (its robots.txt disallows `/api/`, so only the page is read). Each robots.txt is checked first, one request a second. Only figures (primary vote by party, 2PP where published), dates and links are kept; figures that don't add up are rejected. A source that fails keeps its last values (`--aggregates-check` reads the daily two again).
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
4. Checks the candidate list against [electiontracker.au](https://electiontracker.au/elections/vic/2026)'s open data (`candidates.json`, CC BY 4.0, read politely after its robots.txt). Only names, parties, contests and status are used. Candidacies it lists that the tracker doesn't have (candidates.json and the regions' tickets) are reported in `meta.json` → `reconciliation_electiontracker` for checking by hand; nothing is added from it.
   - It also reads their `retirements.json`. An MP or MLC it lists as retiring whom the tracker doesn't flag is reported in `meta.json` → `reconciliation_electiontracker_retirements` (with the source link) and the log. The flag is set automatically only when that source is a party or Parliament page or a mainstream news outlet (by the link's domain: `ET_OFFICIAL_DOMAINS`, `ET_MAINSTREAM_DOMAINS`); the flag then carries `retiring_source`, which the ABC step keeps. Anything else (a local paper, a social post, an MP's own site) is left for checking by hand.
   - And it copies their `policies.json` and `issues.json` into `site/data/policies.json` for the Policies page (rewritten only when the content changes).
   - Once a day it reads the seat margins listed on [The Poll Bludger's guide](https://pollbludger.net/vic2026/) (William Bowe; robots.txt checked first, one request) into `site/data/pollbludger_margins.json`: per seat the holder, the other side, the margin and its basis (2PP for Labor v Coalition, 2CP otherwise), and the seats where it differs from `districts.json` (another holder, another pair, or a gap over 0.1 points; recomputed every run). Figures and links only, never the guide's text; a failed read keeps the last values (`--aggregates-check` reads it again).
5. Tries the Sportsbet Victorian election seat markets for `seat_odds.json`, after checking robots.txt. Sportsbet currently refuses the connection (TLS handshake failure) from scripts, so the file is treated as **manual**: the last values are kept and the site shows "as at <date>". Enter favourites and prices by hand and set `date_checked`, moving each seat's previous row into its `history` list so the seat page can show how prices moved. The parser is generic and untested against a live response.
6. Reads the VEC's official candidate list (`scripts/vec_nominations.py`): the spreadsheet of nominated candidates and every district and region nominations page, one request a second (names, parties, ballot positions and Council groups only). It runs on the evening refresh, and on every refresh until the ballot order is published (`--vec-check` runs it any time). The list is written to `vec_nominations.json` and applied: matching candidates become `vec_nominated` with their ballot position and the VEC's spelling (profiles and photos follow a respelling), names the tracker lacked are added, and anyone not on the list is marked `withdrawn` ("did not nominate"). Region tickets follow the VEC's groups. Every change since the previous check (a correction, a removal, a ballot position moving) is logged as a warning. `meta.json` → `nominations.official` gets the total, and the home page's badge reads "Official candidates: N (VEC)". After the list is loaded, the Wikipedia and ABC steps no longer add candidates.
7. Reads the [VEC's how-to-vote card register](https://www.vec.vic.gov.au/voting/2026-state-election/how-to-vote-cards) (`scripts/vec_htv.py`: every district's and region's list, ~96 requests a second apart) and records every registered card in `htv.json`: who registered it, when, the districts and regions it covers and the link to the card. Each new or replaced card's PDF is read once (pdfplumber) for the preference order it prints for each of its districts and regions; an order is kept only when every number reads cleanly, otherwise it is "unreadable, see card". New, amended and removed cards are logged (and a `::warning::` and a line in the run summary). Writes `htv/<seat>.json` and `htv/index.json` alongside.
8. Collects news for `news.json` from the sources in `NEWS_SOURCES`: outlets' own feeds where their robots.txt allows it (ABC, The Age, Guardian Australia's Victorian politics feed, SBS News, 9News's news sitemap, 7News's Victorian election feed, AFR politics, Crikey, The Conversation, The Saturday Paper, Daily Mail Australia, and the regional papers: Bendigo Advertiser, Border Mail, Warrnambool Standard, Latrobe Valley Express, Sunraysia Daily, Star Weekly, Shepparton News); a Bing News RSS search limited to the outlet's site where it has no feed or disallows us (News24, Herald Sun, The Australian, news.com.au (its Victorian politics and Inside Parliament stories), Sky News Australia, AAP, The New Daily, 10 News First) or its feed fails; a Bing News RSS search per district (the district plus "Victorian election", and the sitting MP); two searches for each party leader by name (`NEWS_LEADERS`: Ben Carroll, Jess Wilson, Danny O'Brien, Ellen Sandell, Warren Pickering), whose stories go to the statewide list and the leader's seat; and articles added by hand in `site/data/news_manual.json`. Items are matched to seats by district, MP or candidate name, labelled by their domain's outlet, deduplicated by URL and near-identical headline, and only the headline, outlet, date and link are kept. Each source's status and 7-day headline count go in `news.json` → `sources`. Google News RSS and the Geelong Advertiser's feed are skipped because their robots.txt disallows automated access.
9. Regenerates `site/data/profiles/` from `profiles.json` if the two differ (`scripts/profiles_split.py`), so a profile edited by hand reaches the candidate page.
10. Records each candidate's status changes in `candidates.json` → `status_history` (status, date and source; `python scripts/refresh.py --backfill-status-history` rebuilds them from git history). Each candidate page shows them as a short timeline.
11. Builds the change log: compares the data with the previous run's (`changelog_state.json`) and adds new candidates, superseded names, new polls, Sportsbet moves of 0.5 or more, retirements and the count of new headlines to `changelog.json`. `python scripts/refresh.py --backfill-changelog` rebuilds it from git history.
12. Updates `meta.json`: `last_updated` (only when a source refreshed successfully) and the per-source status.

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

`.github/workflows/refresh.yml` runs four times a day, at 6 am, 10 am, 4 pm and 8 pm Melbourne time (cron `0 19,23,5,9 * * *` in UTC; AEDT, so an hour earlier in Melbourne once daylight saving ends), and can also be run by hand from the Actions tab (`workflow_dispatch`). Every run does everything: Wikipedia polls and candidates, the full ABC pass and A-Z reconciliation (one request a second), news, the Sportsbet attempt, the how-to-vote register and the change log. It commits and pushes `site/data` when `scripts/data_changed.py` reports a change, which includes the new `last_updated` stamp of any successful run (per-source status alone doesn't count), and then its `deploy` job publishes `site/` to GitHub Pages. Pushes made by that job's token don't start other workflows, which is why it deploys itself. The footer and the home page show "Data updated <time> Melbourne time".

Google News isn't used: its robots.txt disallows automated access, so news comes from a Bing News search and publishers' RSS feeds.

## Election night

Results come from the Victorian Electoral Commission's public results pages (the media feed wasn't available), read by `scripts/results.py` into `site/data/results.json`, `site/data/results_lc.json` and `site/data/results_2026/`.

1. **Fill the URL map.** When the VEC publishes its 2026 results pages (expected after nominations close on 9 Nov, with an election-night trial on 25 Nov), open `scripts/results_urls.json` and set the `2026` profile's `base` to the address of the VEC's "2026 State election results" page. The page patterns (`district_page`, `district_vc_page`, `district_tcp_page`, `region_page`) follow the 2022 site; change them if 2026 differs, or put a single odd page in `overrides` (`"district:bass": "<url>"`). Check with:

   ```bash
   python scripts/results.py --check-urls
   ```

2. **Turn the schedule on.** In `.github/workflows/results.yml`, uncomment the `schedule:` block (`cron: "*/5 * * * *"`) and push. It reads the pages every 5 minutes (one request a second; a district's voting-centre pages only when its main page changed), commits only when the results change, and deploys. Run it by hand from the Actions tab at any time (`workflow_dispatch`), for example during the 25 Nov trial. Comment the schedule out again when the count is final.

3. **Test without the 2026 pages** by reading the final 2022 pages into a copy of the data:

   ```bash
   python scripts/results.py --profile 2022 --data-dir /tmp/data-copy
   python scripts/results.py --selftest-samples "website samples and summary (complete set)" --data-dir /tmp/data-copy
   ```

   The second command checks the output against the VEC's 2026 sample XML (kept out of the repo). Serve `site/` with the copied data to look at the Results page.

A seat is "called by this site" when the leader's two-candidate-preferred margin is larger than the estimated uncounted vote plus a buffer (the larger of 250 votes and 1% of enrolment); a seat the VEC has declared is marked as the VEC's. See `about.html#results`.

## Installable app

The site is a Progressive Web App: `site/manifest.webmanifest` (relative `start_url` and `scope`, so it works under the Pages base path or at a root), icons in `site/icons/`, and a service worker, `site/sw.js`. Android and desktop Chromium offer "Install app" in the About menu; on iPhone that item explains Share, then Add to Home Screen.

The service worker precaches the app shell (pages, CSS, JS, Latin fonts, icons) and serves it stale-while-revalidate, serves JSON data from its cache only if it was fetched in the last 5 minutes (refreshing it behind the page), and otherwise fetches it first, falling back to the cache after 4 seconds or offline, so the app never opens on old data, fetches `news.json` network first, caches photos, and caches only the pinned cdnjs libraries from other origins. Caches are capped, and old versions are deleted when a new worker activates.

**Bumping the cache version:** change `const VERSION = "v2";` in `site/sw.js` (to `"v3"` and so on) whenever you change HTML, CSS or JS, and keep its `SHELL` list in step with the files. Installed copies then download the new shell and show "Update available, tap to refresh". Data refreshes don't need a bump.

## Deploy

GitHub Pages serves the site at https://alisterjoyce.github.io/vic-election-tracker/, deployed by GitHub Actions (Settings → Pages → Source: GitHub Actions):

- `.github/workflows/deploy.yml` publishes `site/` on every push to `main` (and by hand from the Actions tab).
- `.github/workflows/refresh.yml` deploys after each scheduled refresh that changed the data.

Pages serves the site under `/vic-election-tracker/`, so every path in the site is relative; it also works at a domain's root (a custom domain, or Netlify). To check paths, serve `site/` under a prefix locally and click around.

Netlify is no longer the primary host (its free-tier credits ran out on 31 Oct 2026). `netlify.toml` is kept, so connecting the repo in Netlify still deploys `site/` with an empty build command.
