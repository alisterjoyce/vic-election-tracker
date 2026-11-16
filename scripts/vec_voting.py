#!/usr/bin/env python3
"""Where to vote and how many have voted: the VEC's voting centres, early and postal vote figures, and enrolment.

Used by refresh.py (refresh_voting_centres, refresh_early_votes); runnable alone for a check:
    python scripts/vec_voting.py --centres --data-dir <copy of site/data>
    python scripts/vec_voting.py --early --data-dir <copy of site/data>

Voting centres (data/voting_centres/<district>.json and data/voting_centres/index.json), once a day:
  * the VEC's venues spreadsheet, linked from /voting/2026-state-election/voting-locations as "venues spreadsheet":
    every early voting centre (sheet EVCs) and election-day voting centre (sheet VCs) for each district, including
    joint centres a district shares with a neighbour (JEVC / JVC: the district is a guest). Name, venue, address,
    suburb, postcode and wheelchair access only; estimated votes and entrance notes aren't kept;
  * the VEC's venue locator (maps.vec.vic.gov.au, the JSON behind https://maps.vec.vic.gov.au/elections) for each
    centre's position and opening hours. Its list of election-day centres is the 100 nearest a point, so it is asked
    once for a point in each district, and only for districts that still have a centre without a position (positions
    from the last run are reused), so after the first run it is rarely called at all.
Early and postal votes (data/early_votes.json), every refresh:
  * the VEC's daily table of early votes and postal votes returned (2022: "Date | Early votes | Postal votes
    returned", on its state election statistics page), and a by-district spreadsheet where it links one. Until the VEC
    publishes them the file says so; nothing is estimated;
  * 2022's daily figures for comparison, from the Wayback Machine's copy of the VEC's 2022 page (read once);
  * enrolment per district at the close of roll (the VEC's electoral roll statistics, district .xls), for each
    district's figure as a share of enrolment.

robots.txt: www.vec.vic.gov.au allows these paths (checked 16 Nov 2026; checked again every run); maps.vec.vic.gov.au
has no robots.txt. The VEC's website content is CC BY 4.0 (© Victorian Electoral Commission, https://www.vec.vic.gov.au/legal).
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import re
import sys
import time
import urllib.robotparser
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import lxml.etree as ET
import lxml.html
import pandas as pd
import requests

log = logging.getLogger("vec_voting")
MELBOURNE = ZoneInfo("Australia/Melbourne")
VEC = "https://www.vec.vic.gov.au"
LOCATIONS_PAGE = VEC + "/voting/2026-state-election/voting-locations"
STATS_PAGES = [VEC + "/results/electoral-statistics/state-election-statistics", VEC + "/voting/2026-state-election"]
ROLL_PAGE = VEC + "/enrolment/electoral-roll-statistics"
LOCATOR = "https://maps.vec.vic.gov.au"
LOCATOR_PAGE = LOCATOR + "/elections"
WAYBACK_2022 = ("http://web.archive.org/web/20221227113148/"
                "https://www.vec.vic.gov.au/voting/electoral-statistics/state-election-statistics")
ELECTION_2022 = "2022-11-26"
ELECTION_2026 = "2026-11-28"
CREDIT = "© Victorian Electoral Commission, CC BY 4.0"
DELAY = 1.0
TIMEOUT = 60
ACCESS = {"IWA": "Independent wheelchair access", "AWA": "Assisted wheelchair access", "LNWA": "Limited or no wheelchair access"}

CENTRES_SCHEMA = {
    "description": "Where to vote in the 2026 Victorian state election, from the VEC: early voting centres and election-day "
                   "voting centres for each district (data/voting_centres/<district id>.json), with positions and hours from "
                   "the VEC's venue locator. Read once a day by scripts/refresh.py (scripts/vec_voting.py). " + CREDIT + ".",
    "fields": {
        "source": "{label, page (the VEC's voting locations page), spreadsheet_url, spreadsheet_as_at (as printed on it), locator}",
        "checked": "Melbourne date the VEC's list was last read successfully",
        "fetched": "ISO UTC time of that read",
        "hours": "{early: [{from, to (YYYY-MM-DD), days, open, close (HH:MM), note}], election_day: [same]}: the hours every "
                 "centre of that kind keeps (a centre with other hours carries its own)",
        "districts": "{district id: {early, election_day}}: how many centres each district has",
        "<district>.json": "{district, name, early: [centre], election_day: [centre]} where centre is {name (the VEC's voting "
                           "location name), venue, address, suburb, postcode, access (IWA | AWA | LNWA), lat, lon (null if the "
                           "locator has no position), joint (true when the centre is shared with another district), host (id of "
                           "the district that runs a shared centre, when it isn't this one), hours (only if different)}",
    },
}
EARLY_SCHEMA = {
    "description": "Early votes and postal votes for the 2026 Victorian state election as the VEC publishes them (statewide "
                   "by day, and by district where it publishes that), with enrolment at the close of roll and 2022's daily "
                   "figures for comparison. Figures the VEC hasn't published are absent, never estimated. Read each refresh by "
                   "scripts/refresh.py (scripts/vec_voting.py). " + CREDIT + ".",
    "fields": {
        "status": "not_published (no 2026 figures yet) | published",
        "checked": "ISO UTC time of the last successful check",
        "source": "{statewide_url (the page the daily table was read from, or null), districts_url (the by-district "
                  "spreadsheet, or null)}",
        "statewide": "[{date (YYYY-MM-DD), early (early votes cast that day), postal_returned (postal votes received that "
                     "day)}], as the VEC's daily table gives them; cumulative totals are summed by the page",
        "statewide_total": "{early, postal_returned}: the table's own total row, where it has one",
        "districts": "{district id: {early, postal_returned, postal_applications (each null if not published), as_of}}",
        "enrolment": "{as_at (YYYY-MM-DD), url, total, districts: {district id: electors}}",
        "comparison_2022": "{election_date, source (Wayback Machine copy of the VEC's 2022 page), statewide: [{date, early, "
                           "postal_returned}], totals {early, postal_returned}}",
    },
}


class Polite:
    """One request a second, a descriptive User-Agent, robots.txt checked per host."""

    def __init__(self, user_agent: str):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = user_agent
        self.ua = user_agent
        self.last = 0.0
        self.robots: dict[str, urllib.robotparser.RobotFileParser] = {}

    def _wait(self):
        wait = self.last + DELAY - time.monotonic()
        if wait > 0:
            time.sleep(wait)

    def allowed(self, url: str) -> bool:
        host = re.match(r"https?://[^/]+", url).group(0)
        if host not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            self._wait()
            try:
                r = self.s.get(host + "/robots.txt", timeout=TIMEOUT)
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])   # none (404): everything allowed
            finally:
                self.last = time.monotonic()
            self.robots[host] = rp
        return self.robots[host].can_fetch(self.ua, url)

    def request(self, method: str, url: str, **kw) -> requests.Response:
        if not self.allowed(url):
            raise PermissionError(f"robots.txt disallows {url}")
        self._wait()
        try:
            r = self.s.request(method, url, timeout=TIMEOUT, **kw)
            r.raise_for_status()
            return r
        finally:
            self.last = time.monotonic()

    def get(self, url: str, **kw) -> requests.Response:
        return self.request("GET", url, **kw)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def norm(s) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower().replace("(evc)", "")).strip()


def clean(v) -> str | None:
    v = re.sub(r"\s+", " ", str(v)).strip() if v is not None else ""
    return v or None


def to_int(v):
    try:
        return int(round(float(str(v).replace(",", ""))))
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------------------------------
# XLSX without extra dependencies: the sheets' cell values (zip + XML), enough for the VEC's spreadsheets
# ---------------------------------------------------------------------------------------------------
_M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def read_xlsx(content: bytes) -> dict[str, list[list]]:
    z = zipfile.ZipFile(io.BytesIO(content))
    strings = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{{{_M}}}si"):
            strings.append("".join(t.text or "" for t in si.iter(f"{{{_M}}}t")))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for sheet in ET.fromstring(z.read("xl/workbook.xml")).find(f"{{{_M}}}sheets"):
        target = rels[sheet.get(f"{{{_R}}}id")].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(target)).iter(f"{{{_M}}}row"):
            vals = {}
            for c in row.findall(f"{{{_M}}}c"):
                col = re.match(r"[A-Z]+", c.get("r")).group(0)
                n = 0
                for ch in col:
                    n = n * 26 + ord(ch) - 64
                v, kind = c.find(f"{{{_M}}}v"), c.get("t")
                if kind == "s" and v is not None:
                    val = strings[int(v.text)]
                elif kind == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(f"{{{_M}}}t"))
                else:
                    val = v.text if v is not None else None
                vals[n - 1] = val
            rows.append([vals.get(i) for i in range(max(vals) + 1)] if vals else [])
        out[sheet.get("name")] = rows
    return out


def sheet_records(rows: list[list]) -> list[dict]:
    """Rows under the first row that has a 'District' heading, as dicts keyed by heading (blank rows dropped)."""
    for i, row in enumerate(rows):
        heads = [clean(h) or "" for h in row]
        if "District" in heads:
            out = []
            for r in rows[i + 1:]:
                rec = {h: (r[j] if j < len(r) else None) for j, h in enumerate(heads) if h}
                if clean(rec.get("District")):
                    out.append(rec)
            return out
    raise ValueError("no 'District' heading in the sheet")


def find_link(page: str, base: str, text_re: str, href_re: str = r"\.(xlsx|xls|csv)$") -> str | None:
    doc = lxml.html.fromstring(page)
    for a in doc.iter("a"):
        href, text = a.get("href") or "", " ".join(a.text_content().split())
        if re.search(href_re, href.split("?")[0], re.I) and re.search(text_re, text, re.I):
            return urljoin(base, href)
    return None


# ---------------------------------------------------------------------------------------------------
# Voting centres
# ---------------------------------------------------------------------------------------------------
def _district_ids(districts: list[dict]) -> dict[str, str]:
    return {norm(d["name"]): d["id"] for d in districts}


def _did(name: str, ids: dict[str, str]) -> str | None:
    return ids.get(norm(re.sub(r"\s+District$", "", str(name or "").strip())))


def _host_from_location(loc: str, ids: dict[str, str]) -> str | None:
    """'Melbourne (JVC)' or 'Kew - EVC 1 (JEVC)' -> the host district's id."""
    m = re.match(r"(.+?)(?:\s+-\s+EVC\s*\d+)?\s*\((?:J|HJ)E?VC\)", loc or "")
    return _did(m.group(1), ids) if m else None


def parse_venues(book: dict[str, list[list]], ids: dict[str, str]) -> tuple[dict, str | None]:
    """The spreadsheet's EVCs and VCs sheets -> {district id: {early: [...], election_day: [...]}}, and its 'as at' line."""
    as_at = None
    for row in book.get("Definitions", [])[:10]:
        for cell in row:
            if cell and re.search(r"correct as at", str(cell), re.I):
                as_at = clean(re.sub(r"(?i).*correct as at\s*", "", str(cell)))
    out: dict[str, dict] = {}
    unknown = set()
    for sheet, kind in (("EVCs", "early"), ("VCs", "election_day")):
        if sheet not in book:
            raise ValueError(f"sheet {sheet} missing from the venues spreadsheet")
        for rec in sheet_records(book[sheet]):
            did = _did(rec["District"], ids)
            if not did:
                unknown.add(clean(rec["District"]))
                continue
            loc = clean(rec.get("Voting Location Name")) or ""
            joint = bool(re.search(r"\((?:J|HJ)E?VC\)", loc))
            guest = bool(re.search(r"\(JE?VC\)", loc))
            host = _host_from_location(loc, ids) if guest else None
            name = re.sub(r"\s*\((?:J|HJ)E?VC\)", "", loc).strip()
            venue = clean(rec.get("Venue Name"))
            address = ", ".join(x for x in (clean(rec.get("Address Line 1")), clean(rec.get("Address Line 2"))) if x)
            out.setdefault(did, {"early": [], "election_day": []})[kind].append({
                "name": name, "venue": venue, "address": address or None, "suburb": clean(rec.get("Suburb")),
                "postcode": clean(rec.get("Post Code")), "access": clean(rec.get("Accessibility")),
                "lat": None, "lon": None, **({"joint": True} if joint else {}), **({"host": host} if host and host != did else {}),
            })
    if unknown:
        log.warning("Venues spreadsheet: districts not recognised: %s", ", ".join(sorted(x for x in unknown if x)))
    if len(out) < 80:
        raise ValueError(f"only {len(out)} districts found in the venues spreadsheet")
    return out, as_at


def venue_key(kind: str, venue: str | None, address: str | None) -> str:
    """A venue can be both an early and an election-day centre (with different hours): the kind is part of the key."""
    return f"{kind}|{norm(venue)}|{norm((address or '').split(',')[0])}"


def _hours(ops: list[dict]) -> list[dict]:
    out = []
    for o in ops or []:
        f, t = str(o.get("operatingFrom") or ""), str(o.get("operatingTo") or "")
        out.append({"from": f[:10] or None, "to": t[:10] or None, "days": clean(o.get("daysOperating")),
                    "open": f[11:16] or None, "close": t[11:16] or None, "note": clean(o.get("specialCondition"))})
    return sorted(out, key=lambda h: h["from"] or "")


def locator_election(web: Polite) -> dict:
    r = web.request("POST", LOCATOR + "/api/elections/current/summary", json={"electionType": 1, "electionCategory": 1})
    doc = r.json()
    if isinstance(doc, list):   # a list of current elections: the state election's
        doc = next((e for e in doc if "state" in str(e.get("electionName", "")).lower()), doc[0] if doc else {})
    if not doc.get("electionId"):
        raise ValueError("the venue locator returned no current state election")
    return doc


def locator_centres(web: Polite, election_id: str, lat: float, lon: float) -> list[dict]:
    r = web.get(f"{LOCATOR}/api/votingcentres/{election_id}/", params={"longitude": f"{lon:.5f}", "latitude": f"{lat:.5f}"})
    data = r.json()
    if not isinstance(data, list):
        raise ValueError("unexpected venue locator response")
    return data


def district_points(geo: dict) -> dict[str, tuple[float, float]]:
    """A point well inside each district: the mean of its largest ring's vertices (good enough for 'nearest 100')."""
    out = {}
    for f in geo.get("features", []):
        g = f.get("geometry") or {}
        polys = g["coordinates"] if g.get("type") == "MultiPolygon" else [g.get("coordinates") or []]
        ring = max((p[0] for p in polys if p), key=len, default=None)
        if ring:
            out[f["properties"]["id"]] = (sum(p[1] for p in ring) / len(ring), sum(p[0] for p in ring) / len(ring))
    return out


def fetch_voting_centres(districts: list[dict], geo: dict, prev_centres: dict[str, dict], user_agent: str) -> dict:
    """{index, districts: {id: {...}}} from the venues spreadsheet and the venue locator."""
    web = Polite(user_agent)
    page = web.get(LOCATIONS_PAGE).text
    url = find_link(page, LOCATIONS_PAGE, r"venues? spreadsheet", r"\.xlsx$")
    if not url:
        raise ValueError("no venues spreadsheet linked from the voting locations page")
    ids = _district_ids(districts)
    by_district, as_at = parse_venues(read_xlsx(web.get(url).content), ids)

    # Positions and hours: last run's positions first, then the locator for whatever is still missing.
    known: dict[str, tuple] = {}
    for doc in prev_centres.values():
        for kind in ("early", "election_day"):
            for c in doc.get(kind, []):
                if c.get("lat") is not None:
                    known[venue_key(kind, c["venue"], c["address"])] = (c["lat"], c["lon"], c.get("hours"))
    found: dict[str, tuple] = {}   # from this run's locator answers: key -> (lat, lon, hours, host name)
    common = {"early": None, "election_day": None}
    election = None

    def absorb(items):
        for v in items:
            kind = {1: "election_day", 2: "early"}.get(v.get("votingCentreTypeId"))
            if not kind or v.get("latitude") is None:
                continue
            hours = _hours(v.get("operationDetails"))
            common[kind] = common[kind] or hours
            found[venue_key(kind, v.get("venueName"), v.get("addressLine1"))] = (round(v["latitude"], 6), round(v["longitude"], 6), hours)

    def missing(did):
        return [c for kind in ("early", "election_day") for c in by_district[did][kind]
                if venue_key(kind, c["venue"], c["address"]) not in found and venue_key(kind, c["venue"], c["address"]) not in known]

    try:
        need = [did for did in by_district if missing(did)]
        if need or not prev_centres:
            election = locator_election(web)
            points = district_points(geo)
            # Always one query (for every early centre and the standard hours), then one per district still missing a position.
            first = need[0] if need else next(iter(by_district))
            for did in [first] + [d for d in need if d != first]:
                if did != first and not missing(did):
                    continue   # an earlier answer covered it
                if did not in points:
                    continue
                absorb(locator_centres(web, election["electionId"], *points[did]))
            log.info("Venue locator: %d districts queried", len(need) or 1)
    except Exception as exc:  # noqa: BLE001 - positions are a bonus: keep the list, report
        log.warning("Venue locator failed, centres kept without new positions: %s", exc)

    unplaced = 0
    for did, doc in by_district.items():
        for kind in ("early", "election_day"):
            for c in doc[kind]:
                key = venue_key(kind, c["venue"], c["address"])
                hit = found.get(key) or known.get(key)
                if hit:
                    c["lat"], c["lon"] = hit[0], hit[1]
                    if hit[2] and common[kind] and hit[2] != common[kind]:
                        c["hours"] = hit[2]
                else:
                    unplaced += 1
    if unplaced:
        log.warning("Voting centres: %d without a position from the venue locator", unplaced)
    names = {d["id"]: d["name"] for d in districts}
    return {
        "index": {
            "source": {"label": "Victorian Electoral Commission", "page": LOCATIONS_PAGE, "spreadsheet_url": url,
                       "spreadsheet_as_at": as_at, "locator": LOCATOR_PAGE},
            "election": {k: (election or {}).get(k) for k in ("earlyVotingStart", "earlyVotingFinish", "postalVotingFinish")} if election else None,
            "hours": common if any(common.values()) else None,
            "districts": {did: {"early": len(d["early"]), "election_day": len(d["election_day"])} for did, d in sorted(by_district.items())},
            "unplaced": unplaced,
        },
        "districts": {did: {"district": did, "name": names.get(did, did), **d} for did, d in by_district.items()},
    }


# ---------------------------------------------------------------------------------------------------
# Early and postal votes, enrolment
# ---------------------------------------------------------------------------------------------------
def _parse_day(text: str, year: int) -> str | None:
    m = re.search(r"(\d{1,2})\s+([A-Za-z]{3,})(?:\s+(\d{4}))?", str(text))
    if not m:
        return None
    try:
        d = datetime.strptime(f"{m.group(1)} {m.group(2)[:3]} {m.group(3) or year}", "%d %b %Y").date()
    except ValueError:
        return None
    return d.isoformat()


def parse_daily_table(page: str, year: int) -> list[dict]:
    """The VEC's 'Date | Early votes | Postal votes returned' table -> [{date, early, postal_returned}] (no total row)."""
    try:
        tables = pd.read_html(io.StringIO(page), flavor="lxml")
    except ValueError:
        return []
    for t in tables:
        cols = [" ".join(map(str, c)) if isinstance(c, tuple) else str(c) for c in t.columns]
        early = next((c for c in cols if re.search(r"early", c, re.I)), None)
        postal = next((c for c in cols if re.search(r"postal", c, re.I)), None)
        when = next((c for c in cols if re.search(r"date|day", c, re.I)), None)
        if not (early and when):
            continue
        t.columns = cols
        out = []
        for _, row in t.iterrows():
            day = _parse_day(row[when], year)
            if not day:
                if re.match(r"\s*total", str(row[when]), re.I):   # the VEC's own total, kept as the last item
                    out.append({"date": "total", "early": to_int(row[early]), "postal_returned": to_int(row[postal]) if postal else None})
                continue
            out.append({"date": day, "early": to_int(row[early]), "postal_returned": to_int(row[postal]) if postal else None})
        if out:
            return out
    return []


def split_total(rows: list[dict]) -> tuple[list[dict], dict | None]:
    total = next((r for r in rows if r["date"] == "total"), None)
    return [r for r in rows if r["date"] != "total"], ({k: total[k] for k in ("early", "postal_returned")} if total else None)


def parse_district_figures(book: dict[str, list[list]], ids: dict[str, str]) -> dict[str, dict]:
    """A by-district spreadsheet of early and postal votes: the first sheet with a District column and an early column."""
    for rows in book.values():
        try:
            recs = sheet_records(rows)
        except ValueError:
            continue
        if not recs:
            continue
        heads = list(recs[0].keys())
        early = next((h for h in heads if re.search(r"early", h, re.I) and not re.search(r"%|per ?cent", h, re.I)), None)
        returned = next((h for h in heads if re.search(r"postal", h, re.I) and re.search(r"return|received", h, re.I)), None)
        applied = next((h for h in heads if re.search(r"postal", h, re.I) and re.search(r"appl", h, re.I)), None)
        if not (early or returned):
            continue
        out = {}
        for r in recs:
            did = _did(r["District"], ids)
            if did:
                out[did] = {"early": to_int(r.get(early)) if early else None,
                            "postal_returned": to_int(r.get(returned)) if returned else None,
                            "postal_applications": to_int(r.get(applied)) if applied else None}
        if len(out) >= 80:
            return out
    return {}


def read_xls(content: bytes) -> dict[str, list[list]]:
    import xlrd
    book = xlrd.open_workbook(file_contents=content, logfile=io.StringIO())
    return {s.name: [s.row_values(i) for i in range(s.nrows)] for s in book.sheets()}


def read_book(content: bytes, url: str) -> dict[str, list[list]]:
    if url.lower().split("?")[0].endswith(".xls"):
        return read_xls(content)
    if url.lower().split("?")[0].endswith(".csv"):
        return {"csv": [r.split(",") for r in content.decode("utf-8-sig").splitlines()]}
    return read_xlsx(content)


def fetch_enrolment(web: Polite, ids: dict[str, str]) -> dict:
    """Close-of-roll electors per district: the district .xls linked from the electoral roll statistics page."""
    page = web.get(ROLL_PAGE).text
    doc = lxml.html.fromstring(page)
    links = [urljoin(ROLL_PAGE, a.get("href")) for a in doc.iter("a") if re.search(r"\.xlsx?$", (a.get("href") or "").split("?")[0], re.I)]
    best = None
    for url in links:
        try:
            book = read_book(web.get(url).content, url)
        except Exception as exc:  # noqa: BLE001 - one odd file doesn't stop the rest
            log.warning("Enrolment file %s unreadable: %s", url, exc)
            continue
        for rows in book.values():
            kind = next((str(r[1]) for r in rows[:10] if r and str(r[0]).strip().startswith("Area Type")), "")
            if kind.strip() != "District":
                continue
            extracted = next((r[1] for r in rows[:12] if r and str(r[0]).startswith("Date Extracted")), None)
            as_at = None
            try:
                as_at = (date(1899, 12, 30) + pd.Timedelta(days=int(float(extracted)))).isoformat()
            except (TypeError, ValueError):
                pass
            head = next(i for i, r in enumerate(rows) if any(str(c).strip() == "Elector Count" for c in r))
            hrow = [str(c).strip() for c in rows[head]]
            ni, ci = hrow.index("Area Name"), hrow.index("Elector Count")
            out = {}
            for r in rows[head + 1:]:
                did = _did(r[ni], ids) if ni < len(r) else None
                n = to_int(r[ci]) if ci < len(r) else None
                if did and n:
                    out[did] = n
            if len(out) == 88 and (best is None or (as_at or "") > (best["as_at"] or "")):
                best = {"as_at": as_at, "url": url, "page": ROLL_PAGE, "total": sum(out.values()), "districts": out}
    if not best:
        raise ValueError("no district enrolment spreadsheet found on the electoral roll statistics page")
    return best


def fetch_comparison_2022(web: Polite) -> dict:
    rows, total = split_total(parse_daily_table(web.get(WAYBACK_2022).text, 2022))
    if not rows:
        raise ValueError("no daily table in the Wayback copy of the VEC's 2022 statistics page")
    return {"election_date": ELECTION_2022, "source": WAYBACK_2022, "statewide": rows,
            "totals": total or {"early": sum(r["early"] or 0 for r in rows), "postal_returned": sum(r["postal_returned"] or 0 for r in rows)}}


def fetch_early_votes(districts: list[dict], prev: dict | None, user_agent: str) -> dict:
    """early_votes.json's content (without _schema). Pieces that fail keep their previous values."""
    prev = prev or {}
    web = Polite(user_agent)
    ids = _district_ids(districts)
    out = {k: prev.get(k) for k in ("statewide", "districts", "enrolment", "comparison_2022", "source")}
    out["statewide"] = out["statewide"] or []
    out["districts"] = out["districts"] or {}
    out["source"] = out["source"] or {"statewide_url": None, "districts_url": None}
    errors = []
    for url in STATS_PAGES:
        try:
            page = web.get(url).text
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{url}: {exc}")
            continue
        rows, total = split_total(parse_daily_table(page, 2026))
        rows = [r for r in rows if "2026-10-01" <= r["date"] <= "2026-12-31"]
        if rows:
            out["statewide"], out["source"]["statewide_url"], out["statewide_total"] = rows, url, total
        link = find_link(page, url, r"(early|postal).*district|district.*(early|postal)")
        if link:
            try:
                figs = parse_district_figures(read_book(web.get(link).content, link), ids)
                if figs:
                    as_of = out["statewide"][-1]["date"] if out["statewide"] else None
                    out["districts"] = {k: {**v, "as_of": as_of} for k, v in figs.items()}
                    out["source"]["districts_url"] = link
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{link}: {exc}")
        if rows:
            break
    if not out.get("enrolment"):
        try:
            out["enrolment"] = fetch_enrolment(web, ids)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"enrolment: {exc}")
    if not out.get("comparison_2022"):
        try:
            out["comparison_2022"] = fetch_comparison_2022(web)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"2022 comparison: {exc}")
    out["status"] = "published" if out["statewide"] or out["districts"] else "not_published"
    out["errors"] = errors
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", type=Path, required=True)
    ap.add_argument("--centres", action="store_true")
    ap.add_argument("--early", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ua = "vic-election-tracker/1.0 (static Victorian election tracker; test run)"
    districts = json.loads((args.data_dir / "districts.json").read_text(encoding="utf-8"))["districts"]
    if args.centres:
        geo = json.loads((args.data_dir / "geo" / "districts.geojson").read_text(encoding="utf-8"))
        doc = fetch_voting_centres(districts, geo, {}, ua)
        print(json.dumps(doc["index"], indent=1)[:3000])
    if args.early:
        print(json.dumps(fetch_early_votes(districts, None, ua), indent=1)[:3000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
