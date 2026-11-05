#!/usr/bin/env python3
"""Election-night results from the VEC's public results website.

The VEC declined media-feed access; its results website carries the same first-preference and
two-candidate-preferred (2CP) figures at the same update frequency. This script reads those pages
and writes:

  site/data/results.json            every district: candidates' first preferences, 2CP, count progress,
                                    this site's call (see CALL RULE), seat tally against the 45-seat line
  site/data/results_lc.json         every region: group and candidate votes, quota, quotas filled
  site/data/results_2026/<id>.json  each district in the shared vec-contest-v1 format (scripts/results_format.py),
                                    with voting centres, so the seat page's result panel and booth map reuse
                                    the 2022 code; results_2026/index.json drives the home map's Result mode
  site/data/results_2026/_fetch.json  fetch bookkeeping (ETag, Last-Modified, page hash), not shown anywhere

Page addresses come from scripts/results_urls.json (the URL map): the 2026 profile's base is filled in once
the VEC publishes its 2026 pages. The 2022 profile points at the final 2022 pages and is the test stand-in.

Politeness: one request a second, a descriptive User-Agent, conditional requests (If-None-Match /
If-Modified-Since) where the server offers validators (the VEC currently sends neither, with
"Cache-Control: no-store"), and a district's two voting-centre pages are fetched only when its main page
changed. Tolerance: a page that fails or doesn't parse is logged and skipped; the district keeps its
previous figures and the run carries on. The script exits 0 unless the configuration itself is unusable.

CALL RULE (this site's projection, not the VEC's): a seat is "called" when the leader's 2CP margin in votes
exceeds the estimated uncounted vote plus a safety buffer, i.e. the trailing candidate couldn't catch up
even with every remaining vote. Uncounted = enrolment x the district's 2022 turnout (TURNOUT_DEFAULT if
unknown) - votes counted. Buffer = max(CALL_BUFFER_MIN votes, CALL_BUFFER_PCT % of enrolment), for rechecks
and the chance the VEC's indicative 2CP pair is the wrong pair. A seat the VEC has declared (an elected
member shown) is "called" by the VEC. With votes but no call: "leading". No votes yet: "undecided".

Usage:
    python scripts/results.py                         # the active profile (2026), writing site/data
    python scripts/results.py --profile 2022 --data-dir <copy of site/data>   # test against the 2022 pages
    python scripts/results.py --check-urls            # does every page in the URL map answer?
    python scripts/results.py --selftest-samples "<VEC samples folder>" --data-dir <data written by a test run>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import tempfile
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import lxml.html
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from results_format import FORMAT, VOTE_TYPES, party_code  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT / "site" / "data"
CONFIG = Path(__file__).with_name("results_urls.json")
MELBOURNE = ZoneInfo("Australia/Melbourne")
USER_AGENT = ("vic-election-tracker/1.0 (election-night results from the VEC's public results pages, every 5 minutes, "
              "one request a second; +https://alisterjoyce.github.io/vic-election-tracker/)")
DELAY = 1.0           # seconds between requests
TIMEOUT = 30
SEATS, MAJORITY = 88, 45
REGION_POSITIONS = 5
CALL_BUFFER_PCT = 1.0     # % of enrolment
CALL_BUFFER_MIN = 250     # votes
TURNOUT_DEFAULT = 0.89    # share of enrolment expected to vote, when the 2022 figure isn't available
BLOCS = {"LIB": "LNP", "NAT": "LNP", "LNP": "LNP", "ALP": "ALP", "GRN": "GRN", "ONP": "ONP"}
# Row labels on the voting-centre pages -> media-feed vote types
TYPE_ROWS = {"ordinary votes total": "Ordinary", "early votes total": "Early", "early votes": "Early",
             "absent votes": "Absent", "marked as voted votes": "MarkedAsVoted", "postal votes": "Postal",
             "provisional votes": "Provisional", "mobile voting": "MobileVotingEarly"}

log = logging.getLogger("results")

RESULTS_SCHEMA = {
    "description": ("2026 Legislative Assembly results from the VEC's public results website, read every 5 minutes on "
                    "election night by scripts/results.py. 'Called' is this site's projection (see call_rule), not the VEC's; "
                    "a seat the VEC has declared is called by the VEC. Source: Victorian Electoral Commission."),
    "fields": {
        "source": "{name, url}: the VEC results pages this was read from",
        "profile": "Which URL-map profile produced it ('2026'; '2022' only in tests)",
        "counting_starts": "When counting begins (ISO, Melbourne time)",
        "updated": "When this file last changed (UTC)",
        "vec_updated": "The latest 'last updated' time shown on any VEC page read (raw text as published)",
        "call_rule": "{buffer_pct_of_enrolment, buffer_min_votes, turnout_default, text}",
        "tally": "{called: {bloc: seats}, leading: {bloc: seats}, undecided, counted_seats, majority}; blocs ALP, LNP, GRN, ONP, OTH",
        "districts": ("{district id: {name, url, vec_updated, fetched, enrolment, formal, informal, total, counted_pct (of enrolment), "
                      "centres_counted, centres_total, declared, elected {name, party}, candidates [{id, name, party, party_name, votes, pct}], "
                      "tcp [{id, name, party, votes, pct}] or null, tcp_basis (2cp | distribution), leader {id, name, party, basis}, "
                      "margin_votes, uncounted_estimate, status (called | leading | undecided), called_by (vec | site | null), "
                      "holder (party before the election), changes_hands, swing_2cp (leader's 2CP change since 2022, same pair only)}}"),
    },
}
LC_SCHEMA = {
    "description": ("2026 Legislative Council results by region from the VEC's public results website (scripts/results.py). "
                    "Quota = formal votes / (positions + 1) + 1, rounded down, unless the VEC publishes one. Source: Victorian Electoral Commission."),
    "fields": {
        "updated": "When this file last changed (UTC)",
        "regions": ("{region id: {name, url, vec_updated, fetched, enrolment, formal, informal, total, counted_pct, positions, quota, "
                    "quota_source (vec | computed), elected [names], groups [{group, name, party, votes, pct, quotas, ticket_votes, "
                    "candidates [{name, votes}]}], ungrouped [{name, party, votes, pct, quotas}]}}"),
    },
}


# ---------------------------------------------------------------- small helpers
def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).strip("-")


def name_key(s: str) -> str:
    return re.sub(r"[^a-z]", "", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower())


def clean(s) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def num(s):
    s = clean(s).replace(",", "")
    return int(s) if re.fullmatch(r"-?\d+", s) else None


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as exc:
        log.error("%s is not valid JSON (%s); treating it as missing", path.name, exc)
        return default


def write_json(path: Path, data, compact=False) -> None:
    text = (json.dumps(data, ensure_ascii=False, separators=(",", ":")) if compact
            else json.dumps(data, ensure_ascii=False, indent=2)) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def warn_ci(message: str) -> None:
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::warning title=results.py::{message}")


def main_el(html: str):
    doc = lxml.html.fromstring(html)
    return (doc.xpath("//main") or doc.xpath("//*[@id='main']") or [doc])[0]


def cells(row) -> list[str]:
    return [clean(c.text_content()) for c in row.xpath("./td|./th")]


def heading_before(el) -> str:
    h = el.xpath("preceding::*[self::h1 or self::h2 or self::h3 or self::h4][1]")
    return clean(h[0].text_content()) if h else ""


VEC_TIME = re.compile(r"(?:last updated|results updated|updated|as at)\s*:?\s*"
                      r"((?:\d{1,2}[:.]\d{2}\s*[ap]\.?m\.?,?\s*)?(?:\w+day,?\s*)?\d{1,2}\s+[A-Za-z]+\s+\d{4}(?:,?\s*(?:at\s*)?\d{1,2}[:.]\d{2}\s*[ap]\.?m\.?)?)",
                      re.I)


def vec_updated(text: str):
    """The page's own 'last updated' stamp: (raw text, ISO or None). Final 2022 pages have none."""
    for m in VEC_TIME.finditer(text):
        raw = clean(m.group(1))
        if "close of rolls" in text[max(0, m.start() - 40):m.start() + 5].lower():
            continue
        t = re.search(r"(\d{1,2})[:.](\d{2})\s*([ap])", raw, re.I)
        d = re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", raw)
        iso = None
        if d:
            try:
                day = datetime.strptime(f"{d.group(1)} {d.group(2)[:3]} {d.group(3)}", "%d %b %Y")
                if t:
                    hh = int(t.group(1)) % 12 + (12 if t.group(3).lower() == "p" else 0)
                    day = day.replace(hour=hh, minute=int(t.group(2)))
                iso = day.replace(tzinfo=MELBOURNE).isoformat()
            except ValueError:
                pass
        return raw, iso
    return None, None


# ---------------------------------------------------------------- fetching
class Fetcher:
    """One request per DELAY seconds; conditional requests where the server offers validators; a hash of each
    page's <main> text to tell whether it changed when it doesn't."""

    def __init__(self, state: dict):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.state = state
        self.last = 0.0
        self.count = 0

    def get(self, url: str, conditional=True):
        """(html or None, changed). None with changed=False means 304 Not Modified. Raises on HTTP errors."""
        wait = self.last + DELAY - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        st = self.state.get(url, {})
        headers = {}
        if conditional and st.get("etag"):
            headers["If-None-Match"] = st["etag"]
        if conditional and st.get("last_modified"):
            headers["If-Modified-Since"] = st["last_modified"]
        try:
            resp = self.session.get(url, headers=headers, timeout=TIMEOUT)
        finally:
            self.last = time.monotonic()
            self.count += 1
        if resp.status_code == 304:
            return None, False
        resp.raise_for_status()
        html = resp.text
        sha = hashlib.sha256(clean(main_el(html).text_content()).encode()).hexdigest()
        changed = sha != st.get("sha")
        self.state[url] = {"etag": resp.headers.get("ETag"), "last_modified": resp.headers.get("Last-Modified"),
                           "sha": sha, "fetched": now_iso()}
        return html, changed


# ---------------------------------------------------------------- page parsers (tolerant: missing parts are None)
def parse_district_page(html: str) -> dict:
    m = main_el(html)
    text = clean(m.text_content())
    h1 = clean((m.xpath(".//h1") or [None])[0].text_content()) if m.xpath(".//h1") else ""
    name = re.sub(r"\s*District results.*$", "", h1, flags=re.I).strip()
    if not name:
        raise ValueError("no 'District results' heading")
    out = {"name": name, "enrolment": None, "formal": None, "informal": None, "total": None, "fp": [], "tcp": None,
           "distribution": None, "elected": None, "centres_counted": None, "centres_total": None}
    for key, pat in [("enrolment", r"Total enrolment[^:]*:\s*([\d,]+)"), ("formal", r"Formal votes:\s*([\d,]+)"),
                     ("informal", r"Informal votes:\s*([\d,]+)"), ("total", r"Total votes:\s*([\d,]+)")]:
        mm = re.search(pat, text, re.I)
        out[key] = num(mm.group(1)) if mm else None
    mm = re.search(r"(\d+)\s+of\s+(\d+)\s+(?:voting centres|polling places|centres)", text, re.I)
    if mm:
        out["centres_counted"], out["centres_total"] = int(mm.group(1)), int(mm.group(2))
    out["vec_updated"], out["vec_updated_iso"] = vec_updated(text)
    for t in m.xpath(".//table"):
        heads = " | ".join(clean(th.text_content()) for th in t.xpath(".//thead//th")).lower()
        section = heading_before(t).lower()
        rows = []
        for r in t.xpath(".//tbody/tr"):
            c = cells(r)
            if len(c) >= 3 and num(c[2]) is not None:
                rows.append({"name": c[0], "party_name": c[1], "votes": num(c[2])})
        if not rows:
            continue
        if "1st pref" in heads or "first pref" in heads:
            out["fp"] = rows
        elif "after distribution" in heads or "distribution" in section:
            out["distribution"] = rows
        elif "2cp" in heads or "two candidate" in section or "two-candidate" in section or "2cp" in section:
            out["tcp"] = rows
    if not out["fp"]:
        raise ValueError("no first-preference table")
    out["elected"] = (elected_from(text, out["fp"]) or [None])[0]
    return out


def elected_from(text: str, rows: list[dict]) -> list[dict]:
    """Elected members, in order, from the text after 'Elected member(s)': each matched against the table's
    candidate names (a name alone can't be told apart from the party that follows it)."""
    m = re.search(r"Elected members?\b(.*?)(?:Votes counted|First preference|$)", text, re.S)
    if not m:
        return []
    chunks = [c for c in re.split(r"\d+(?:st|nd|rd|th) elected:", m.group(1)) if c.strip()] or [m.group(1)]
    found = []
    for chunk in chunks:
        key = name_key(chunk)
        row = max((r for r in rows if name_key(r["name"]) and key.startswith(name_key(r["name"]))),
                  key=lambda r: len(name_key(r["name"])), default=None)
        if row and row not in found:
            found.append(row)
    return [{"name": r["name"], "party_name": r.get("party_name")} for r in found]


def _vote_cols(head_rows):
    """Column index -> (name, party) for candidate columns, plus the informal and total column indexes."""
    names = head_rows[0] if head_rows else []
    parties = head_rows[1] if len(head_rows) > 1 else [""] * len(names)
    width = max(len(names), len(parties))
    names += [""] * (width - len(names))
    parties += [""] * (width - len(parties))
    cand, informal, total = {}, None, None
    for i in range(1, width):
        label = (parties[i] or names[i]).lower()
        if "informal" in label:
            informal = i
        elif "total" in label:
            total = i
        elif "mis-sort" in label or "missort" in label:
            continue
        elif names[i]:
            cand[i] = (names[i], parties[i])
    return cand, informal, total


def parse_vc_page(html: str, kind: str) -> dict:
    """First preferences (kind='fp') or 2CP (kind='tcp') by voting centre."""
    m = main_el(html)
    tables = m.xpath(".//table")
    if not tables:
        raise ValueError("no table")
    t = tables[0]
    cand, informal_col, total_col = _vote_cols([cells(r) for r in t.xpath(".//thead/tr")])
    if not cand:
        raise ValueError("no candidate columns")
    order = sorted(cand)
    booths, by_type, section, totals = [], {}, "ordinary", None
    for r in t.xpath(".//tbody/tr"):
        c = cells(r)
        if not c:
            continue
        label, low = c[0], c[0].lower()
        values = {i: num(c[i]) if i < len(c) else None for i in order}
        has_numbers = any(v is not None for v in values.values())
        if low.startswith("percentage"):
            continue
        if low in ("total", "total first preference votes"):
            if has_numbers:
                totals = {i: v or 0 for i, v in values.items()}
            continue
        if not has_numbers and low in ("ordinary votes", "early votes", "declaration votes"):
            section = low.split()[0]
            continue
        if low in TYPE_ROWS:
            if has_numbers:
                by_type[TYPE_ROWS[low]] = {i: v or 0 for i, v in values.items()}
            continue
        if low.endswith(" total") or low.endswith(" votes total"):
            continue
        if section == "declaration":
            continue   # an unlisted declaration-vote type: not a place
        booths.append({"name": label, "classification": "EarlyVotingCentre" if section == "early" else "VotingCentre",
                       "votes": values if has_numbers else None,
                       "informal": num(c[informal_col]) if informal_col is not None and informal_col < len(c) else None,
                       "total": num(c[total_col]) if total_col is not None and total_col < len(c) else None})
    return {"kind": kind, "candidates": [cand[i] for i in order], "cols": order, "booths": booths, "by_type": by_type, "totals": totals}


def parse_region_page(html: str) -> dict:
    m = main_el(html)
    text = clean(m.text_content())
    h1 = clean(m.xpath(".//h1")[0].text_content()) if m.xpath(".//h1") else ""
    name = re.sub(r"\s*Region results.*$", "", h1, flags=re.I).strip()
    if not name:
        raise ValueError("no 'Region results' heading")
    out = {"name": name}
    for key, pat in [("enrolment", r"Total enrolment[^:]*:\s*([\d,]+)"), ("formal", r"Formal votes:\s*([\d,]+)"),
                     ("informal", r"Informal votes:\s*([\d,]+)"), ("total", r"Total votes:\s*([\d,]+)"),
                     ("quota", r"Quota[^:\d]*:?\s*([\d,]+)")]:
        mm = re.search(pat, text, re.I)
        out[key] = num(mm.group(1)) if mm else None
    out["vec_updated"], out["vec_updated_iso"] = vec_updated(text)
    rows, group = [], None
    for t in m.xpath(".//table"):
        heads = [clean(th.text_content()).lower() for th in t.xpath(".//thead//th")]
        if not any("1st pref" in h or "first pref" in h or "votes" in h for h in heads):
            continue
        gcol = next((i for i, h in enumerate(heads) if h.startswith("group")), None)
        vcol = next((i for i, h in enumerate(heads) if "1st pref" in h or "first pref" in h or h == "votes"), 2)
        for r in t.xpath(".//tbody/tr"):
            c = cells(r)
            if not c:
                continue
            g = re.match(r"^Group\s+([A-Z]{1,2})\b[\s:–-]*(.*)$", c[0])
            if g and (len(c) < 3 or num(c[vcol] if vcol < len(c) else "") is None):
                group = {"group": g.group(1), "name": clean(g.group(2)) or None}
                continue
            votes = num(c[vcol]) if vcol < len(c) else None
            if votes is None:
                continue
            is_ticket = bool(re.search(r"ticket|above the line|group votes", c[0], re.I))
            rows.append({"name": c[0], "party_name": c[1] if len(c) > 2 and vcol != 1 else "", "votes": votes,
                         "group": (c[gcol] if gcol is not None and gcol < len(c) else None) or (group or {}).get("group"),
                         "group_name": (group or {}).get("name"), "ticket": is_ticket})
        break
    if not rows:
        raise ValueError("no first-preference table")
    out["rows"] = rows
    out["elected"] = [e["name"] for e in elected_from(text, [r for r in rows if not r["ticket"]])]
    return out


# ---------------------------------------------------------------- building the outputs
def booths_2022(data_dir: Path, did: str) -> dict:
    r = read_json(data_dir / "results_2022" / f"{did}.json", {}) or {}
    return {name_key(p["name"]): p for p in r.get("polling_places", [])}


def turnout_2022(data_dir: Path, did: str):
    r = read_json(data_dir / "results_2022" / f"{did}.json", {}) or {}
    e, t = (r.get("contest") or {}).get("enrolment"), (r.get("first_preferences") or {}).get("total")
    return t / e if e and t else None


def tcp_2022(data_dir: Path, did: str) -> dict:
    """{party: 2CP %} for the 2022 final pair (the distribution if it ended with two, else the VEC's 2CP)."""
    r = read_json(data_dir / "results_2022" / f"{did}.json", {}) or {}
    cand = {c["id"]: c for c in r.get("candidates", [])}
    pair = (r.get("distribution") or {}).get("candidates") or {}
    if len(pair) != 2:
        pair = (r.get("tcp") or {}).get("candidates") or {}
    total = sum(pair.values())
    return {cand[i]["party"]: 100 * v / total for i, v in pair.items() if i in cand} if total else {}


def build_contest(did: str, event: dict, page: dict, vc: dict | None, tcp: dict | None, old_booths: dict, url: str, phase: str) -> dict:
    """The district in vec-contest-v1, the shape results_2022/ and the booth map use."""
    # Candidates in ballot order: the voting-centre page's columns, else the first-preference table's rows.
    order = vc["candidates"] if vc else [(r["name"], r["party_name"]) for r in page["fp"]]
    candidates, by_key = [], {}
    for i, (name, party_name) in enumerate(order, 1):
        cid = f"c{i}"
        independent = not (party_name or "").strip() or "independent" in (party_name or "").lower()
        candidates.append({"id": cid, "name": name, "party": party_code(party_name, independent), "party_name": party_name or None,
                           "ballot_position": i, "independent": independent,
                           "elected": bool(page.get("elected")) and name_key(page["elected"]["name"]) == name_key(name)})
        by_key[name_key(name)] = cid
    ids = lambda rows: {by_key[name_key(r["name"])]: r["votes"] for r in rows or [] if name_key(r["name"]) in by_key}
    fp_by_type = {}
    if vc:
        for t, vals in vc["by_type"].items():
            fp_by_type[t] = {f"c{vc['cols'].index(i) + 1}": v for i, v in vals.items()}
    tcp_out = None
    if tcp:
        pair_ids = [by_key.get(name_key(n)) for n, _ in tcp["candidates"]]
        if all(pair_ids):
            col_id = dict(zip(tcp["cols"], pair_ids))
            by_type = {t: {col_id[i]: v for i, v in vals.items()} for t, vals in tcp["by_type"].items()}
            if tcp.get("totals"):   # the VEC's own "Total" row
                totals = {col_id[i]: v for i, v in tcp["totals"].items()}
            else:                   # booths, plus every vote type except Ordinary (the booths' own total)
                totals = {cid: 0 for cid in pair_ids}
                for b in tcp["booths"]:
                    for i, v in (b["votes"] or {}).items():
                        totals[col_id[i]] += v or 0
                for t, vals in by_type.items():
                    if t != "Ordinary":
                        for cid, v in vals.items():
                            totals[cid] += v or 0
            tcp_out = {"candidates": totals, "by_type": {t: by_type[t] for t in VOTE_TYPES if t in by_type}}
    elif page.get("tcp"):
        tcp_out = {"candidates": ids(page["tcp"]), "by_type": {}}
    places = {}
    for b in (vc or {}).get("booths", []):
        key = name_key(b["name"])
        old = old_booths.get(key, {})
        fp = {f"c{vc['cols'].index(i) + 1}": v for i, v in (b["votes"] or {}).items()} if b["votes"] else {}
        places[key] = {"id": f"{did}-{slug(b['name'])}", "name": b["name"], "classification": b["classification"],
                       "lat": old.get("lat"), "lon": old.get("lon"), "first_preferences": fp,
                       "formal": sum(v or 0 for v in fp.values()) if fp else None,
                       "informal": b["informal"], "total": b["total"], "tcp": None}
    for b in (tcp or {}).get("booths", []):
        key = name_key(b["name"])
        if key in places and b["votes"]:
            col_id = dict(zip(tcp["cols"], [by_key.get(name_key(n)) for n, _ in tcp["candidates"]]))
            places[key]["tcp"] = {col_id[i]: v for i, v in b["votes"].items() if col_id.get(i)}
    dist = ids(page.get("distribution"))
    return {
        "format": FORMAT,
        "event": {"name": event["event"], "date": event["election_date"], "source": url},
        "phase": phase,
        "updated": page.get("vec_updated_iso") or now_iso(),
        "contest": {"district": did, "name": page["name"], "enrolment": page["enrolment"], "declared": bool(page.get("elected"))},
        "candidates": candidates,
        "first_preferences": {"candidates": ids(page["fp"]), "by_type": {t: fp_by_type[t] for t in VOTE_TYPES if t in fp_by_type},
                              "formal": page["formal"], "informal": page["informal"], "total": page["total"]},
        "tcp": tcp_out,
        "distribution": {"candidates": dist} if dist else None,
        "polling_places": list(places.values()),
    }


def summarise(did: str, contest: dict, page: dict, url: str, holder: str | None, data_dir: Path) -> dict:
    cand = {c["id"]: c for c in contest["candidates"]}
    fp = contest["first_preferences"]
    formal = fp["formal"] or sum(fp["candidates"].values()) or 0
    total = fp["total"] or 0
    enrol = contest["contest"]["enrolment"]
    rows = lambda votes: sorted(({"id": i, "name": cand[i]["name"], "party": cand[i]["party"], "party_name": cand[i]["party_name"],
                                  "votes": v, "pct": round(100 * v / sum(votes.values()), 2) if sum(votes.values()) else None}
                                 for i, v in votes.items() if i in cand), key=lambda r: -r["votes"])
    dist = (contest.get("distribution") or {}).get("candidates") or {}
    pair, basis = (dist, "distribution") if len(dist) == 2 else (((contest.get("tcp") or {}).get("candidates") or {}), "2cp")
    tcp_rows = rows(pair) if len(pair) == 2 and sum(pair.values()) else None
    booths = [p for p in contest["polling_places"] if p["classification"] == "VotingCentre"]
    centres_counted = page.get("centres_counted") if page.get("centres_counted") is not None else sum(1 for p in booths if p["first_preferences"])
    centres_total = page.get("centres_total") if page.get("centres_total") is not None else len(booths)
    turnout = turnout_2022(data_dir, did) or TURNOUT_DEFAULT
    uncounted = max(0, round((enrol or 0) * turnout) - total) if enrol else None
    buffer = max(CALL_BUFFER_MIN, round((enrol or 0) * CALL_BUFFER_PCT / 100))
    out = {"name": contest["contest"]["name"], "url": url, "vec_updated": page.get("vec_updated"), "fetched": now_iso(),
           "enrolment": enrol, "formal": formal or None, "informal": fp["informal"], "total": total or None,
           "counted_pct": round(100 * total / enrol, 1) if enrol and total else 0.0,
           "centres_counted": centres_counted, "centres_total": centres_total,
           "declared": contest["contest"]["declared"],
           "elected": next(({"name": c["name"], "party": c["party"]} for c in contest["candidates"] if c["elected"]), None),
           "candidates": rows(fp["candidates"]), "tcp": tcp_rows, "tcp_basis": basis if tcp_rows else None,
           "leader": None, "margin_votes": None, "uncounted_estimate": uncounted, "status": "undecided", "called_by": None,
           "holder": holder, "changes_hands": False, "swing_2cp": None}
    if not total:
        return out
    if tcp_rows:
        lead, second = tcp_rows[0], tcp_rows[1]
        out["leader"] = {"id": lead["id"], "name": lead["name"], "party": lead["party"], "basis": basis}
        out["margin_votes"] = lead["votes"] - second["votes"]
        before = tcp_2022(data_dir, did)
        if set(before) == {lead["party"], second["party"]} and lead["pct"] is not None:
            out["swing_2cp"] = round(lead["pct"] - before[lead["party"]], 1)
        if out["margin_votes"] > (uncounted or 0) + buffer:
            out["status"], out["called_by"] = "called", "site"
        else:
            out["status"] = "leading"
    else:
        lead = out["candidates"][0]
        out["leader"] = {"id": lead["id"], "name": lead["name"], "party": lead["party"], "basis": "first preferences"}
        out["status"] = "leading"
    if out["elected"]:
        e = next(c for c in contest["candidates"] if c["elected"])
        out["leader"] = {"id": e["id"], "name": e["name"], "party": e["party"], "basis": out["leader"]["basis"] if out["leader"] else "declared"}
        out["status"], out["called_by"] = "called", "vec"
    out["changes_hands"] = bool(holder and out["leader"] and out["leader"]["party"] != holder)
    return out


def tally(districts: dict) -> dict:
    t = {"called": {}, "leading": {}, "undecided": 0, "counted_seats": 0, "majority": MAJORITY}
    for d in districts.values():
        if d["status"] == "undecided" or not d.get("leader"):
            t["undecided"] += 1
            continue
        b = BLOCS.get(d["leader"]["party"], "OTH")
        t[d["status"]][b] = t[d["status"]].get(b, 0) + 1
        t["counted_seats"] += 1
    t["undecided"] += SEATS - len(districts)   # districts with no page yet
    return t


def build_region(rid: str, page: dict, url: str) -> dict:
    groups, ungrouped, current = [], [], None
    for r in page["rows"]:
        party = party_code(r["party_name"], not r["party_name"])
        # Without group letters, a group is a run of one party; Liberal and National runs together are one joint
        # Coalition ticket (as in regional regions).
        key = r["group"] or ("LNP-joint" if party in ("LIB", "NAT") else r["party_name"])
        if r["group"] is None and not r["party_name"]:
            ungrouped.append({"name": r["name"], "party": "IND", "votes": r["votes"]})
            current = None
            continue
        if current is None or current["_key"] != key:
            current = {"_key": key, "group": r["group"], "name": r["group_name"] or r["party_name"] or None, "party": party,
                       "votes": 0, "ticket_votes": 0, "candidates": []}
            groups.append(current)
        current["votes"] += r["votes"]
        current.setdefault("_parties", set()).add(party)
        if r["ticket"]:
            current["ticket_votes"] += r["votes"]
        else:
            current["candidates"].append({"name": r["name"], "votes": r["votes"]})
    formal = page["formal"] or sum(g["votes"] for g in groups) + sum(u["votes"] for u in ungrouped)
    quota = page.get("quota") or (formal // (REGION_POSITIONS + 1) + 1 if formal else None)
    for g in groups:
        g.pop("_key")
        if {"LIB", "NAT"} <= g.pop("_parties", set()):   # a joint Coalition ticket
            g["party"], g["name"] = "LNP", g["name"] if g["group"] else "Liberal/Nationals (joint ticket)"
        g["pct"] = round(100 * g["votes"] / formal, 2) if formal else None
        g["quotas"] = round(g["votes"] / quota, 3) if quota else None
    for u in ungrouped:
        u["pct"] = round(100 * u["votes"] / formal, 2) if formal else None
        u["quotas"] = round(u["votes"] / quota, 3) if quota else None
    groups.sort(key=lambda g: -g["votes"])
    enrol, total = page.get("enrolment"), page.get("total")
    return {"name": page["name"], "url": url, "vec_updated": page.get("vec_updated"), "fetched": now_iso(),
            "enrolment": enrol, "formal": formal, "informal": page.get("informal"), "total": total,
            "counted_pct": round(100 * total / enrol, 1) if enrol and total else 0.0,
            "positions": REGION_POSITIONS, "quota": quota, "quota_source": "vec" if page.get("quota") else "computed",
            "elected": page.get("elected") or [], "groups": groups, "ungrouped": ungrouped}


# ---------------------------------------------------------------- the run
def load_config(name: str | None) -> dict:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    prof = cfg["profiles"][name or cfg["active"]]
    return {**prof, "profile": name or cfg["active"]}


def page_url(cfg: dict, kind: str, sid: str) -> str | None:
    if cfg["overrides"].get(f"{kind}:{sid}"):
        return cfg["overrides"][f"{kind}:{sid}"]
    if not cfg.get("base"):
        return None
    return cfg[f"{kind}_page"].format(base=cfg["base"].rstrip("/"), slug=sid)


def strip_volatile(d):
    """Compare outputs without fetch times, so an unchanged count doesn't rewrite files."""
    if isinstance(d, dict):
        return {k: strip_volatile(v) for k, v in d.items() if k not in ("fetched", "updated")}
    if isinstance(d, list):
        return [strip_volatile(x) for x in d]
    return d


def run(cfg: dict, data_dir: Path, only: set | None = None) -> int:
    districts = (read_json(data_dir / "districts.json", {}) or {}).get("districts", [])
    regions = (read_json(data_dir / "regions.json", {}) or {}).get("regions", [])
    if not districts:
        log.error("districts.json missing or empty in %s", data_dir)
        return 1
    res_path, lc_path, out_dir = data_dir / "results.json", data_dir / "results_lc.json", data_dir / "results_2026"
    fetch_path = out_dir / "_fetch.json"
    old = read_json(res_path, {}) or {}
    old_lc = read_json(lc_path, {}) or {}
    state = (read_json(fetch_path, {}) or {}).get("pages", {})
    phase = "final" if cfg["profile"] != "2026" else "ElectionNight"
    res = {"_schema": RESULTS_SCHEMA, "source": {"name": "Victorian Electoral Commission", "url": cfg.get("base")},
           "profile": cfg["profile"], "counting_starts": cfg["counting_starts"], "updated": old.get("updated"),
           "vec_updated": old.get("vec_updated"),
           "call_rule": {"buffer_pct_of_enrolment": CALL_BUFFER_PCT, "buffer_min_votes": CALL_BUFFER_MIN, "turnout_default": TURNOUT_DEFAULT,
                         "text": ("Called by this site when the leader's two-candidate-preferred margin is larger than the estimated uncounted "
                                  "vote plus a buffer (the larger of 250 votes and 1% of enrolment), so the trailing candidate couldn't catch "
                                  "up even with every remaining vote. Uncounted = enrolment x the seat's 2022 turnout - votes counted. "
                                  "A seat the VEC has declared is called by the VEC.")},
           "tally": None, "districts": dict(old.get("districts") or {})}
    lc = {"_schema": LC_SCHEMA, "source": res["source"], "profile": cfg["profile"], "updated": old_lc.get("updated"),
          "regions": dict(old_lc.get("regions") or {})}
    if not cfg.get("base") and not cfg["overrides"]:
        log.info("No results page addresses yet (profile %s has no base URL): nothing to fetch. Fill scripts/results_urls.json.", cfg["profile"])
    fetcher = Fetcher(state)
    skipped, parsed = [], 0
    holders = {d["id"]: (d.get("margin") or {}).get("party") or d.get("party") for d in districts}
    index = {}
    for d in districts:
        did = d["id"]
        if only and did not in only:
            continue
        url = page_url(cfg, "district", did)
        if not url:
            continue
        try:
            html, changed = fetcher.get(url)
            if not changed and did in res["districts"] and (out_dir / f"{did}.json").exists():
                continue   # page unchanged since the last run: keep its figures, skip the voting-centre pages
            if html is None:
                html, _ = fetcher.get(url, conditional=False)   # 304 but nothing stored: fetch it in full
            page = parse_district_page(html)
        except Exception as exc:  # noqa: BLE001 - log, keep the previous figures, carry on
            log.warning("%s: district page skipped (%s): %s", did, url, str(exc)[:200])
            skipped.append(did)
            continue
        vc = tcp = None
        for kind in ("district_vc", "district_tcp"):
            sub = page_url(cfg, kind, did)
            if not sub:
                continue
            try:
                sub_html, _ = fetcher.get(sub, conditional=False)
                parsed_sub = parse_vc_page(sub_html, "fp" if kind == "district_vc" else "tcp")
                if kind == "district_vc":
                    vc = parsed_sub
                else:
                    tcp = parsed_sub
            except Exception as exc:  # noqa: BLE001
                log.warning("%s: %s page skipped (%s): %s", did, kind.split("_")[1], sub, str(exc)[:200])
        try:
            contest = build_contest(did, cfg, page, vc, tcp, booths_2022(data_dir, did), url, phase)
            summary = summarise(did, contest, page, url, holders.get(did), data_dir)
        except Exception as exc:  # noqa: BLE001
            log.warning("%s: couldn't build the result (%s)", did, str(exc)[:200])
            skipped.append(did)
            continue
        old_contest = read_json(out_dir / f"{did}.json")
        if strip_volatile(old_contest) != strip_volatile(contest):
            write_json(out_dir / f"{did}.json", contest, compact=True)
        res["districts"][did] = summary
        parsed += 1
    for r in regions:
        rid = r["id"]
        if only and rid not in only:
            continue
        url = page_url(cfg, "region", rid)
        if not url:
            continue
        try:
            html, changed = fetcher.get(url)
            if not changed and rid in lc["regions"]:
                continue
            if html is None:
                html, _ = fetcher.get(url, conditional=False)
            lc["regions"][rid] = build_region(rid, parse_region_page(html), url)
        except Exception as exc:  # noqa: BLE001
            log.warning("%s: region page skipped (%s): %s", rid, url, str(exc)[:200])
            skipped.append(rid)

    res["districts"] = dict(sorted(res["districts"].items()))
    res["tally"] = tally(res["districts"])
    stamps = [d.get("vec_updated") for d in res["districts"].values() if d.get("vec_updated")]
    res["vec_updated"] = max(stamps, default=res["vec_updated"])
    for did, s in res["districts"].items():
        if s.get("leader"):
            pct = next((r["pct"] for r in (s["tcp"] or []) if r["id"] == s["leader"]["id"]), None)
            index[did] = {"leader": s["leader"]["party"], "declared": s["declared"],
                          "text": (f"{'Declared' if s['called_by'] == 'vec' else 'Called' if s['status'] == 'called' else 'Leading'}: "
                                   f"{s['leader']['name']} ({s['leader']['party']})"
                                   + (f", {pct:.1f}% 2CP" if pct is not None else ", on first preferences")
                                   + f"; {s['counted_pct']:.1f}% of enrolment counted")}
    changed_files = []
    if strip_volatile(old) != strip_volatile(res):
        res["updated"] = now_iso()
        write_json(res_path, res)
        changed_files.append(res_path.name)
    if strip_volatile(old_lc) != strip_volatile(lc):
        lc["updated"] = now_iso()
        write_json(lc_path, lc)
        changed_files.append(lc_path.name)
    idx_path = out_dir / "index.json"
    idx_old = read_json(idx_path, {}) or {}
    idx = {"_schema": idx_old.get("_schema"), "updated": res.get("vec_updated") or res.get("updated"), "districts": index}
    if idx_old.get("districts") != index:
        write_json(idx_path, idx)
        changed_files.append("results_2026/index.json")
    write_json(fetch_path, {"_note": "results.py fetch bookkeeping: validators and page hashes. Not data; not shown.", "pages": state})
    t = res["tally"]
    log.info("Results (%s): %d pages fetched, %d districts parsed, %d skipped; called %s, leading %s, undecided %d; changed: %s",
             cfg["profile"], fetcher.count, parsed, len(skipped), t["called"], t["leading"], t["undecided"], changed_files or "nothing")
    if skipped:
        warn_ci(f"results.py skipped {len(skipped)} page(s): {', '.join(skipped[:12])}")
    return 0


def check_urls(cfg: dict, data_dir: Path) -> int:
    districts = (read_json(data_dir / "districts.json", {}) or {}).get("districts", [])
    regions = (read_json(data_dir / "regions.json", {}) or {}).get("regions", [])
    fetcher = Fetcher({})
    bad = 0
    targets = [("district", d["id"]) for d in districts] + [("region", r["id"]) for r in regions]
    for kind, sid in targets:
        url = page_url(cfg, kind, sid)
        if not url:
            print(f"no URL: {kind} {sid} (profile {cfg['profile']} has no base)")
            bad += 1
            continue
        try:
            fetcher.get(url, conditional=False)
            print(f"ok    {url}")
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL  {url}: {str(exc)[:120]}")
            bad += 1
    print(f"{len(targets) - bad} of {len(targets)} pages answered")
    return 0


# ---------------------------------------------------------------- self-test against the VEC's 2026 sample XML
def selftest_samples(folder: Path, data_dir: Path) -> int:
    """Confirms the website-derived files have the 2026 shapes: each results_2026 contest has the same keys as the
    media-feed sample converted by vec_feed.py; every party in the 2026 sample candidate list maps to a code; and the
    sample upper-house groups map onto results_lc.json's group fields."""
    import vec_feed  # noqa: E402 - same folder
    folder = Path(folder)
    problems = []
    lh = sorted(folder.glob("*mediafile*lhv2_*.zip"))
    cands = vec_feed.parse_candidates(vec_feed.read_xml(next(folder.glob("*Candidates*.xml"))))
    locs = vec_feed.parse_locations(vec_feed.read_xml(next(folder.glob("*PollingLocations*.xml"))))
    sample = next(iter(vec_feed.convert(vec_feed.read_xml(lh[-1]), cands, locs).values()))
    ours = [read_json(p) for p in sorted((data_dir / "results_2026").glob("*.json")) if not p.name.startswith(("_", "index"))]
    if not ours:
        problems.append("no results_2026 contests in the data folder: run a test profile first")
    for c in ours[:200]:
        if set(c) != set(sample):
            problems.append(f"{c['contest']['district']}: contest keys differ from the feed sample: {set(c) ^ set(sample)}")
        if sample["polling_places"] and c["polling_places"] and set(c["polling_places"][0]) != set(sample["polling_places"][0]):
            problems.append(f"{c['contest']['district']}: polling place keys differ: {set(c['polling_places'][0]) ^ set(sample['polling_places'][0])}")
        if set(c["candidates"][0]) != set(sample["candidates"][0]):
            problems.append(f"{c['contest']['district']}: candidate keys differ")
        if set(c["first_preferences"]) != set(sample["first_preferences"]):
            problems.append(f"{c['contest']['district']}: first_preferences keys differ")
    unmapped = sorted({v["party_name"] for v in cands.values() if v.get("party_name") and party_code(v["party_name"]) == "OTH"})
    # Upper house: sample groups -> the fields results_lc.json uses
    uh = sorted(folder.glob("*verboseuhv2_*.zip"))
    lc = read_json(data_dir / "results_lc.json", {}) or {}
    if uh and lc.get("regions"):
        root = vec_feed.read_xml(uh[-1])
        contest = next(e for e in root.iter() if vec_feed.ln(e) == "Contest")
        groups = vec_feed.kids(vec_feed.kid(contest, "FirstPreferences"), "Group")
        g = groups[0]
        sample_group = {"group": None, "name": vec_feed.text(vec_feed.path(g, "GroupIdentifier", "GroupName")),
                        "party": party_code(vec_feed.text(vec_feed.path(g, "GroupIdentifier", "GroupName"))),
                        "votes": vec_feed.intval(vec_feed.path(g, "GroupVotes", "Votes")),
                        "ticket_votes": vec_feed.intval(vec_feed.path(g, "TicketVotes", "Votes")),
                        "pct": None, "quotas": None, "candidates": []}
        ours_group = next(iter(lc["regions"].values()))["groups"][0]
        if set(sample_group) != set(ours_group):
            problems.append(f"results_lc group fields differ from the feed's groups: {set(sample_group) ^ set(ours_group)}")
        quota_el = vec_feed.kid(contest, "Quota")
        print(f"upper-house sample: {len(groups)} groups, quota element {'present' if quota_el is not None else 'absent'}"
              f"{' (provisional, empty)' if quota_el is not None and not vec_feed.text(quota_el) else ''}; "
              f"positions {vec_feed.text(vec_feed.kid(contest, 'NumberOfPositions'))}")
    print(f"lower-house sample: {sample['contest']['name']}, {len(sample['candidates'])} candidates, {len(sample['polling_places'])} polling places")
    print(f"checked {len(ours)} website-derived contests against the feed sample's keys")
    if unmapped:
        print("2026 sample party names with no code here (shown as Other):", unmapped)
    for p in problems[:20]:
        print("PROBLEM", p)
    print("selftest:", "ok" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--profile", help="URL-map profile (default: the map's 'active', 2026)")
    ap.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    ap.add_argument("--only", help="comma-separated district/region ids (testing)")
    ap.add_argument("--check-urls", action="store_true", help="fetch every page in the URL map once and report")
    ap.add_argument("--selftest-samples", type=Path, help="compare the data folder's results with the VEC's 2026 sample XML")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    data_dir = a.data_dir.resolve()
    if a.selftest_samples:
        return selftest_samples(a.selftest_samples, data_dir)
    try:
        cfg = load_config(a.profile)
    except (OSError, KeyError, json.JSONDecodeError) as exc:
        log.error("URL map unusable (%s): %s", CONFIG.name, exc)
        return 1
    if cfg["profile"] != "2026" and data_dir == DEFAULT_DATA_DIR.resolve():
        log.error("The %s profile is a test stand-in: run it with --data-dir pointing at a copy, never site/data", cfg["profile"])
        return 1
    if a.check_urls:
        return check_urls(cfg, data_dir)
    return run(cfg, data_dir, set(a.only.split(",")) if a.only else None)


if __name__ == "__main__":
    sys.exit(main())
