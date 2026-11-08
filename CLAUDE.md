# Vic Election 2026 Tracker: project conventions

A static tracker for the 2026 Victorian state election (polling day Sat 28 Nov 2026). Plain HTML, CSS and vanilla JS with **no build step**, published from `site/` by GitHub Pages. Data lives in JSON files, refreshed four times a day by `scripts/refresh.py` through a GitHub Action. The site installs as an app (see "Installable app (PWA)").

**Live site: https://alisterjoyce.github.io/vic-election-tracker/** (GitHub Pages, deployed from Actions). Netlify (https://vic2026tracker.netlify.app) was the first host; its free-tier credits ran out on 31 Oct 2026 and it is no longer the primary host. `netlify.toml` stays so the site can still be deployed there.

The site is served under a base path (`/vic-election-tracker/`) on Pages and at the root elsewhere, so **never use root-absolute URLs** (`/data/...`, `/lower.html`). Pages link relatively, and `common.js` resolves data files and search links against `App.ROOT` (the folder `common.js` is served from). Test under a prefix before changing paths.

## File layout

```
site/                     # published as-is by GitHub Pages (also deployable to Netlify: netlify.toml publish = "site")
  index.html              # home: headline card (2PP, seat projection, betting favourites, countdown), map with
                          #   Find my seat, seats to watch, latest news, seat counts, poll-of-polls chart, latest polls
  lower.html              # Legislative Assembly: filters, district detail, seat outlook (#district-id)
  upper.html              # Legislative Council: 8 regions, MLCs, tickets (#region-id)
  candidate.html          # candidate profiles (#<seat id>/<name slug>) and, with no hash, the candidate directory
  pendulum.html           # interactive pendulum (#swing=3.2) and scenario explorer
  timeline.html           # the 2022-2026 term and election timetable (data/timeline.json)
  data/index.html         # /data/: every published data file, its fields (from _schema), credit and licence
  poll.html               # poll detail (#<poll id>) with the pollster's trend and house effect; no hash = all polls
  policies.html           # party-by-issue policy matrix (#<issue>/<party>) from electiontracker.au's ledger
  results.html            # election-night results: seat tally against 45, seats changing hands, every seat, upper-house quotas
  myseats.html            # watchlist ("My seats"), stored in localStorage
  about.html              # about and methodology, sources, credits
  css/style.css           # all styles; design tokens on :root
  js/common.js            # shared: data loading, theme, formats, party palette, header chrome
                          #   (key-dates strip, search, footer), poll smoothing, seat-outlook maths
  js/home.js, lower.js, upper.js, myseats.js, candidate.js, pendulum.js, poll.js, results.js
  js/quota.js             # upper-house quota calculator (mounted on each region in upper.html)
  js/htv.js               # how-to-vote cards: seat/region section and lower.html's "Preference watch"
  js/timeline.js, datafiles.js, policies.js
  js/sharecard.js         # 1200x630 PNG share cards: candidate (canvas); seat and home headline (HTML rendered with
                          #   html-to-image 1.11.11 from cdnjs, pinned with SRI); Web Share API, else download
  data/*.json             # every file has a "_schema" key describing its fields
scripts/refresh.py        # the data refresh, four times a day (see "Data pipeline")
scripts/polls_manual.json  # polls entered by hand until Wikipedia lists them (merged by refresh.py)
scripts/profile_seats.py  # lists active candidates in given seats who have no profile yet (--all, --summary)
scripts/check_profiles.py # checks profiles against the rules below; --overlap also flags wording copied from Wikipedia/Parliament
scripts/data_changed.py   # used by refresh.yml: "changed" only if site/data differs beyond refresh times and source status
scripts/build_localities.py  # rebuilds data/localities.json from Vicmap Admin polygons (run by hand; needs shapely)
scripts/build_boundaries.py  # data/geo/{districts,regions}.geojson, topology-preserving simplification (needs shapely, topojson)
scripts/results_format.py    # the vec-contest-v1 results format (2022 history and 2026 election night)
scripts/build_results_2022.py  # data/results_2022/ from VEC 2022 results by voting centre (one-off)
scripts/vec_feed.py       # VEC media feed (XML) -> vec-contest-v1; --selftest <samples folder> (feed access was declined; kept for the format)
scripts/results.py        # election night: the VEC's public results pages -> results.json, results_lc.json, results_2026/ (see "Election-night results")
scripts/results_urls.json # results.py's URL map: the 2026 page addresses (filled in once the VEC publishes them) and the 2022 test profile
scripts/build_headshots.py   # headshot zip -> site/photos/{320,160}/*.webp + data/headshots.json (by hand; needs Pillow)
scripts/headshot_overrides.json  # {zip file path: candidate id | null} to resolve photos by hand
scripts/headshot_sources.json    # headshot provenance (image URLs, other listings, match type), kept out of site/data
scripts/build_fonts.py    # site/fonts/: Archivo and Inter, self-hosted, weight-limited and subset (by hand; needs fonttools, brotli)
site/fonts/               # WOFF2 per family and subset (latin, latin-ext, vietnamese) plus each OFL licence
scripts/build_icons.py    # site/icons/ app icons (by hand; needs Pillow)
site/manifest.webmanifest, site/sw.js, site/icons/   # the installable app (see "Installable app (PWA)")
site/photos/320/, 160/    # candidate headshots, WebP, each under 25 KB
site/js/maps.js           # Leaflet: home choropleth with metro inset, seat-page booth map
.github/workflows/refresh.yml   # 6 am, 10 am, 4 pm, 8 pm Melbourne (cron 0 19,23,5,9 UTC) + workflow_dispatch; commits
                                #   site/data and deploys to Pages only if the data changed (scripts/data_changed.py)
.github/workflows/deploy.yml    # deploys site/ to GitHub Pages on every push to main
.github/workflows/results.yml   # election night: results.py every 5 minutes (schedule commented out until it's needed) + workflow_dispatch
```

Not committed: the research report `.md` in the repo root, source screenshots and PDFs, the headshot zip (`/*.zip`), `.cache/` (Vicmap downloads) and `.claude/`, all via `.gitignore` except the report, which is simply never added.

## Data files

Each file's `_schema` is the authoritative field list. Keep it in sync when adding fields.

| File | Contents | Maintained by |
|---|---|---|
| `districts.json` | 88 districts: region (from the VEC), sitting MP, party, margin `{party, vs, pct}`, ABC classification/code/url, retiring, needs_check | seed + refresh.py (ABC) |
| `candidates.json` | Candidates for both houses. Assembly rows have `district`; Council rows have `region` + `ticket_position` | seed + refresh.py (Wikipedia, ABC) |
| `regions.json` | 8 regions: MLCs (with retiring), tickets, notes | seed + refresh.py (MLC retiring only) |
| `polls.json` | Statewide polls: id, client, source_url, primaries, 2PP, and where published 3PP, preferred premier and leader approval (matched from Wikipedia's leadership tables by firm and overlapping fieldwork) | refresh.py (Wikipedia), fully rewritten each run, plus `scripts/polls_manual.json` (see "Polls entered by hand") |
| `meta.json` | last_updated, previous_election 2PP baseline, key_dates, source status, reconciliation summary | refresh.py + hand |
| `seat_models.json` | Seat models, one entry per district per model; `null` = not published. `models[].kind`: `mrp` (YouGov, by hand), `forecast` (Australian Election Forecasts, `aeforecasts`: per candidate win probability, first-preference [5th, 50th, 95th percentile], 2CP scenarios; `expected_seats` per bloc) and `projection` (RedBridge, `redbridge-model`: statewide totals, toss-ups) | refresh.py (aeforecasts) + hand (MRP, RedBridge) |
| `seat_odds.json` | Sportsbet market per district: options, favourite, joint_favourites, partial, date_checked | hand (refresh.py tries Sportsbet; it is blocked, so the file is kept as manual) |
| `seat_polls.json` | Single-seat polls | hand |
| `timeline.json` | The term's events and the election timetable: date (YYYY-MM-DD or YYYY-MM), type, one line in our own words, districts/regions, source {label, url} | hand |
| `changelog.json` | Internal record, not displayed or linked anywhere on the site (the "What changed" page was removed on 31 Oct 2026). What changed at each refresh: new candidates, superseded/withdrawn names, new polls, odds moves of 0.5 or more, retirements, new-headline counts (last 120 days) | refresh.py (`refresh_changelog`, last step); `--backfill-changelog` rebuilds it from git history |
| `changelog_state.json` | Internal: the compact view of the data at the last run, which the next run diffs against (so hand edits between runs are caught too). Not shown or listed on /data/ | refresh.py |
| `policies.json` | Party policy ledger: matrix parties (separate and Coalition-combined), the Coalition's per-issue rule, 15 issues (name, summary, state role), each party-issue record's headline and claims (statement, kind, source, fiscal). The statements are electiontracker.au's (CC BY 4.0), as is the caveat, which the page shows as they ask | refresh.py (`refresh_et_policies`), rewritten only when the content changes |
| `htv.json` | How-to-vote cards registered with the VEC (from 10 Nov): seat, registered_by, party, registration, date, card_url, `order` (preference order, entered by hand from the card PDF) | refresh.py records cards; `order` and `notes` by hand and never overwritten |
| `news.json` | Headlines per district (latest 10) and statewide (latest 25): title, outlet, published, url only | refresh.py, fully rewritten each run (seat lists keep earlier items when a search fails) |
| `council_polls.json` | Upper-house primary vote by region (seeds the quota calculator); OTH is a pollster's combined "others", never one party | hand, from the pollster's release |
| `geo/districts.geojson`, `geo/regions.geojson` | Simplified boundaries (keep both under 1.5 MB together) | `scripts/build_boundaries.py` (Vicmap Admin; the VEC only offers PDF/PNG maps) |
| `results_2022/<district>.json`, `results_2022/index.json` | 2022 results by voting centre in vec-contest-v1 format, plus swings from notional 2018 | `scripts/build_results_2022.py` (one-off) |
| `results.json` | 2026 Assembly count per district: candidates' first preferences, 2CP, count progress, this site's call (called / leading / undecided), holder, changes_hands, 2CP swing; the seat tally against 45. Empty until counting starts | `scripts/results.py` (VEC results website) |
| `results_lc.json` | 2026 Council count per region: group and candidate first preferences, quota, quotas filled, elected | `scripts/results.py` |
| `results_2026/<district>.json`, `results_2026/index.json` | Each district in vec-contest-v1 (with voting centres) for the seat page's 2026 panel and booth map; the index drives the home map's Result mode. `_fetch.json` is results.py's bookkeeping (page hashes), not data | `scripts/results.py` |
| `profiles.json` | Researched candidate profiles keyed by candidate id: summary, born (year), lives, occupation, prior roles, previous candidacies, faction, priorities, links, contact, a source for every fact (see "Candidate profiles") | hand (research) |
| `headshots.json` | Candidate photos: id, name, seat, files {320,160}, source {credit, page}, licence note, date_added. Only what pages show: provenance is in `scripts/headshot_sources.json` | `scripts/build_headshots.py` |
| `localities.json` | Suburb/locality and postcode → district(s) with area shares, for search | `scripts/build_localities.py` (Vicmap Admin boundaries; the VEC publishes no downloadable locality list) |

Candidate ids (headshots, avatars) are `<district-or-region id>/<slug of "Given Surname">`, e.g. `bendigo-west/brenton-baldwin`; `App.candidateId(seat, name)` builds them and handles "Surname, Given". Show people with `App.avatar(shots, seat, name, party)`: the photo where `headshots.json` has one, else party-colour initials. Every list that shows photos ends with `App.photoCredits(...)` so each photo's source is credited.

Party codes: ALP, LIB, NAT, LNP (joint Coalition), GRN, ONP, IND, ILAB (Independent Labor), AJP, LCV, VS, LBT, FF, SAL, ND, WEST, SFF, DLP, SUS, OTH.

## Data pipeline and merge rules (`scripts/refresh.py`)

Runs four times a day (6 am, 10 am, 4 pm and 8 pm Melbourne time, AEDT; cron `0 19,23,5,9 * * *` in UTC, an hour earlier in Melbourne once daylight saving ends) and by hand. Every run does every step. A run commits and deploys only if `scripts/data_changed.py` finds a change. refresh.py sets `meta.last_updated` on every run where any source succeeded, and that counts, so every successful run is committed and deployed and the site's stamp is always the last refresh (until 4 Nov 2026 it didn't count, and the stamp froze whenever only timestamps moved). Per-source status, news.json's and changelog.json's `updated` and htv.json's `last_checked` don't count on their own; a run where every source failed commits nothing. The footer and the home page's headline card show `meta.last_updated` as "Data updated <date, time> Melbourne time" (`App.dataUpdatedText`).

Order each run: polls → Wikipedia candidates → ABC guide (district pages, then retiring MPs, then the A-Z reconciliation) → electiontracker.au check → electiontracker.au retirements → electiontracker.au policies → Sportsbet → Australian Election Forecasts → RedBridge release check → VEC placeholder → VEC how-to-vote register → news → profile check → change log → meta.json.

- **Polls entered by hand** (`scripts/polls_manual.json`, `merge_manual_polls`): polls.json is rewritten from Wikipedia every run, so a poll Wikipedia hasn't listed yet goes in this file, in polls.json's shape, with `via` {label, url} naming the report the figures came from. Each run adds it to polls.json until Wikipedia has a poll from the same pollster ending within two days; then Wikipedia's figures win and the hand entry only fills fields Wikipedia's row lacks or leaves null (e.g. client, a second preferred-premier question as `preferred_premier_alt`, ratings Wikipedia doesn't carry), recorded in `supplemented` so the poll page credits the source. The log says when an entry can go. The first (9 Nov 2026) was DemosAU's 30 Oct-5 Nov poll; Wikipedia listed its voting figures the same day and the entry supplies the client, both preferred-premier questions and the four leaders' ratings.
- **Never delete a candidate row.** Rows only change status. A row that was never a 2026 candidacy (e.g. a 2022 candidate carried into the seed: the eight New Democrats rows found on 4 Nov 2026 appeared only in the ABC's 2022 results tables) gets `status: "not_standing"` and a note saying how it was checked; pages and scripts hide it like a superseded row, and its profile, if any, is removed.
- **Upper-house tickets** (no ABC Council guide yet): the party's own current candidate page outranks Wikipedia for who stands where and in what order. When they disagree, fix `regions.json`/`candidates.json` to the party page, and keep the Wikipedia version as an inactive row (`superseded` with `superseded_by` when someone else took the place; `not_standing` when the person stands elsewhere) so the Wikipedia step, which adds any name it doesn't already hold, doesn't re-add it. A person can't contest both houses: Animal Justice's early upper-house names (Nicolosi, Collard, Champion, O'Neill, Mansouri) became Assembly candidates, and their region rows are `not_standing`. Names added from a party page by hand have no `source` and cite the page in `source_url`.
- **Wikipedia** adds names not already present as `announced` (`source: "wikipedia"`, `date_added`) and never changes existing rows.
- **ABC guide is the primary lower-house source.** ABC-listed candidates become `endorsed` (`source: "abc"`, ABC page URL). A `vec_nominated` row is never overridden.
- **Supersede rule:** an ABC entry for a party in a seat supersedes every other active row for that party in that seat. The older row is kept with `status: "superseded"`, `superseded_by`, `superseded_on` and a note, and a warning is logged. District pages hide superseded rows.
  - Independents (IND/OTH) can field several people in one seat, so one is only superseded by a near-identical spelling of the same person: first name AND surname must closely match. A shared surname alone never counts.
- Name matching ignores case, accents, punctuation and titles. An accent-only difference keeps the existing spelling. An unrecognised ABC party label never replaces a known party.
- **Dead links:** a candidate website the ABC guide links to that has gone dead goes in `ABC_WEBSITE_FIXES` (refresh.py), mapped to the party's live page, so the scheduled refresh doesn't restore it. A dead photo source page goes in `PAGE_FIXES` (build_headshots.py). Check a "dead" link in a browser off the office network first: the office DNS filter blocks some party sites (e.g. lcvicparty.org.au), which then look dead from here.
- **Reconciliation:** every name on the ABC A-Z list is checked against the tracker. Missing names are added under the same rules. A summary goes to `meta.json` → `reconciliation`.
- **Second reconciliation source, report only:** electiontracker.au's open data (`/data/vic2026/candidates.json`, CC BY 4.0, credit "electiontracker.au"; its robots.txt allows us and asks for the JSON rather than the HTML) is compared with candidates.json plus regions.json ticket names (`refresh_electiontracker`). Only name, party, contest and status are read; its backgrounds and other text are never stored. Active candidacies it lists that the tracker doesn't have go to `meta.json` → `reconciliation_electiontracker.missing_from_tracker` (a sitting MLC not on a tracked ticket is noted as such) and a log warning. Nothing is added from it automatically: check each name and add it by hand (`source: "electiontracker"`, `source_url` = the party or campaign page it cites, as for the five upper-house names added on 4 Nov 2026) or wait for the ABC. A name that differs only by a short first name (Lachie/Lachlan McKeeman: same party and surname, first three letters agree) counts as the same candidacy. Party slugs map through `ET_PARTIES`; an unknown slug is logged and counted as OTH.
- **electiontracker.au retirements** (`refresh_et_retirements`, after the ABC step): `/data/vic2026/retirements.json` (MLA/MLC, seat, announced, one source each). A person it lists whom we don't flag as retiring goes to `meta.json` → `reconciliation_electiontracker_retirements.not_flagged_here` with the source link, plus a log warning. The flag is set automatically only when the source's domain is a party or Parliament site (`ET_OFFICIAL_DOMAINS`) or a mainstream outlet (`ET_MAINSTREAM_DOMAINS`); then the district or MLC gets `retiring: true` and `retiring_source` {name, url, publisher, title, published, kind, via, added}, which the ABC step respects (it would otherwise reset a district's flag each run) while the name matches the sitting member. Local papers, social posts, an MP's own site and trade sites are report only: check them and set the flag by hand (with `retiring_source` if the ABC doesn't list the person). The report also lists `flagged_here_not_listed` (we flag, they don't) and `unmatched` (no sitting member by that name in that seat).
- **electiontracker.au policies** (`refresh_et_policies`): `policies.json` and `issues.json` are copied into `site/data/policies.json` (`build_policies_doc`: only the fields the page shows; claims without a source link are dropped) and shown on `policies.html`. Credit "Australian Election Tracker (OZE), electiontracker.au" (CC BY 4.0) wherever they're shown; the About page carries their citation line ("Australian Election Tracker (OZE), Victorian state election 2026 candidate ledger, electiontracker.au, accessed <date>"). The page must keep their caveat verbatim and the note that it is a ledger of published claims, not a rating; this site never scores or edits the positions. Their statements are reused under CC BY 4.0, an exception to "link, never copy" below because their licence allows it and they ask for reuse.
- **Politeness:** ABC requests are made one per second, with a descriptive User-Agent, and three tries per page. If any page fails three times, the whole ABC step is skipped and no file changes. Check robots.txt before adding any new scraped source.
- **News:** one request per second, one try per feed or search, and a source that fails is skipped (after 5 failed searches in a row the rest are skipped). Google News RSS and the Geelong Advertiser are excluded because their robots.txt disallows us; Bing News RSS search stands in for Google. Store the headline, outlet, date and link only; article summaries are used for matching to seats and then dropped.
- **Australian Election Forecasts** (`refresh_aeforecasts`): aeforecasts.com is a single-page app; its data is one JSON, `forecast-api/election-summary/2026vic/regular` (robots.txt allows everything), fetched once per run. `parse_aeforecasts` maps its seat names to district ids (all 88 must match, or the step fails and keeps the file) and its party indices through `AEF_PARTIES` (negative indices are "others" and the model's allowance for an emerging independent or party, stored under `others`). The file is rewritten only when the model changes. Credit "Australian Election Forecasts (aeforecasts.com)" with a link wherever it's shown (`App.modelLink`); the site's footer asks for attribution.
- **RedBridge seat model**: entered by hand (it was posted on LinkedIn, which scripts can't read). `check_redbridge` reads RedBridge's two sitemaps each run and logs a warning (and a `::warning::`) for any Victorian-looking page newer than the model's `published_date`; it never changes data. RedBridge mostly publishes through LinkedIn and the AFR, so also check there.
- **Failure handling:** if any fetch or parse fails, log it (plus a `::warning::` in Actions), keep the existing file, and exit 0.

## Candidate profiles (`site/data/profiles.json`)

Researched profiles live in their own file, keyed by candidate id (the seat the person is **contesting**), so seat pages never download them; only `candidate.html` (with a hash) and the Data page load it. The candidate page shows a "Profile" card under the main details with numbered source references and a sources list at the bottom. `scripts/check_profiles.py [batch.json] [--overlap]` must pass (0 problems) before profiles are committed; `--overlap` fetches each profile's Wikipedia and Parliament pages (cached for the day in `.cache/profile_check`) and fails any run of 8+ words copied from them. `scripts/profile_seats.py <seat ids> | --all [--summary]` prints the active candidates (candidates.json rows and regions.json ticket names, placeholders skipped) still without a profile; the Data page shows the completeness count.

Fields (the file's `_schema` is authoritative): `summary`, `born`, `lives`, `occupation`, `prior_roles`, `previous_candidacies`, `faction`, `priorities`, `links`, `contact`, `sources`, `profile_updated`. Rules:
- **Every fact cites a source.** Each fact carries `src` (numbers into the profile's `sources`, each `{id, url, title, accessed}`). No source, no fact.
- **Never guess.** Leave a field null or out when no source states it. If a source states something we couldn't confirm, or sources disagree, keep it with `unverified: true` and a short `note`; the page shows an "Unverified" badge.
- **Our own words.** The 2-4 sentence `summary` and everything else are written fresh: never copy sentences from Wikipedia (CC BY-SA), Parliament of Victoria biographies, the ABC, party sites or news stories. Facts and short neutral descriptions only; no commentary, praise or criticism.
- **Priorities:** up to 5. Quote (`quoted: true`) only the candidate's own first-person words from their own site, social accounts or speeches, under 15 words each; otherwise paraphrase (`quoted: false`). ABC Q&A answers and Parliament's third-person biographies are paraphrased, never quoted (ABC prose rule above).
- **Faction:** only when a mainstream news outlet or Wikipedia's article text reports it (cite that page). A Wikipedia category alone doesn't count, nor does "seen as a win for the conservative faction". A faction the source dates to the past (e.g. a former convener) or puts loosely ("considered part of the religious right") is kept as unverified with a note. Never infer a faction.
- **Legal and integrity matters** (`legal_and_integrity`, decided 4 Nov 2026: include, neutrally): formal action about the candidate's own conduct by a court, the police, an integrity body (Ombudsman, IBAC), Parliament, their party (suspension, expulsion, removal from a party post) or a fine, plus facts about their conduct confirmed by the institution concerned (e.g. universities saying a claimed qualification wasn't awarded). Every entry states its outcome (dismissed, settled, no action taken), in plain neutral words, with its source. Never allegations alone, criticism, gaffes, political rows or matters from childhood. Apply it to everyone alike: when profiling someone, check their sources for such matters. Shown on the profile under "Legal and integrity matters"; summaries needn't repeat it.
- **Personal details:** year of birth only (never a full date of birth), and only if published; `lives` is a suburb or town and only if the candidate has said it publicly. Contact details are published office or campaign ones only (campaign email or website, party office, electorate office); never personal phone numbers, personal email or home addresses.
- **Links:** official pages and the candidate's own public accounts only, checked to exist; omit the rest.
- **Previous candidacies:** election, seat, party code and result (Won, Lost, Retained, Withdrew, Unknown), from the electoral commission, Wikipedia or a news report. A re-election inferred from unbroken service (no source describes that election) is kept as unverified with a note, as is a council race where no source gives the label the person ran under (it carries their party code).
- **Role years:** never guessed. `to: null` means current; a role that has ended without a known end year has `to: null, ended: true` (shown as "2005–?"); a missing start year is `from: null`. Role titles are facts and may match the source word for word (the copy check skips them).
- **Party:** record the party a person sits for and stood for, even when our ticket data codes them LNP (a joint Coalition ticket) or lists a party they've since joined; describe a change of party factually in the summary. A reported move to another seat or ticket that the person's own sources don't confirm is described as reported.
- **Respelled names:** a profile and a headshot are keyed by the candidate's id, so an ABC respelling would strand them under the old id. The ABC step (`carry_profiles`, refresh.py) moves both to the new id automatically when the seat and party match and the names pass `_near_identical` (first names near-identical and surnames near-identical, the independents' rule): e.g. Trewalla -> Trewella moves, Potucek -> Potecuk (letters transposed) and Tim -> Tom don't. It updates the profile's `name` and the name in its summary, changes only the headshot's `id` (its files keep their names, since the workflow commits only site/data), logs "profile moved" and adds a line to the Actions run summary (`meta.json` → `sources.profiles.moved`). `build_headshots.py` takes ids from the current names in candidates.json, so a rebuild agrees, except where `scripts/headshot_overrides.json` names the old id: update that by hand.
- **Stranded profiles:** anything the move rule doesn't cover stays under the old id. Each refresh then runs `check_profiles` (refresh.py), which logs a warning and a `::warning::` for every profile with no active candidacy, with a hint ("move the profile to mordialloc/lily-potecuk"; "probably respelled as ..."), and records them in `meta.json` → `sources.profiles.stranded`. Move the profile to the new id by hand (update `name`, and note a spelling the party's page disagrees with in the summary), then run `check_profiles.py`.
- Set `profile_updated` whenever a profile is researched; sources keep their own `accessed` dates.
- Lot 1 (4 Nov 2026): every sitting MP and MLC who is recontesting, from Wikipedia and their Parliament of Victoria page (`https://www.parliament.vic.gov.au/members/<slug>/`; the members API is `/api/search/members?member-status=current&pageSize=100&page=N`). Sitting MPs' contact details are their electorate office's, as Parliament publishes them.

## Election-night results (`scripts/results.py`)

The VEC declined media-feed access; its public results website carries the same first-preference and 2CP figures at the same update frequency. `results.py` reads, per district, the main results page, the first preferences by voting centre and the 2CP by voting centre, and per region the region page (2022 addresses, which 2026 is expected to follow: `.../results-by-district/<id>-district-results`, `.../<id>-district-results-by-voting-centre`, `.../<id>-2cp-results-by-voting-centre`, `.../results-by-region/<id>-region-results`).
- **Filling the URL map** (`scripts/results_urls.json`): when the VEC publishes its 2026 results pages (expected after nominations close on 9 Nov; election-night trial on 25 Nov), set the 2026 profile's `base` to the "2026 State election results" page's address and adjust any pattern that differs; put a one-off page in `overrides` as `"district:<id>"` or `"region:<id>"`. Then `python scripts/results.py --check-urls` must report every page answering. During the 25 Nov trial, run the workflow by hand and check the log and the Results page.
- **Turning the schedule on:** uncomment the `schedule` block in `.github/workflows/results.yml` (cron `*/5 * * * *`) on election day, and comment it out again when the count is final. `workflow_dispatch` runs it by hand any time. The Results nav item and the seat and region panels switch on by themselves once `results.json` has votes.
- **Politeness:** one request a second, a descriptive User-Agent, conditional requests where the server sends ETag/Last-Modified (the VEC sends neither: `Cache-Control: no-store`), and a district's two voting-centre pages are fetched only when its main page changed (a hash of the page's `<main>` text, kept in `results_2026/_fetch.json`). Each page takes ~1.4 s (they are ~150 KB): a run where nothing changed reads 96 pages in ~2 minutes; one where every seat changed reads ~270 in ~7, so on a busy night updates arrive every ~7 minutes rather than 5 (runs queue, never overlap; the job times out at 15).
- **Tolerance:** a page that fails or doesn't parse is logged (and a `::warning::`) and skipped; the district keeps its previous figures. Parsers look for headings and column labels, not positions. The 2022 Narracan page doesn't exist (that election failed), which the test exercises.
- **Call rule** (this site's projection, labelled so everywhere): called when the leader's 2CP margin exceeds the estimated uncounted vote (enrolment x the seat's 2022 turnout - counted) plus max(250 votes, 1% of enrolment); declared seats are the VEC's call. Constants at the top of results.py.
- **Testing:** `python scripts/results.py --profile 2022 --data-dir <copy of site/data>` reads the final 2022 pages end to end (it refuses to write to site/data); then `--selftest-samples "website samples and summary (complete set)" --data-dir <same copy>` checks the website-derived files against the VEC's 2026 sample XML (contest, candidate and voting-centre keys; upper-house group fields; party names). Serve the copy to look at the pages. Booth coordinates come from `results_2022/` by voting-centre name.
- Don't list results files on /data/ (as before for results_2026/): they're the VEC's figures, credited on every results view.

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

Typography: **Archivo** (display: headings, brand, big numbers) and **Inter** (body), self-hosted in `site/fonts/` (`scripts/build_fonts.py`; @font-face rules at the top of `style.css`), with system fallbacks (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). Every number uses tabular figures (`font-variant-numeric: tabular-nums`, set on `body`).

### Number and date formats (use the helpers in `common.js`)
- **Margins:** one decimal, e.g. `ALP 4.6`. A **swing** carries a sign: `+9.7 to L/NP`. Use `App.fmtMargin`/`App.fmtSwing`.
- **Dates:** `22 Oct 2026` (day, three-letter month, year; never "Sept"). Use `App.fmtDate`.
- **Prices:** decimal odds with two decimals and no currency sign: `1.72`. Use `App.fmtPrice`.
- **Percentages:** one decimal where the source has it (`54.7%`), otherwise as published.

## Pages and UI conventions
- The header (brand, nav, search, theme toggle) and the key-dates strip are rendered by `common.js` on every page. The navigation is the `NAV` list in `common.js`: four groups (Overview, Lower house, Upper house, About: Methodology, Data, Polls, Policies, Install app), dropdowns on desktop and a "Menu" panel at 760px and below. Add new pages there; each HTML file keeps only a four-link `<nav class="nav">` fallback for when JavaScript doesn't run.
- **Search** (`initSearch` in `common.js`): the most prominent control on every page. 48px tall on desktop, 52px at 640px and below (`--search-h`), with a magnifying-glass icon, a clear button once there's text, a 2px `--accent` border and soft shadow (`--search-bg`, `--search-shadow`, `--search-ring` on `:root` and both dark blocks: white in light mode, `--surface-2` in dark), and a stronger blue ring on focus. On the home page it opens the headline card (`#hero-search`, full width) and the header keeps a compact button (`.search-compact`) that scrolls it into view and focuses it; on every other page it sits in the header and grows into the free space (160px base, up to 400px). Results are grouped Seats (districts and regions), Candidates (with a party-colour dot; MLCs marked), Suburbs, Postcodes; arrow keys and Enter work, Escape closes then clears, and "/" anywhere outside a text field focuses it (a `/` hint shows on desktop). At 420px and below the header tightens (6px gaps, 1rem brand) and the home page's theme toggle drops its word, so brand, Menu, search and theme fit one row from 360px; index.html's toggle starts with the same icon-and-word markup so nothing jumps.
- **Poll records** (`App.pollRecords` in common.js): a poll sets a record when its figure for a party is strictly beyond every earlier poll's (by fieldwork end), counting only after five earlier polls with that party. The poll-of-polls chart draws those polls larger and outlined, a triangle for a new high and a diamond for a new low (Labor, Coalition, Greens and One Nation primaries; both 2PP lines), and the poll page lists them: "Lowest Labor primary recorded" while it still stands, "New low ... when it came out" once a later poll has gone further.
- **Home headline card:** the seat projection comes from `App.projectSeats(districts, App.statewideSwing(...))`, the pendulum's rule (Labor-v-Coalition seats swing, every other contest stays with its holder), so the home page, its share card and the pendulum agree. The betting bar counts a seat as undecided when Sportsbet has joint favourites, a partial market or none.
- **Phone menu:** at 760px and below the nav is a fixed panel under the header (`--nav-top`, set by `common.js` when it opens) that covers the page; `html.nav-open` locks the page's scroll and dims it. It closes on a tap outside, on Escape and when a link is followed. Leaflet maps sit in `isolation: isolate` containers so their panes stay under it.
- **Key-dates strip:** on phones it collapses to one button that expands to the three milestones; desktop shows the full strip. The phone line says "Today: <short>" on a milestone's first day and otherwise "Next: <d Mon>, <short>" for the next milestone; the full strip says "Today:" (the narrowest event covering today) then "Next, <date>:". Events in `meta.json` → `key_dates.events` have `from`, optional `to`, `text` and `short`; stretches between milestones (postal votes going out, counting continues) carry `ongoing: true` and are never a "Next". Give each milestone its own start date, so no two compete for one day.
- **Nominations badge** (home headline card): `meta.json` → `nominations` {opens, closes, official, official_at}. Before `closes` it reads "Nominations open until noon Mon 9 Nov"; after, "Nominations closed; official candidate list due from the VEC"; once `official` is set it reads "Official candidates <n> VEC". refresh.py sets `official` (the count of `vec_nominated` rows) when `fetch_vec_candidates()` loads the VEC's list, which is still a placeholder: implement it after nominations close on 9 Nov, or set `official` by hand.
- **Results nav item:** "Results" (Overview group) is hidden until `results.json` has votes in it (checked after the first paint); results.html itself shows "Counting begins 6 pm Sat 28 Nov" until then, as do the seat and region pages' 2026 slots.
- In-page nav targets: `index.html#state-map` (the map), `pendulum.html#scenarios`, `upper.html#quota` (asks for a region) and `upper.html#<region>/quota` (that region's quota calculator). Pages scroll to these after rendering; `scroll-margin-top` keeps them clear of the sticky header.
- Shareable URLs use the hash: `lower.html#bendigo-east`, `upper.html#northern-victoria`, `candidate.html#bendigo-west/brenton-baldwin`, `pendulum.html#swing=3.2`, `poll.html#newspoll-2026-10-22`. Poll ids are `<pollster slug>-<end date>` (refresh.py), so they survive each refresh's rewrite. Link a name to its profile with `App.profileLink(seat, name)`; `App.loadPeople()` merges candidates, ticket names and MLCs into one list by candidate id (two ids for one name in different seats are never merged).
- Share cards print the photo credit on the image. Seat pages and the home page have a "Share" button that builds the card on demand, shares it where the browser can share files, and otherwise downloads it. No server is involved.
- Every `<table>` in `<main>` gets a "Download CSV" button from `common.js` (built from the cells' text; a cell's `data-csv` attribute overrides its text; `data-no-csv` on a table opts out; star columns are dropped).
- Pages in subfolders (`data/index.html`) work because `common.js` resolves data files and search links against `App.ROOT`, the site root. Never list or link VEC results-feed data (`results_2026/`) on /data/.
- `localStorage` is only for per-viewer conveniences (theme, watchlist). Wrap every access in try/catch, and the page must work without it.
- Mobile first: 16px side gutter, no horizontal page scroll; tables scroll inside `.table-scroll`.

## Performance and layout stability

Lighthouse (mobile) on the home, seat, pendulum and candidate pages scores 90+ for performance and 100 for accessibility. Lighthouse's slow-4G model counts every byte requested before the largest paint, so keep the critical path small:
- Every `<script>` is `defer`, and `common.js` is the first one on each page: it builds the header, search and key-dates strip as soon as it runs rather than waiting for the chart and map libraries.
- Fonts are self-hosted; each page preloads only `fonts/inter-latin.woff2` and `fonts/archivo-latin.woff2`. Don't go back to Google Fonts: its two extra origins and larger files cost the seat and profile pages several points.
- Leaflet, html-to-image and (on the home page) Chart.js aren't in the page HTML. `App.loadLib("leaflet" | "htmlToImage" | "chart")` loads them on demand (pinned cdnjs URLs with SRI, in `common.js`). Maps and the home chart start from `App.afterPaint(...)`, which waits for the first paint and the web fonts; the share button starts loading html-to-image when it is hovered or focused.
- The seat page renders from the data it needs (districts, candidates, regions, polls, models, odds, seat polls, how-to-vote cards), then fills in photos (`headshots.json`) and headlines (`news.json`) after the first paint. Avatars keep their size, so the swap doesn't move anything.
- Pages paint before scripts run, so anything a script fills in must have its space reserved, or the page jumps (CLS). Each page carries empty placeholders (`#key-dates`, the header's `.search` (`.search-compact` on the home page, plus `#hero-search` in its headline card), the `.nav-toggle` button) and CSS reserves their height; script-filled blocks (`#pref-watch`, `#region-chips`, `.pd-list`, `.tally`, the home card's `.hero-bar`s, the 2022 results, `#district-detail` when the URL has a seat hash) have `min-height`s, as does the key-dates strip at each width (45px one-line summary on phones, 112px at 641-839px where the full strip wraps, 63px wider). Measure before changing a reserved height.
- The inline head script adds `js` (and on lower.html `has-hash`) to `<html>`; CSS scopes the phone menu and placeholders to `html.js`, so the four fallback nav links still show without JavaScript.
- Large avatars (the profile photo) load eagerly with `fetchpriority="high"`; list avatars stay `loading="lazy"`.

## Installable app (PWA)

The site installs as an app ("Vic Election") on Android, desktop Chromium and iPhone, and opens offline.
- `site/manifest.webmanifest`: `start_url` and `scope` are `./`, so it works under `/vic-election-tracker/` and at a root. `id` is `vic-election-tracker`: ids resolve against the origin, and other projects share alisterjoyce.github.io, so `./` would not be unique. `display: standalone`; `theme_color`/`background_color` are the light `--surface`/`--bg`, and each page's two `theme-color` metas (light and dark media) cover dark mode. The theme toggle overwrites them with the chosen theme's `--surface`.
- Icons (`site/icons/`, from `scripts/build_icons.py`, Pillow): a white ballot tick on `--accent`, the favicon's mark: 192 and 512 ("any", rounded), 512 maskable (full bleed, tick inside the safe zone), 180 `apple-touch-icon`. Every page's head carries the manifest, apple-touch-icon, `theme-color` and the iOS `apple-mobile-web-app-*` metas (add them to any new page).
- `site/sw.js` (registered by `common.js` after the page's `load` event, scope = the site root):
  - app shell (`SHELL`: every page, `css/style.css`, every `js/*.js`, the Latin fonts, icons, manifest) precached at install, then stale-while-revalidate;
  - `data/*.json`, boundaries and 2022 results: stale-while-revalidate with a 5-minute max age (`DATA_MAX_AGE`). A copy fetched in the last 5 minutes is served at once and refreshed behind the page; an older one (any launch after a gap) waits up to 4 s (`NETWORK_TIMEOUT`) for the network before falling back to the cache. Cached data carries an `x-sw-fetched-at` header for this. Plain stale-while-revalidate (v1, 31 Oct to 4 Nov) showed each launch the data from the previous launch, so an app opened every few days showed days-old data;
  - `data/news.json` network first, with the same fallback;
  - a page or app that comes back after 5 minutes in the background checks `meta.json` and offers "New data available, tap to refresh" if the data is newer than the footer's stamp;
  - photos and the other font subsets cache first;
  - other origins: only `cdnjs.cloudflare.com` (pinned, SRI-checked libraries) is cached; nothing else cross-origin is intercepted or cached, and paths that look like login or auth pages never are;
  - caps: data 160 entries, media 250, libs 20, oldest first. `activate` deletes every `vet-*` cache that isn't the current version.
- **Bump `VERSION` in `site/sw.js`** (now `"v13"`; e.g. to `"v14"`) whenever you change HTML, CSS or JS, or add or remove a file in `SHELL` (keep `SHELL` in step with the files: a missing file fails the install). The new worker precaches the new shell, waits, and the page shows "Update available, tap to refresh"; a tap activates it and reloads. Data refreshes need no bump. Without a bump, stale-while-revalidate still picks up changed shell files a visit later, but a page and a shared script can briefly be from different versions.
- "Install app" is the last item in the About menu group: shown when the browser fires `beforeinstallprompt` (Android, desktop Chromium; it opens the browser's install prompt) and on iPhone/iPad (it opens a sheet: Share, then Add to Home Screen). Hidden when running installed (`display-mode: standalone` or `navigator.standalone`).
- Share images, CSV downloads, Find my seat (geolocation) and the Leaflet maps were tested in an installed, launched copy in headless Chromium. Lighthouse 11's PWA audit (removed in Lighthouse 12) scores 100.

## Working on the project
- Preview: `python -m http.server 8000 --directory site`.
- Test refresh.py against a copy, never the live data: `python scripts/refresh.py --data-dir <copy-of-site/data>`. After any change to it, check the copy's log for names the Wikipedia step added and for new superseded rows.
- refresh.py is one module: before adding a helper, grep for its name. A second `def _same_person` (6 Nov 2026) silently replaced the matcher the Wikipedia and ABC steps use, and one refresh re-added ten respelled names as new rows.
- Commit with the repo-local identity (GitHub noreply address). The workflow's bot commits data refreshes; pull before committing.
- **Batch related changes into fewer commits: one push per task, not per file.** Every push to `main` triggers a Pages deploy, so finish and test the whole task first, then commit it together and push once.
- After changing refresh.py or data, run the workflow (`gh workflow run refresh.yml --ref main`) and check its log.
