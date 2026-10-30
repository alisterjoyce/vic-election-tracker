#!/usr/bin/env python3
"""Refresh the tracker's data files in site/data.

* Polls: scraped from the Wikipedia page "Opinion polling for the 2026
  Victorian state election" with pandas.read_html, written to polls.json.
* Candidates: new names from the Wikipedia page "Candidates of the 2026
  Victorian state election" (Assembly and Council tables) are added to
  candidates.json as "announced". Existing rows are never changed.
* ABC election guide (primary lower-house source): each district page's
  margin, classification, sitting member, retiring flag and candidate
  table. Candidates become "endorsed"; an ABC entry supersedes other rows
  for the same party and seat (kept, marked "superseded"). The retiring
  MPs page sets retiring flags for MPs and MLCs.
* Sportsbet seat markets (best effort): fills seat_odds.json if the site
  can be fetched and parsed; otherwise the file is treated as manual.
* VEC candidates: placeholder (see fetch_vec_candidates below).
* How-to-vote cards: the VEC register (from 10 Nov 2026), recorded in htv.json;
  preference orders are entered by hand and kept.
* Change log: compares the data with the previous run's (changelog_state.json)
  and records new candidates, superseded names, new polls, odds moves of 0.5
  or more, retirements and new headlines in changelog.json.
* News: per-district Bing News RSS searches plus publishers' feeds, matched to
  seats by district or MP name; headline, outlet, date and link only (news.json).
* meta.json: last_updated and per-source status.

If a fetch or parse fails, the error is logged and the existing file is kept.
The script exits 0 either way so a scheduled run never commits half a file.

Usage:
    python scripts/refresh.py [--data-dir site/data]
"""

from __future__ import annotations

import argparse
import calendar
import difflib
import email.utils
import hashlib
import html as htmllib
import io
import json
import logging
import os
import re
import sys
import tempfile
import time
import unicodedata
import urllib.robotparser
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import lxml.html
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT / "site" / "data"

POLLS_URL = "https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Victorian_state_election"
CANDIDATES_URL = "https://en.wikipedia.org/wiki/Candidates_of_the_2026_Victorian_state_election"
MELBOURNE = ZoneInfo("Australia/Melbourne")
USER_AGENT = "vic-election-tracker/1.0 (daily poll refresh; python-requests)"
TIMEOUT = 30

# Wikipedia column header -> party code used in polls.json
PARTY_CODES = {
    "ALP": "ALP", "LAB": "ALP", "LABOR": "ALP",
    "L/NP": "LNP", "LNP": "LNP", "COALITION": "LNP", "LIB": "LIB", "NAT": "NAT",
    "GRN": "GRN", "GREENS": "GRN",
    "ONP": "ONP", "ONE NATION": "ONP",
    "IND": "IND", "INDEPENDENTS": "IND",
    "OTH": "OTH", "OTHERS": "OTH", "OTHER": "OTH",
}

MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}

POLLS_SCHEMA = {
    "description": "Published voting-intention polls, scraped from Wikipedia by scripts/refresh.py.",
    "fields": {
        "id": "Stable id: <pollster slug>-<end_date>, with -2, -3 for repeats (used by poll.html#<id>)",
        "start_date": "Fieldwork start, YYYY-MM-DD (may equal end_date)",
        "end_date": "Fieldwork end, YYYY-MM-DD",
        "pollster": "Polling firm / brand",
        "client": "Commissioning client (newspaper, party, lobby group), or null if none or not published",
        "sample_size": "Integer respondents, or null if not published",
        "source_url": "The poll's first citation on Wikipedia (pollster release or news report), or null",
        "primary": "Map of party code -> primary vote %. Codes: ALP, LNP (Liberal + National), GRN, ONP, IND, OTH",
        "tpp": "Two-party-preferred %: {ALP, LNP}; omitted when the poll did not publish an ALP v L/NP figure",
        "tpp3": "Optional three-party-preferred %: {ALP, LNP, ONP}",
        "preferred_premier": "Optional: {matchup, leaders: {surname: %}, undecided: %}",
        "approval": "Optional: {matchup, leaders: {surname: {positive, negative, undecided, net}}} (net = positive - negative, as published)",
    },
}

log = logging.getLogger("refresh")


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path, default=None):
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as exc:
        log.error("%s is not valid JSON (%s); treating as missing", path.name, exc)
        return default


def write_json(path: Path, data) -> None:
    """Write atomically so a crash never leaves a half-written file behind."""
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def warn_ci(message: str) -> None:
    """Surface a warning as an annotation when running in GitHub Actions."""
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::warning title=refresh.py::{message}")


def clean_text(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    s = str(value)
    s = re.sub(r"\[[^\]]*\]", "", s)              # footnote markers like [12] or [a]
    s = s.replace("–", "-").replace("—", "-").replace("−", "-")
    s = s.replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def to_number(value):
    s = clean_text(value).replace("%", "").replace(",", "")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    n = float(m.group())
    return int(n) if n.is_integer() else n


# --------------------------------------------------------------------------
# Dates: Wikipedia uses "15-22 Oct", "24 Nov - 8 Dec 2025", "7 Dec 2025", "Jul-Aug 2023"
# --------------------------------------------------------------------------

def _parse_part(text: str):
    day = re.search(r"\b(\d{1,2})\b", text)
    year = re.search(r"\b(\d{4})\b", text)
    month = None
    for word in re.findall(r"[A-Za-z]+", text):
        month = MONTHS.get(word[:3].lower())
        if month:
            break
    return (int(day.group(1)) if day else None, month, int(year.group(1)) if year else None)


def parse_date_range(text: str, fallback_year: int):
    """Return (start, end) dates, or None if the text isn't a date."""
    s = clean_text(text)
    parts = [p.strip() for p in s.split("-") if p.strip()]
    if not parts:
        return None
    sd, sm, sy = _parse_part(parts[0])
    ed, em, ey = _parse_part(parts[-1])
    em = em or sm
    sm = sm or em
    if not em:
        return None
    ey = ey or sy or fallback_year
    sy = sy or (ey if sm <= em else ey - 1)
    ed = ed or calendar.monthrange(ey, em)[1]
    sd = sd or 1
    try:
        start, end = date(sy, sm, sd), date(ey, em, ed)
    except ValueError:
        return None
    return (min(start, end), end)


# --------------------------------------------------------------------------
# Polls
# --------------------------------------------------------------------------

def _flatten(col) -> list[str]:
    levels = col if isinstance(col, tuple) else (col,)
    return [clean_text(x) for x in levels if not str(x).startswith("Unnamed")]


def _find(columns, *needles):
    for col in columns:
        label = " ".join(_flatten(col)).lower()
        if any(n in label for n in needles):
            return col
    return None


def wiki_sections(doc) -> list[dict]:
    """Every wikitable on the page with the h2/h3/h4 headings above it
    (lower-cased, without "[edit]") and the year when the h4 is one."""
    h2 = h3 = h4 = ""
    found = []
    for el in doc.iter("h2", "h3", "h4", "table"):
        text = clean_text(el.text_content()).lower().removesuffix("edit").strip() if el.tag != "table" else ""
        if el.tag == "h2":
            h2, h3, h4 = text, "", ""
        elif el.tag == "h3":
            h3, h4 = text, ""
        elif el.tag == "h4":
            h4 = text
        elif "wikitable" in (el.get("class") or ""):
            m = re.fullmatch(r"(\d{4})", h4)
            found.append({"h2": h2, "h3": h3, "h4": h4, "year": int(m.group(1)) if m else None, "table": el})
    return found


def statewide_tables(html: str) -> list[tuple[int | None, str]]:
    """Return (year, table_html) for each table under "Voting intention" ->
    "Legislative Assembly". The page also has upper-house, sub-state and
    demographic tables with identical headers, which must not be mixed in.
    The year comes from the h4 above each table (the current year's table
    leaves the year off its dates)."""
    return [(s["year"], lxml.html.tostring(s["table"], encoding="unicode"))
            for s in wiki_sections(lxml.html.fromstring(html))
            if "voting intention" in s["h2"] and "council" not in s["h3"]]


def _reference_urls(doc) -> dict[str, str]:
    """Footnote id -> first external link in that reference."""
    out = {}
    for li in doc.xpath("//ol[contains(@class, 'references')]/li[@id]"):
        hrefs = li.xpath(".//a[contains(@class, 'external')]/@href")
        if hrefs:
            out[li.get("id")] = hrefs[0]
    return out


def row_sources(table, refs: dict[str, str]) -> dict[tuple[str, str], str]:
    """(date text, firm text) -> URL of the first footnote in the firm cell."""
    out = {}
    for tr in table.xpath(".//tr"):
        cells = tr.xpath("./td|./th")
        if len(cells) < 2:
            continue
        for a in cells[1].xpath(".//sup[contains(@class, 'reference')]//a/@href"):
            url = refs.get(a.lstrip("#"))
            if url:
                out[(clean_text(cells[0].text_content()), clean_text(cells[1].text_content()))] = url
                break
    return out


def firm_key(name: str) -> str:
    """"DemosAU/Premier National" and "DemosAU" are the same firm; so are "RedBridge" and "Redbridge"."""
    return re.sub(r"[^a-z]", "", name.lower().split("/")[0])


def _client(value) -> str | None:
    s = clean_text(value)
    return None if not s or re.fullmatch(r"-?\s*(n/?a)?", s, re.I) else s.replace("(subscription required)", "").strip()


def _collapse_merged_cells(values: list[list]) -> list[list]:
    """read_html copies a colspan cell into every column it spans, so a
    combined "IND + Others" figure (or one L/NP figure across LIB and NAT)
    is counted twice. When the primaries clearly overshoot 100%, drop the
    left-hand copy of whichever adjacent equal pair brings the total
    closest to 100, until they don't."""
    values = [list(v) for v in values]
    total = sum(v for _, v in values)
    while total > 103:
        pairs = [i for i in range(1, len(values)) if values[i][1] == values[i - 1][1]]
        if not pairs:
            break
        i = min(pairs, key=lambda i: abs(total - values[i - 1][1] - 100))
        total -= values[i - 1][1]
        del values[i - 1]
    return values


def parse_poll_table(df: pd.DataFrame, today: date, year: int | None = None) -> list[dict]:
    cols = list(df.columns)
    date_col = _find(cols, "date")
    firm_col = _find(cols, "polling firm", "pollster", "firm", "brand")
    sample_col = _find(cols, "sample")
    client_col = _find(cols, "client")
    if date_col is None or firm_col is None:
        return []

    primary_cols, tpp_cols = [], {}
    for col in cols:
        levels = _flatten(col)
        if len(levels) < 2:
            continue
        group, party = levels[0].lower(), levels[-1].upper()
        code = PARTY_CODES.get(party)
        if not code:
            continue
        if "primary" in group:
            primary_cols.append((code, col))
        elif "2pp" in group or "two-party" in group or "two party" in group:
            tpp_cols[code] = col
    if not primary_cols and not tpp_cols:
        return []  # leader ratings, seat polls etc.

    polls = []
    for _, row in df.iterrows():
        firm = clean_text(row[firm_col])
        raw_date = clean_text(row[date_col])
        if not firm or firm == raw_date or "election" in firm.lower() or "election" in raw_date.lower():
            continue  # election-result rows and full-width section rows

        dates = parse_date_range(raw_date, year or today.year)
        if not dates:
            continue
        start, end = dates
        if year is None and end > today and not re.search(r"\d{4}", raw_date):
            # A yearless date in the future belongs to last year.
            start, end = start.replace(year=start.year - 1), end.replace(year=end.year - 1)

        values = [[code, to_number(row[col])] for code, col in primary_cols]
        primary = {}
        for code, v in _collapse_merged_cells([cv for cv in values if cv[1] is not None]):
            primary[code] = primary.get(code, 0) + v
        # Some years split the Coalition into LIB and NAT; fold them into LNP
        # unless the table already gives a combined L/NP figure.
        lib, nat = primary.pop("LIB", None), primary.pop("NAT", None)
        if "LNP" not in primary and (lib is not None or nat is not None):
            total = (lib or 0) + (nat or 0)
            primary["LNP"] = int(total) if float(total).is_integer() else round(total, 1)

        tpp = {}
        alp, lnp = (to_number(row[tpp_cols[k]]) if k in tpp_cols else None for k in ("ALP", "LNP"))
        if alp is not None and lnp is not None:
            tpp = {"ALP": alp, "LNP": lnp}

        if not primary and not tpp:
            continue
        sample = to_number(row[sample_col]) if sample_col is not None else None
        poll = {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "pollster": firm,
            "client": _client(row[client_col]) if client_col is not None else None,
            "sample_size": int(sample) if sample else None,
            "_key": (raw_date, firm),
            "primary": primary,
        }
        if tpp:
            poll["tpp"] = tpp
        polls.append(poll)
    return polls


def _row_dates(row, date_col, year, today):
    raw = clean_text(row[date_col])
    dates = parse_date_range(raw, year or today.year)
    if dates and year is None and dates[1] > today and not re.search(r"\d{4}", raw):
        dates = (dates[0].replace(year=dates[0].year - 1), dates[1].replace(year=dates[1].year - 1))
    return dates


def parse_leadership_table(df: pd.DataFrame, kind: str, today: date) -> list[dict]:
    """Preferred-premier rows -> {firm, start, end, leaders: {name: %}, undecided}, or
    approval rows -> {firm, start, end, leaders: {name: {positive, negative, undecided, net}}}."""
    cols = list(df.columns)
    date_col, firm_col = _find(cols, "date"), _find(cols, "polling firm", "pollster", "firm")
    if date_col is None or firm_col is None:
        return []
    out = []
    for _, row in df.iterrows():
        firm = clean_text(row[firm_col])
        dates = _row_dates(row, date_col, None, today)
        if not firm or not dates or "election" in firm.lower():
            continue
        leaders, undecided = {}, None
        for col in cols:
            levels = _flatten(col)
            if len(levels) < 2:
                continue
            v = to_number(row[col])
            if kind == "premier" and "leader" in levels[0].lower():
                if "know" in levels[-1].lower() or "undecided" in levels[-1].lower():
                    undecided = v
                elif v is not None:
                    leaders[levels[-1]] = v
            elif kind == "approval" and levels[0].lower() not in ("date", "polling firm", "client", "sample size"):
                field = {"pos.": "positive", "neg.": "negative", "dk": "undecided", "net": "net"}.get(levels[-1].lower())
                if field and v is not None:
                    leaders.setdefault(levels[0], {})[field] = v
        if leaders:
            rec = {"firm": firm, "start": dates[0], "end": dates[1], "leaders": leaders}
            if kind == "premier":
                rec["undecided"] = undecided
            out.append(rec)
    return out


def parse_tpp3_table(df: pd.DataFrame, today: date) -> list[dict]:
    cols = list(df.columns)
    date_col, firm_col = _find(cols, "date"), _find(cols, "polling firm", "pollster", "firm")
    if date_col is None or firm_col is None:
        return []
    out = []
    for _, row in df.iterrows():
        firm = clean_text(row[firm_col])
        dates = _row_dates(row, date_col, None, today)
        vals = {}
        for col in cols:
            levels = _flatten(col)
            code = PARTY_CODES.get(levels[-1].upper()) if len(levels) > 1 and "3pp" in levels[0].lower() else None
            if code and to_number(row[col]) is not None:
                vals[code] = to_number(row[col])
        if firm and dates and len(vals) == 3:
            out.append({"firm": firm, "start": dates[0], "end": dates[1], "values": vals})
    return out


def _attach(polls: list[dict], extras: list[dict], field: str, build) -> int:
    """Attach each leadership/3PP row to the voting-intention poll from the same firm whose
    fieldwork overlaps it (closest end date wins). Returns how many were attached."""
    attached = 0
    for x in extras:
        best = None
        for p in polls:
            if firm_key(p["pollster"]) != firm_key(x["firm"]):
                continue
            ps, pe = date.fromisoformat(p["start_date"]), date.fromisoformat(p["end_date"])
            if ps <= x["end"] and x["start"] <= pe:
                gap = abs((pe - x["end"]).days)
                if best is None or gap < best[0]:
                    best = (gap, p)
        if best and field not in best[1]:
            best[1][field] = build(x)
            attached += 1
    return attached


def fetch_polls(today: date | None = None) -> list[dict]:
    today = today or datetime.now(timezone.utc).date()
    resp = requests.get(POLLS_URL, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
    resp.raise_for_status()
    doc = lxml.html.fromstring(resp.text)
    sections = wiki_sections(doc)
    refs = _reference_urls(doc)
    tables = [s for s in sections if "voting intention" in s["h2"] and "council" not in s["h3"]]
    if not tables:
        raise ValueError("no tables found under the 'Voting intention' heading")

    polls, used, sources = [], 0, {}
    for s in tables:
        sources.update(row_sources(s["table"], refs))
        for df in pd.read_html(io.StringIO(lxml.html.tostring(s["table"], encoding="unicode"))):
            rows = parse_poll_table(df, today, s["year"])
            if rows:
                used += 1
                polls.extend(rows)
    if not polls:
        raise ValueError(f"no voting-intention rows found in {len(tables)} tables")

    seen, unique = set(), []
    for p in sorted(polls, key=lambda p: (p["end_date"], p["start_date"], p["pollster"]), reverse=True):
        key = (p["start_date"], p["end_date"], p["pollster"].lower())
        if key not in seen:
            seen.add(key)
            unique.append(p)

    # Links, then leadership and three-party-preferred figures from their own tables.
    for p in unique:
        p["source_url"] = sources.get(p.pop("_key"))
    extras = {"premier": [], "approval": [], "tpp3": []}
    for s in sections:
        kind = ("premier" if "preferred premier" in s["h3"] else "approval" if "approval" in s["h3"] else None) \
            if "leadership" in s["h2"] else ("tpp3" if "three-party" in s["h2"] else None)
        if not kind:
            continue
        for df in pd.read_html(io.StringIO(lxml.html.tostring(s["table"], encoding="unicode"))):
            rows = parse_tpp3_table(df, today) if kind == "tpp3" else parse_leadership_table(df, kind, today)
            for r in rows:
                r["matchup"] = s["h4"].title().replace(" Vs ", " vs ")
            extras[kind].extend(rows)
    n_pp = _attach(unique, extras["premier"], "preferred_premier",
                   lambda x: {"matchup": x["matchup"], "leaders": x["leaders"], "undecided": x["undecided"]})
    n_ap = _attach(unique, extras["approval"], "approval", lambda x: {"matchup": x["matchup"], "leaders": x["leaders"]})
    n_3 = _attach(unique, extras["tpp3"], "tpp3", lambda x: x["values"])

    # Stable ids, oldest first so a later poll never renumbers an earlier one.
    counts = {}
    for p in sorted(unique, key=lambda p: (p["end_date"], p["start_date"], p["pollster"])):
        base = f"{re.sub(r'[^a-z0-9]+', '-', p['pollster'].lower()).strip('-')}-{p['end_date']}"
        counts[base] = counts.get(base, 0) + 1
        p["id"] = base if counts[base] == 1 else f"{base}-{counts[base]}"
    order = ["id", "start_date", "end_date", "pollster", "client", "sample_size", "source_url",
             "primary", "tpp", "tpp3", "preferred_premier", "approval"]
    unique = [{k: p[k] for k in order if k in p} for p in unique]
    log.info("Parsed %d polls from %d of %d tables; attached %d/%d preferred-premier, %d/%d approval, %d/%d 3PP rows; "
             "%d with a source link", len(unique), used, len(tables), n_pp, len(extras["premier"]),
             n_ap, len(extras["approval"]), n_3, len(extras["tpp3"]), sum(1 for p in unique if p["source_url"]))
    return unique


def refresh_polls(data_dir: Path, meta: dict) -> bool:
    source = meta.setdefault("sources", {}).setdefault("polls", {"url": POLLS_URL})
    path = data_dir / "polls.json"
    try:
        polls = fetch_polls()
    except Exception as exc:  # noqa: BLE001 - any failure means keep the old file
        log.error("Poll fetch failed, keeping existing %s: %s", path.name, exc)
        warn_ci(f"Poll fetch failed, kept existing polls.json: {exc}")
        source.update(status="error", message=str(exc)[:300])
        return False

    # The script owns this file, so its schema always replaces whatever was there.
    write_json(path, {
        "_schema": POLLS_SCHEMA,
        "source": POLLS_URL,
        "polls": polls,
    })
    source.update(status="ok", url=POLLS_URL, last_success=now_iso(), message=f"{len(polls)} polls")
    meta.setdefault("sample_data", {})["polls"] = False
    log.info("Wrote %s (%d polls)", path.name, len(polls))
    return True


# --------------------------------------------------------------------------
# Candidates: Wikipedia "Candidates of the 2026 Victorian state election"
# --------------------------------------------------------------------------
# New names are added with status "announced"; existing rows are never
# changed or removed, so hand-checked or VEC statuses always win.

SEP = "|"  # marks list-item and line-break boundaries inside a table cell

# Column header / bracketed abbreviation -> party code used by the site
WIKI_PARTIES = {
    "labor": "ALP", "alp": "ALP",
    "coalition": "LNP", "liberal": "LIB", "l": "LIB", "lib": "LIB",
    "national": "NAT", "nationals": "NAT", "n": "NAT", "nat": "NAT",
    "greens": "GRN", "grn": "GRN", "one nation": "ONP", "on": "ONP", "onp": "ONP",
    "socialists": "VS", "victorian socialists": "VS", "vs": "VS",
    "legalise cannabis": "LCV", "lcv": "LCV", "lc": "LCV",
    "ajp": "AJP", "animal justice": "AJP", "family first": "FF", "ff": "FF",
    "libertarian": "LBT", "lbt": "LBT", "dlp": "DLP", "sff": "SFF",
    "sustainable": "SUS", "sus": "SUS", "new democrats": "ND", "nd": "ND",
    "west": "WEST", "west party": "WEST", "socialist alliance": "SAL", "sa": "SAL",
    "independent": "IND", "ind": "IND",
}


def _name_key(name: str) -> str:
    """Compare names ignoring case, accents, punctuation and titles."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"^(dr|mr|mrs|ms|prof)\.?\s+", "", s)
    return re.sub(r"[^a-z]", "", s)


def _candidate_key(c: dict) -> tuple[str, str]:
    return (c.get("district") or c.get("region") or "", _name_key(c.get("name", "")))


def _same_person(a: str, b: str) -> bool:
    """Same surname, or near-identical spelling ("Fuery"/"Fruery")."""
    ka, kb = _name_key(a), _name_key(b)
    if _name_key(a.split()[-1]) == _name_key(b.split()[-1]):
        return True
    return difflib.SequenceMatcher(None, ka, kb).ratio() >= 0.85


def _near_identical(a: str, b: str) -> bool:
    """Stricter test for parties that can field several people in one seat
    (independents): near-identical surname AND first name, e.g.
    "Ashley Vandenburg" / "Ashleigh Vandenberg". A shared surname alone
    is not enough."""
    pa, pb = a.split(), b.split()
    if not pa or not pb:
        return False
    fa, fb = _name_key(pa[0]), _name_key(pb[0])
    sa, sb = _name_key(pa[-1]), _name_key(pb[-1])
    first_ok = fa == fb or fa.startswith(fb) or fb.startswith(fa) or difflib.SequenceMatcher(None, fa, fb).ratio() >= 0.7
    return first_ok and difflib.SequenceMatcher(None, sa, sb).ratio() >= 0.85


def _sort_candidates(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda c: (c.get("district") or "", c.get("region") or "",
                                       c.get("ticket_position") or 0, c.get("name", "")))


def _party_code(label: str) -> str | None:
    label = re.sub(r"\s*candidates?$", "", clean_text(label.replace(SEP, " ")), flags=re.I)
    return WIKI_PARTIES.get(label.strip().lower())


def _split_names(cell) -> list[str]:
    # Backstop for unmarked boundaries: "Jane Doe (Ind) John Roe (FF)"
    text = re.sub(r"(?<=\))\s+(?=[A-Z])", SEP, clean_text(cell))
    return [n for n in (clean_text(x) for x in text.split(SEP)) if n]


def wiki_candidate_tables(html: str) -> tuple[list[str], list[tuple[str, str]]]:
    """Return (assembly_tables, [(region_heading, council_table)]) as HTML,
    with footnotes removed and list/line breaks marked with SEP so names in
    one cell can be told apart after read_html flattens them."""
    doc = lxml.html.fromstring(html)
    for sup in doc.xpath("//sup[contains(@class, 'reference')]"):
        sup.drop_tree()
    for el in doc.iter("li", "br"):
        el.tail = SEP + (el.tail or "")
    for el in doc.iter("p"):  # some cells put each extra name in its own paragraph
        el.text = SEP + (el.text or "")
    assembly, council = [], []
    h2 = h3 = ""
    for el in doc.iter("h2", "h3", "table"):
        if el.tag == "h2":
            h2, h3 = clean_text(el.text_content()).lower(), ""
        elif el.tag == "h3":
            h3 = clean_text(el.text_content())
        elif "wikitable" in (el.get("class") or ""):
            table = lxml.html.tostring(el, encoding="unicode")
            if h2.startswith("legislative assembly"):
                assembly.append(table)
            elif h2.startswith("legislative council") and h3:
                council.append((h3, table))
    return assembly, council


def parse_assembly_table(df: pd.DataFrame, district_ids: set[str]) -> list[dict]:
    cols = [(c, " ".join(_flatten(c))) for c in df.columns]
    seat_col = next((c for c, label in cols if "electorate" in label.lower() or "district" in label.lower()), None)
    if seat_col is None:
        return []
    rows = []
    for _, row in df.iterrows():
        seat = clean_text(row[seat_col])
        if not seat:
            continue
        did = re.sub(r"[^a-z0-9]+", "-", seat.lower()).strip("-")
        if did not in district_ids:
            log.warning("Wikipedia electorate %r is not in districts.json; skipped", seat)
            continue
        for col, label in cols:
            label_l = label.lower()
            if col == seat_col or "held by" in label_l:
                continue
            column_party = _party_code(label) if "other" not in label_l else None
            for entry in _split_names(row[col]):
                # "Andrew Cook (L)", "Georgie Dragwidge (Ind)"
                m = re.fullmatch(r"(.+?)\s*\(([^)]+)\)", entry)
                name, tag = (m.group(1), m.group(2)) if m else (entry, None)
                party = WIKI_PARTIES.get(tag.lower()) if tag else None
                party = party or column_party
                if party is None:
                    party = "OTH"
                rows.append({"district": did, "name": name, "party": party,
                             "_label": tag if tag and not WIKI_PARTIES.get(tag.lower()) else None})
    return rows


def parse_council_table(df: pd.DataFrame, region_id: str) -> list[dict]:
    """Council tables repeat a header row of party names, a colour row and a
    row of ordered candidate lists, several times down the table."""
    headers = [clean_text(c if not isinstance(c, tuple) else c[-1]) for c in df.columns]
    rows = []
    for _, row in df.iterrows():
        values = [clean_text(v) for v in row.tolist()]
        filled = [v for v in values if v]
        if not filled:
            continue
        if all(re.search(r"candidates?$", v.replace(SEP, " ").strip(), re.I) for v in filled):
            headers = values
            continue
        for label, cell in zip(headers, values):
            if not label or not cell:
                continue
            party = _party_code(label)
            party_label = re.sub(r"\s*candidates?$", "", label.replace(SEP, " ").strip(), flags=re.I)
            for pos, name in enumerate(_split_names(cell), start=1):
                rows.append({"region": region_id, "name": name, "party": party or "OTH",
                             "ticket_position": pos, "_label": None if party else party_label})
    return rows


def fetch_wiki_candidates(district_ids: set[str]) -> tuple[list[dict], list[dict]]:
    resp = requests.get(CANDIDATES_URL, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
    resp.raise_for_status()
    assembly_html, council_html = wiki_candidate_tables(resp.text)
    if not assembly_html:
        raise ValueError("no tables found under the 'Legislative Assembly' heading")

    assembly = []
    for table in assembly_html:
        for df in pd.read_html(io.StringIO(table)):
            assembly.extend(parse_assembly_table(df, district_ids))
    council = []
    for heading, table in council_html:
        region_id = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")
        for df in pd.read_html(io.StringIO(table)):
            council.extend(parse_council_table(df, region_id))
    if not assembly:
        raise ValueError("no Legislative Assembly candidates parsed")
    log.info("Parsed %d assembly and %d council candidates from Wikipedia", len(assembly), len(council))
    return assembly, council


def refresh_wiki_candidates(data_dir: Path, meta: dict) -> bool:
    source = meta.setdefault("sources", {}).setdefault("wikipedia_candidates", {"url": CANDIDATES_URL})
    path = data_dir / "candidates.json"
    try:
        districts = (read_json(data_dir / "districts.json", {}) or {}).get("districts", [])
        regions = (read_json(data_dir / "regions.json", {}) or {}).get("regions", [])
        if not districts:
            raise ValueError("districts.json has no districts to match against")
        assembly, council = fetch_wiki_candidates({d["id"] for d in districts})
    except Exception as exc:  # noqa: BLE001 - any failure means keep the old file
        log.error("Wikipedia candidate fetch failed, keeping existing %s: %s", path.name, exc)
        warn_ci(f"Wikipedia candidate fetch failed, kept existing candidates.json: {exc}")
        source.update(status="error", message=str(exc)[:300])
        return False

    existing = read_json(path, {}) or {}
    rows = existing.get("candidates", [])
    known = {_candidate_key(c) for c in rows}
    # (seat, party) -> names already recorded, to catch spelling variants of the same person
    same_party = {}
    for c in rows:
        same_party.setdefault((c.get("district") or c.get("region"), c.get("party")), []).append(c["name"])
    # Council names already on a hand-maintained ticket in regions.json count as present.
    for r in regions:
        for t in r.get("tickets", []):
            for name in t.get("candidates", []):
                known.add((r["id"], _name_key(name)))
                same_party.setdefault((r["id"], t.get("party")), []).append(name)
    sitting = {d["id"]: _name_key(d.get("sitting_mp", "")) for d in districts}
    today = datetime.now(MELBOURNE).date().isoformat()

    added = {"assembly": 0, "council": 0}
    for c in assembly + council:
        seat = c.get("district") or c["region"]
        key = (seat, _name_key(c["name"]))
        others = same_party.get((seat, c["party"]), [])
        similar = _near_identical if c["party"] in MULTI_PER_SEAT else _same_person
        if key in known or any(similar(c["name"], o) for o in others):
            continue
        known.add(key)
        row = {**({"district": c["district"]} if "district" in c else {"district": None, "region": c["region"]}),
               "name": c["name"], "party": c["party"], "status": "announced"}
        if "ticket_position" in c:
            row["ticket_position"] = c["ticket_position"]
        else:
            row["ballot_position"] = None
            row["incumbent"] = sitting.get(c["district"]) == _name_key(c["name"])
        row.update(source="wikipedia", source_url=CANDIDATES_URL, date_added=today, updated=today)
        notes = []
        if c.get("_label"):
            notes.append(f"Party on Wikipedia: {c['_label']}")
        if others and c["party"] not in ("IND", "OTH") and "region" not in c:
            # Two candidates for one party in one seat: the sources disagree.
            notes.append(f"Conflicts with {', '.join(others)}, already recorded for this party here")
            log.warning("%s: Wikipedia lists %s (%s) but %s is already recorded",
                        seat, c["name"], c["party"], ", ".join(others))
        if notes:
            row["notes"] = "; ".join(notes)
        same_party.setdefault((seat, c["party"]), []).append(c["name"])
        rows.append(row)
        added["council" if "region" in c else "assembly"] += 1

    total = added["assembly"] + added["council"]
    source.update(status="ok", url=CANDIDATES_URL, last_success=now_iso(),
                  message=f"{len(assembly)} assembly and {len(council)} council names read; "
                          f"{added['assembly']} assembly and {added['council']} council added")
    if not total:
        log.info("No new candidates on Wikipedia; %s left unchanged", path.name)
        return False
    write_json(path, {**existing, "candidates": _sort_candidates(rows)})
    log.info("Wrote %s (%d assembly, %d council candidates added)", path.name, added["assembly"], added["council"])
    return True


# --------------------------------------------------------------------------
# Candidates and seat facts: ABC election guide (primary lower-house source)
# --------------------------------------------------------------------------
# Only facts are taken from each district page: the margin pill
# ("Very Safe Labor 14.6%"), the sitting member's name and whether the
# "Held by" line says they are retiring, and the alphabetical candidate
# table. No profile or biography text is stored; districts link to the page.

ABC_GUIDE = "https://www.abc.net.au/news/elections/vic/2026/guide/"
ABC_ELECTORATES_URL = ABC_GUIDE + "electorates"
ABC_RETIRING_URL = ABC_GUIDE + "retiring-mps"
ABC_AZ_URL = ABC_GUIDE + "candidates"   # A-Z list of every lower-house candidate
ABC_USER_AGENT = ("vic-election-tracker/1.0 (static Victorian election tracker; daily refresh, "
                  "1 request/second; https://github.com/alisterjoyce/vic-election-tracker)")
ABC_DELAY = 1.0      # seconds between requests
ABC_ATTEMPTS = 3     # tries per page before the whole ABC step is skipped

# Ordered: first keyword found in the ABC's party name wins.
ABC_PARTIES = [
    ("libertarian", "LBT"), ("liberal democrat", "LBT"), ("liberal", "LIB"), ("national", "NAT"),
    ("green", "GRN"), ("one nation", "ONP"), ("victorian socialists", "VS"),
    ("socialist alliance", "SAL"), ("animal justice", "AJP"), ("family first", "FF"),
    ("legalise cannabis", "LCV"), ("shooters", "SFF"), ("democratic labour", "DLP"),
    ("sustainable", "SUS"), ("new democrats", "ND"), ("west", "WEST"),
    ("independent", "IND"), ("labor", "ALP"),
]
# Rows for these parties can share a seat, so they never supersede each other.
MULTI_PER_SEAT = {"IND", "OTH"}
# Statuses an ABC entry never overrides.
FINAL_STATUSES = {"vec_nominated"}


class AbcFetchFailed(Exception):
    pass


class PoliteSession:
    """GETs at most one page per ABC_DELAY seconds, retrying each page."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = ABC_USER_AGENT
        self.last = 0.0

    def get(self, url: str) -> str:
        error = None
        for attempt in range(1, ABC_ATTEMPTS + 1):
            wait = self.last + ABC_DELAY - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            try:
                resp = self.session.get(url, timeout=TIMEOUT)
                resp.raise_for_status()
                return resp.text
            except requests.RequestException as exc:
                error = exc
                log.warning("ABC fetch %s failed (attempt %d/%d): %s", url, attempt, ABC_ATTEMPTS, exc)
            finally:
                self.last = time.monotonic()
        raise AbcFetchFailed(f"{url} failed {ABC_ATTEMPTS} times: {error}")


# Party codes the ABC uses that differ from the site's
ABC_CODES = {"sall": "SAL", "ffp": "FF", "ldp": "LBT", "twp": "WEST"}


def _abc_party(label: str) -> str | None:
    label = clean_text(label).lower()
    if label in ABC_CODES:
        return ABC_CODES[label]
    if label in WIKI_PARTIES:  # abbreviations such as "AJP", "LBT", "FF"
        return WIKI_PARTIES[label]
    return next((code for word, code in ABC_PARTIES if word in label), None)


def abc_district_codes(page: str, district_ids: set[str]) -> dict[str, str]:
    """district id -> ABC code, from the electorates index. The table is
    embedded as an escaped HTML string, so unescape it before matching."""
    text = (page.replace("\\u003c", "<").replace("\\u003e", ">")
                .replace("\\u0026", "&").replace('\\"', '"').replace("\\/", "/"))
    codes = {}
    for code, name in re.findall(r'<a href="/news/elections/vic/2026/guide/([a-z0-9]+)/?">([^<]+)</a>', text):
        did = re.sub(r"[^a-z0-9]+", "-", htmllib.unescape(name).lower()).strip("-")
        if did in district_ids:
            codes[did] = code
    return codes


def parse_abc_district(page: str) -> dict:
    doc = lxml.html.fromstring(page)
    out = {"candidates": []}

    pill = doc.xpath("//*[contains(concat(' ', @class, ' '), ' eg2-margin-pill ')]")
    m = re.match(r"(.+?)\s+([\d.]+)%", clean_text(pill[0].text_content())) if pill else None
    if m:
        out["classification"] = m.group(1)
        out["margin_pct"] = float(m.group(2))
        out["margin_party"] = _abc_party(m.group(1).split()[-1])

    held = doc.xpath("//*[contains(concat(' ', @class, ' '), ' eg2-snap-held ')]"
                     "//*[contains(concat(' ', @class, ' '), ' eg2-snap-text ')]")
    if held:
        strong = held[0].xpath(".//strong")
        if strong:
            out["sitting_mp"] = clean_text(strong[0].text_content())
        out["retiring"] = "retiring" in held[0].text_content().lower()

    # Candidate cards: name plus the "Website" link (the party's candidate page or their own site).
    websites = {}
    for card in doc.xpath("//*[contains(concat(' ', @class, ' '), ' eg2-card-header ')]"):
        name = card.xpath(".//*[contains(concat(' ', @class, ' '), ' eg2-card-name ')]")
        link = card.xpath(".//a[contains(concat(' ', @class, ' '), ' eg2-card-link ')]/@href")
        if name and link and link[0].startswith("http"):
            websites[_name_key(clean_text(name[0].text_content()))] = link[0]

    for tr in doc.xpath("//table[contains(@class, 'eg2-ballot')]//tbody/tr"):
        cells = [clean_text(td.text_content()) for td in tr.findall("td")]
        if len(cells) >= 2 and cells[0]:
            entry = {"name": cells[0], "party_label": cells[1]}
            if _name_key(cells[0]) in websites:
                entry["website"] = websites[_name_key(cells[0])]
            out["candidates"].append(entry)
    return out


def abc_retiring_names(page: str) -> set[str]:
    """Names on the retiring MPs page: the h2s inside each retiring group."""
    doc = lxml.html.fromstring(page)
    names = set()
    for group in doc.xpath("//*[contains(concat(' ', @class, ' '), ' eg-retiring-group ')]"):
        for h2 in group.iter("h2"):
            text = clean_text(h2.text_content())
            if text and not re.search(r"\(\d+\)$", text):  # skip "Labor (11)" group headings
                names.add(text)
    return names


def parse_abc_az(page: str) -> list[dict]:
    """Rows of the A-Z candidate tables: name, party code, electorate and
    the electorate's guide code (from its link)."""
    doc = lxml.html.fromstring(page)
    entries = []
    for tr in doc.xpath("//table[contains(@class, 'eg-table')]//tr[td]"):
        tds = tr.findall("td")
        if len(tds) < 3:
            continue
        for tag in tds[0].xpath(".//span[not(contains(@class, 'familyname'))]"):
            tag.drop_tree()   # "Sitting MP" and similar badges
        link = tds[2].find(".//a")
        code = re.search(r"/guide/([a-z0-9]+)/?$", link.get("href", "")) if link is not None else None
        name = clean_text(tds[0].text_content())
        if name:
            entries.append({"name": name, "party_label": clean_text(tds[1].text_content()),
                            "electorate": clean_text(tds[2].text_content()),
                            "code": code.group(1) if code else None})
    return entries


def fetch_abc(district_ids: set[str]) -> tuple[dict[str, dict], set[str], list[dict]]:
    """Return ({district id: parsed page + code + url}, retiring names, A-Z entries).
    Raises AbcFetchFailed if any page fails ABC_ATTEMPTS times."""
    web = PoliteSession()
    codes = abc_district_codes(web.get(ABC_ELECTORATES_URL), district_ids)
    if not codes:
        raise ValueError("no district links found on the ABC electorates page")
    if len(codes) < len(district_ids):
        missing = sorted(district_ids - set(codes))
        log.warning("ABC electorates page links %d of %d districts; missing %s", len(codes), len(district_ids), missing)
    retiring = abc_retiring_names(web.get(ABC_RETIRING_URL))

    pages = {}
    for did, code in sorted(codes.items()):
        url = f"{ABC_GUIDE}{code}"
        parsed = parse_abc_district(web.get(url))
        if not parsed["candidates"] and "classification" not in parsed:
            log.warning("ABC page for %s (%s) had nothing to parse; skipped", did, url)
            continue
        pages[did] = {**parsed, "code": code, "url": url}
    log.info("Parsed %d ABC district pages; %d MPs on the retiring list", len(pages), len(retiring))
    az = parse_abc_az(web.get(ABC_AZ_URL))   # fetched last: reconciled after the district pages
    log.info("Parsed %d names from the ABC A-Z candidate list", len(az))
    return pages, retiring, az


def _find_in_seat(seat_rows: list[dict], name: str, party: str) -> dict | None:
    """The row for this person in a seat: same name, or a near-identical
    spelling for the same party."""
    key = _name_key(name)
    similar = _near_identical if party in MULTI_PER_SEAT else _same_person
    return (next((c for c in seat_rows if _name_key(c["name"]) == key), None)
            or next((c for c in seat_rows if c.get("party") == party and similar(c["name"], name)), None))


def _apply_abc_entry(entry: dict, did: str, url: str, seat_rows: list[dict], rows: list[dict],
                     sitting: dict[str, str], today: str, stats: dict) -> dict:
    """Add or confirm one ABC-listed candidate; return its row."""
    known_party = _abc_party(entry["party_label"])
    party = known_party or "OTH"
    key = _name_key(entry["name"])
    match = _find_in_seat(seat_rows, entry["name"], party)
    if match is not None and known_party is None:
        party = match.get("party") or "OTH"   # never replace a known party with OTH
    if match is None:
        match = {"district": did, "name": entry["name"], "party": party, "status": "endorsed",
                 "ballot_position": None, "incumbent": sitting.get(did) == key, "date_added": today}
        rows.append(match)
        seat_rows.append(match)
        stats["added"] += 1
    else:
        stats["confirmed"] += 1
        # Take the ABC spelling only for real variants, not accents or punctuation.
        if _name_key(match["name"]) != key:
            log.info("%s: name %r -> %r (ABC spelling)", did, match["name"], entry["name"])
            match["name"] = entry["name"]
        if match.get("party") != party:
            log.warning("%s: %s party %s -> %s (ABC)", did, entry["name"], match.get("party"), party)
            match["party"] = party
        if match.get("status") not in FINAL_STATUSES:
            match["status"] = "endorsed"
        # Conflict/supersede notes from earlier merges are settled by the ABC listing.
        notes = [n for n in (match.get("notes") or "").split("; ")
                 if n and not n.startswith(("Conflicts with", "Superseded by"))]
        if notes:
            match["notes"] = "; ".join(notes)
        else:
            match.pop("notes", None)
        match.pop("superseded_by", None)
        match.pop("superseded_on", None)
    match.update(source="abc", source_url=url, updated=today)
    if entry.get("website"):
        match["website"] = entry["website"]
    if known_party is None and party == "OTH" and entry["party_label"]:
        match["notes"] = f"Party on ABC: {entry['party_label']}"
    return match


def _supersede(did: str, seat_rows: list[dict], abc_rows: list[dict], today: str, stats: dict) -> None:
    """Supersede rule: the ABC entry for a party in a seat supersedes any
    other (older) entry for that party there. Rows are kept, not deleted."""
    abc_ids = {id(c) for c in abc_rows}

    def mark(old: dict, winners: str) -> None:
        log.warning("%s: %s (%s, %s) superseded by ABC entry %s", did, old["name"], old.get("party"), old.get("status"), winners)
        old["status"] = "superseded"
        old["superseded_by"] = winners
        old["superseded_on"] = today
        old["notes"] = "; ".join(filter(None, [old.get("notes"), f"Superseded by {winners} (ABC guide, {today})"]))
        old["updated"] = today
        stats["superseded"] += 1

    def replaceable(old: dict, party: str) -> bool:
        return (id(old) not in abc_ids and old.get("party") == party
                and old.get("status") not in FINAL_STATUSES | {"superseded", "withdrawn"})

    for party in {c["party"] for c in abc_rows}:
        if party in MULTI_PER_SEAT:
            # Several independents can stand in one seat, so only a
            # differently spelt copy of the same person is superseded.
            for new in (c for c in abc_rows if c["party"] == party):
                for old in seat_rows:
                    if replaceable(old, party) and _near_identical(old["name"], new["name"]):
                        mark(old, new["name"])
            continue
        winners = " / ".join(c["name"] for c in abc_rows if c["party"] == party)
        for old in seat_rows:
            if replaceable(old, party):
                mark(old, winners)


def _active(c: dict) -> bool:
    return c.get("status") not in ("superseded", "withdrawn")


def reconcile_abc_az(az_entries: list[dict], districts: list[dict], rows: list[dict],
                     by_seat: dict[str, list[dict]], sitting: dict[str, str], today: str, stats: dict) -> dict:
    """Add any A-Z name missing from candidates.json (same rules as the
    district pages) and return a summary for meta.json."""
    code_to_id = {d.get("abc_code"): d["id"] for d in districts if d.get("abc_code")}
    ids = {d["id"] for d in districts}
    only_on_abc, unmatched = 0, []
    on_abc = set()   # ids of tracker rows that appear on the A-Z list
    added_by_seat = {}
    for entry in az_entries:
        did = code_to_id.get(entry["code"]) or re.sub(r"[^a-z0-9]+", "-", entry["electorate"].lower()).strip("-")
        if did not in ids:
            unmatched.append(f"{entry['name']} ({entry['electorate']})")
            continue
        seat_rows = by_seat.setdefault(did, [])
        party = _abc_party(entry["party_label"]) or "OTH"
        row = _find_in_seat(seat_rows, entry["name"], party)
        if row is None:
            only_on_abc += 1
            log.warning("%s: %s (%s) is on the ABC A-Z list but not in the tracker; added",
                        did, entry["name"], entry["party_label"])
            row = _apply_abc_entry(entry, did, ABC_GUIDE + (entry["code"] or ""), seat_rows, rows, sitting, today, stats)
            added_by_seat.setdefault(did, []).append(row)
        on_abc.add(id(row))
    for did, new_rows in added_by_seat.items():
        _supersede(did, by_seat[did], new_rows, today, stats)
    if unmatched:
        log.warning("ABC A-Z entries with an unknown electorate: %s", unmatched)

    lower = [c for c in rows if c.get("district") and _active(c)]
    only_in_tracker = [c for c in lower if id(c) not in on_abc]
    by_source = {}
    for c in lower:
        by_source[c.get("source", "report")] = by_source.get(c.get("source", "report"), 0) + 1
    summary = {
        "date": today,
        "scope": "Legislative Assembly",
        "abc_list_url": ABC_AZ_URL,
        "totals": {"tracker": len(lower), "abc_list": len(az_entries)},
        "tracker_by_source": dict(sorted(by_source.items())),
        "only_in_tracker": len(only_in_tracker),
        "only_on_abc": only_on_abc,
        "unmatched_electorates": len(unmatched),
        "tracked_all": sum(1 for c in rows if _active(c)),
    }
    log.info("Reconciliation: tracker %d, ABC list %d, only in tracker %d, only on ABC %d (added)",
             len(lower), len(az_entries), len(only_in_tracker), only_on_abc)
    return summary


def refresh_abc(data_dir: Path, meta: dict) -> bool:
    source = meta.setdefault("sources", {}).setdefault("abc_guide", {"url": ABC_ELECTORATES_URL})
    cand_path, dist_path, reg_path = (data_dir / f"{n}.json" for n in ("candidates", "districts", "regions"))
    try:
        dist_doc = read_json(dist_path, {}) or {}
        districts = dist_doc.get("districts", [])
        if not districts:
            raise ValueError("districts.json has no districts to match against")
        pages, retiring_names, az_entries = fetch_abc({d["id"] for d in districts})
        if not pages:
            raise ValueError("no ABC district pages could be parsed")
    except Exception as exc:  # noqa: BLE001 - any failure means skip the ABC step entirely
        log.error("ABC guide fetch skipped, keeping existing files: %s", exc)
        warn_ci(f"ABC guide fetch skipped, kept existing data: {exc}")
        source.update(status="error", message=str(exc)[:300])
        return False

    today = datetime.now(MELBOURNE).date().isoformat()
    retiring_keys = {_name_key(n) for n in retiring_names}
    cand_doc = read_json(cand_path, {}) or {}
    rows = cand_doc.get("candidates", [])
    stats = {"added": 0, "confirmed": 0, "superseded": 0, "district_changes": 0}

    # ---- districts: ABC code/link, classification, margin, sitting member, retiring
    for d in districts:
        page = pages.get(d["id"])
        if not page:
            continue
        before = json.dumps(d, sort_keys=True)
        d["abc_code"], d["abc_url"] = page["code"], page["url"]
        if "classification" in page:
            d["classification"] = page["classification"]
            margin = d.setdefault("margin", {})
            new_party = page["margin_party"] or margin.get("party")
            if (margin.get("party"), margin.get("pct")) != (new_party, page["margin_pct"]):
                log.info("%s: margin %s %s -> %s %s (ABC)", d["id"], margin.get("party"), margin.get("pct"),
                         new_party, page["margin_pct"])
            margin.update(party=new_party, pct=page["margin_pct"])
        if page.get("sitting_mp") and _name_key(page["sitting_mp"]) != _name_key(d.get("sitting_mp", "")):
            log.warning("%s: sitting member %r -> %r (ABC)", d["id"], d.get("sitting_mp"), page["sitting_mp"])
            d["sitting_mp"] = page["sitting_mp"]
        retiring = bool(page.get("retiring")) or _name_key(d.get("sitting_mp", "")) in retiring_keys
        if retiring != d.get("retiring"):
            log.info("%s: retiring %s -> %s (ABC)", d["id"], d.get("retiring"), retiring)
            d["retiring"] = retiring
        if json.dumps(d, sort_keys=True) != before:
            stats["district_changes"] += 1

    # ---- candidates: ABC is primary for the lower house
    by_seat = {}
    for c in rows:
        if c.get("district"):
            by_seat.setdefault(c["district"], []).append(c)
    sitting = {d["id"]: _name_key(d.get("sitting_mp", "")) for d in districts}

    for did, page in sorted(pages.items()):
        seat_rows = by_seat.setdefault(did, [])
        abc_rows = [_apply_abc_entry(entry, did, page["url"], seat_rows, rows, sitting, today, stats)
                    for entry in page["candidates"]]
        _supersede(did, seat_rows, abc_rows, today, stats)

    # ---- reconciliation against the A-Z list of every ABC candidate
    if az_entries:
        meta["reconciliation"] = reconcile_abc_az(az_entries, districts, rows, by_seat, sitting, today, stats)
    else:
        log.error("ABC A-Z candidate list had no rows; reconciliation skipped")
        warn_ci("ABC A-Z candidate list had no rows; reconciliation skipped")

    # ---- MLC retiring flags (only ever set to true: the page lists retirees)
    reg_doc = read_json(reg_path, {}) or {}
    reg_changed = False
    for r in reg_doc.get("regions", []):
        for mlc in r.get("mlcs", []):
            if _name_key(mlc["name"]) in retiring_keys and not mlc.get("retiring"):
                log.info("%s: MLC %s now retiring (ABC)", r["id"], mlc["name"])
                mlc["retiring"] = True
                reg_changed = True

    write_json(dist_path, dist_doc)
    write_json(cand_path, {**cand_doc, "candidates": _sort_candidates(rows)})
    if reg_changed:
        write_json(reg_path, reg_doc)
    source.update(status="ok", url=ABC_ELECTORATES_URL, last_success=now_iso(),
                  message=(f"{len(pages)} district pages, {stats['district_changes']} districts updated; "
                           f"{stats['added']} candidates added, "
                           f"{stats['confirmed']} confirmed, {stats['superseded']} superseded"))
    log.info("ABC guide: %s", source["message"])
    return True


# --------------------------------------------------------------------------
# Betting: Sportsbet Victorian election seat markets -> seat_odds.json
# --------------------------------------------------------------------------
# Best effort only. Sportsbet refuses the TLS handshake from non-browser
# clients (seen from a desktop and expected from GitHub's US runners), so
# the usual outcome is "blocked": seat_odds.json is then treated as a
# manual file and its last values are kept. The parser below is generic
# (it looks for embedded JSON markets named after districts) and has not
# been tested against a live Sportsbet response.

SPORTSBET_URL = "https://www.sportsbet.com.au/betting/politics/australian-politics/victorian-state-election"
SPORTSBET_ROBOTS = "https://www.sportsbet.com.au/robots.txt"


def _sportsbet_allowed(session: requests.Session) -> bool:
    resp = session.get(SPORTSBET_ROBOTS, timeout=TIMEOUT)
    resp.raise_for_status()
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(resp.text.splitlines())
    return rp.can_fetch(USER_AGENT, SPORTSBET_URL)


def parse_sportsbet_markets(page: str, districts: dict[str, str]) -> dict[str, dict]:
    """district id -> {favourite, price}. Walks JSON embedded in <script>
    tags for objects named after a district that carry priced outcomes."""
    found = {}

    def price_of(o):
        for k in ("price", "winPrice", "decimal", "odds"):
            v = o.get(k)
            if isinstance(v, dict):
                v = v.get("winPrice") or v.get("decimal")
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
        return None

    def walk(o):
        if isinstance(o, dict):
            name = str(o.get("name") or o.get("eventName") or "")
            did = districts.get(re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"))
            outcomes = o.get("outcomes") or o.get("selections") or o.get("runners")
            if did and isinstance(outcomes, list):
                priced = [(price_of(x), x.get("name")) for x in outcomes if isinstance(x, dict)]
                priced = [(p, n) for p, n in priced if p and n]
                if priced:
                    p, n = min(priced)
                    found[did] = {"favourite": n, "price": p}
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    for script in lxml.html.fromstring(page).iter("script"):
        text = (script.text or "").strip()
        start = text.find("{")
        if start < 0:
            continue
        try:
            walk(json.loads(text[start:text.rfind("}") + 1]))
        except ValueError:
            continue
    return found


def refresh_seat_odds(data_dir: Path, meta: dict) -> bool:
    source = meta.setdefault("sources", {}).setdefault("sportsbet", {"url": SPORTSBET_URL})
    path = data_dir / "seat_odds.json"
    doc = read_json(path, None)
    districts = (read_json(data_dir / "districts.json", {}) or {}).get("districts", [])
    if doc is None or not districts:
        log.info("seat_odds.json or districts.json missing; Sportsbet step skipped")
        return False
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    try:
        if not _sportsbet_allowed(session):
            raise PermissionError("robots.txt disallows the seat markets page")
        resp = session.get(SPORTSBET_URL, timeout=TIMEOUT)
        resp.raise_for_status()
        odds = parse_sportsbet_markets(resp.text, {d["id"]: d["id"] for d in districts})
        if not odds:
            raise ValueError("page fetched but no seat markets recognised")
    except Exception as exc:  # noqa: BLE001 - blocked or unrecognised: keep the manual values
        log.info("Sportsbet unavailable (%s); seat_odds.json kept as manual", str(exc)[:200])
        if doc.get("mode") != "manual":
            doc["mode"] = "manual"
            write_json(path, doc)
        source.update(status="manual", message=f"Blocked or unrecognised ({type(exc).__name__}); manual values kept.")
        return False

    today = datetime.now(MELBOURNE).date().isoformat()
    for seat in doc.get("seats", []):
        if seat["district"] in odds:
            seat.update(odds[seat["district"]])
    doc.update(mode="auto", date_checked=today)
    write_json(path, doc)
    source.update(status="ok", url=SPORTSBET_URL, last_success=now_iso(), message=f"{len(odds)} seat markets")
    log.info("Wrote %s (%d seat markets)", path.name, len(odds))
    return True


# ==========================================================================
# PLACEHOLDER: VEC candidate list
# --------------------------------------------------------------------------
# The Victorian Electoral Commission publishes the list of nominated
# candidates (with ballot-paper order) after nominations close and the
# ballot draw is held. Its format for 2026 isn't known yet, so this
# function is a stub.
#
# To implement: fetch the VEC list, then return a list of dicts in the
# candidates.json shape, e.g.
#     {"district": "bendigo-east", "name": "...", "party": "ALP",
#      "status": "vec_nominated", "ballot_position": 1, "incumbent": False,
#      "source_url": "<VEC page>", "updated": "2026-11-13"}
# District ids must match districts.json (lower-case, hyphenated).
#
# While it returns None, candidates.json is left untouched.
# ==========================================================================
def fetch_vec_candidates() -> list[dict] | None:
    return None


def refresh_candidates(data_dir: Path, meta: dict) -> bool:
    source = meta.setdefault("sources", {}).setdefault("vec_candidates", {})
    path = data_dir / "candidates.json"
    try:
        vec_rows = fetch_vec_candidates()
    except Exception as exc:  # noqa: BLE001
        log.error("VEC candidate fetch failed, keeping existing %s: %s", path.name, exc)
        warn_ci(f"VEC candidate fetch failed, kept existing candidates.json: {exc}")
        source.update(status="error", message=str(exc)[:300])
        return False
    if vec_rows is None:
        log.info("VEC candidate import is a placeholder; %s left unchanged", path.name)
        source.update(status="placeholder", message="VEC candidate import not implemented yet.")
        return False

    # Upsert VEC rows over the hand-maintained list (announced/endorsed rows stay).
    existing = read_json(path, {}) or {}
    rows = {_candidate_key(c): c for c in existing.get("candidates", [])}
    for c in vec_rows:
        rows[_candidate_key(c)] = {**rows.get(_candidate_key(c), {}), **c}
    write_json(path, {**existing, "candidates": _sort_candidates(list(rows.values()))})
    source.update(status="ok", last_success=now_iso(), message=f"{len(vec_rows)} VEC-nominated candidates")
    log.info("Wrote %s (%d VEC rows merged)", path.name, len(vec_rows))
    return True


# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# How-to-vote cards: VEC register (opens 9 am Tue 10 Nov 2026)
# --------------------------------------------------------------------------
# The VEC lists registered cards per district/region (heading "<Name> District"
# or "<Name> Region", then a table of registration number, registered by, date,
# and a link to the card PDF). The fetch records each card; the preference
# order printed on the card is entered by hand into "order" and is kept.

VEC_HTV_URL = "https://www.vec.vic.gov.au/candidates-and-parties/become-a-state-election-candidate/how-to-vote-cards"
HTV_OPENS = "2026-11-10"
HTV_SCHEMA = {
    "description": "How-to-vote cards registered with the VEC for the 2026 election. scripts/refresh.py checks the VEC's "
                   "register daily and records each card; the preference order on each card is entered by hand from the "
                   "card PDF and is never overwritten.",
    "fields": {
        "status": "not_open (before registration opens) | open (register live, cards listed) | open_no_cards",
        "registration_opens": "YYYY-MM-DD registration opens (9 am)",
        "source_url": "The VEC how-to-vote card page",
        "last_checked": "ISO UTC time of the last successful check",
        "cards": "[{house: lower|upper, district or region (id), registered_by (as listed by the VEC), party (code or null), "
                 "candidate (independents: name as listed), registration (VEC number), registered_on (YYYY-MM-DD), card_url, "
                 "order (party codes or candidate names in the card's preference order, first to last; null until entered), notes}]",
    },
}


def _vec_party(label: str) -> str | None:
    if re.match(r"^[A-Z'\- ]+,\s", label):   # "SURNAME, Given": an individual
        return None
    return _abc_party(label) or _party_code(label)


def parse_vec_htv(page: str, districts: dict[str, str], regions: dict[str, str]) -> list[dict]:
    """Cards from a VEC register page; empty if it has no district/region tables."""
    doc = lxml.html.fromstring(page)
    cards = []
    for h in doc.xpath("//h2|//h3"):
        title = clean_text(h.text_content())
        m = re.match(r"(.+?)\s+(District|Region)$", title)
        if not m:
            continue
        house, names = ("lower", districts) if m.group(2) == "District" else ("upper", regions)
        seat = names.get(m.group(1).lower())
        table = h.xpath("following::table[1]")
        if not seat or not table:
            continue
        for tr in table[0].xpath(".//tr[td]"):
            cells = [clean_text(td.text_content()) for td in tr.xpath("./td")]
            link = tr.xpath(".//a/@href")
            if len(cells) < 3 or not cells[1]:
                continue
            when = parse_date_range(cells[2], date.today().year)
            party = _vec_party(cells[1])
            cards.append({
                "house": house, ("district" if house == "lower" else "region"): seat,
                "registered_by": cells[1], "party": party,
                "candidate": cells[1] if party is None and "," in cells[1] else None,
                "registration": cells[0], "registered_on": when[1].isoformat() if when else None,
                "card_url": link[0] if link else None, "order": None,
            })
    return cards


def refresh_htv(data_dir: Path, meta: dict) -> bool:
    source = meta.setdefault("sources", {}).setdefault("htv", {"url": VEC_HTV_URL})
    path = data_dir / "htv.json"
    existing = read_json(path, {}) or {}
    data = {"_schema": HTV_SCHEMA, "status": existing.get("status", "not_open"), "registration_opens": HTV_OPENS,
            "source_url": VEC_HTV_URL, "last_checked": existing.get("last_checked"), "cards": existing.get("cards", [])}
    districts = {d["name"].lower(): d["id"] for d in (read_json(data_dir / "districts.json", {}) or {}).get("districts", [])}
    regions = {r["name"].lower(): r["id"] for r in (read_json(data_dir / "regions.json", {}) or {}).get("regions", [])}
    today = datetime.now(MELBOURNE).date().isoformat()
    try:
        web = PoliteSession()
        robots = urllib.robotparser.RobotFileParser()
        robots.parse(web.get("https://www.vec.vic.gov.au/robots.txt").splitlines())
        if not robots.can_fetch(ABC_USER_AGENT, VEC_HTV_URL):
            raise ValueError("robots.txt disallows the VEC how-to-vote page")
        page = web.get(VEC_HTV_URL)
        cards = parse_vec_htv(page, districts, regions)
        if not cards:
            # The 2026 register may be its own page, linked from this one (earlier events are "archive" pages).
            doc = lxml.html.fromstring(page)
            for a in doc.xpath("//a[@href]"):
                href, text = a.get("href"), clean_text(a.text_content())
                if "2026" in text and "by-election" not in text.lower() and "how-to-vote" in href and "archive" not in href:
                    cards = parse_vec_htv(web.get(requests.compat.urljoin(VEC_HTV_URL, href)), districts, regions)
                    if cards:
                        break
    except Exception as exc:  # noqa: BLE001 - keep the existing file
        log.error("VEC how-to-vote check failed, keeping %s: %s", path.name, exc)
        warn_ci(f"VEC how-to-vote check failed: {exc}")
        source.update(status="error", message=str(exc)[:300])
        if not path.exists():
            write_json(path, data)
        return False

    # Keep hand-entered orders and notes for cards already recorded.
    def key(c):
        return (c.get("district") or c.get("region"), c.get("registration"), c.get("registered_by"))
    old = {key(c): c for c in data["cards"]}
    merged = []
    for c in cards:
        prev = old.pop(key(c), {})
        merged.append({**c, "order": prev.get("order"), **({"notes": prev["notes"]} if prev.get("notes") else {})})
    merged.extend(old.values())   # never drop a card once recorded
    data["cards"] = sorted(merged, key=lambda c: (c["house"], c.get("district") or c.get("region") or "", c.get("registered_by") or ""))
    data["status"] = "open" if data["cards"] else ("not_open" if today < HTV_OPENS else "open_no_cards")
    source.update(status="ok", url=VEC_HTV_URL, last_success=now_iso(),
                  message=f"{len(data['cards'])} cards registered" if data["cards"] else f"No cards yet (status {data['status']})")
    strip = lambda d: json.dumps({k: v for k, v in d.items() if k != "last_checked"}, sort_keys=True)
    changed = strip(data) != strip(existing)
    if changed or not path.exists():
        data["last_checked"] = now_iso()
        write_json(path, data)
        log.info("Wrote %s (%s, %d cards)", path.name, data["status"], len(data["cards"]))
    else:
        log.info("%s unchanged (%s, %d cards)", path.name, data["status"], len(data["cards"]))
    return changed


# --------------------------------------------------------------------------
# News: headlines, outlet, date and link only (never article text)
# --------------------------------------------------------------------------
# Per seat: a Bing News RSS search for the district or the sitting MP with
# "Victorian election" (Google News RSS is disallowed by its robots.txt),
# plus regional papers' and the ABC's feeds, matched to seats by district
# or MP name. One request per second; any source that fails is skipped and
# the seat keeps its earlier list.

NEWS_PER_SEAT = 10
NEWS_STATEWIDE = 25
NEWS_MAX_AGE_DAYS = 120
BING_NEWS = "https://www.bing.com/news/search"
NEWS_FEEDS = [
    # (outlet, feed URL, the ABC's general feed: filtered to state-election stories for the statewide list)
    ("ABC News", "https://www.abc.net.au/news/feed/51120/rss.xml", True),
    ("Bendigo Advertiser", "https://www.bendigoadvertiser.com.au/rss.xml", False),
    ("Border Mail", "https://www.bordermail.com.au/rss.xml", False),
    ("Warrnambool Standard", "https://www.standard.net.au/rss.xml", False),
    ("Latrobe Valley Express", "https://www.latrobevalleyexpress.com.au/feed/", False),
    ("Sunraysia Daily", "https://www.sunraysiadaily.com.au/feed", False),
    ("Star Weekly", "https://www.starweekly.com.au/feed/", False),
    ("Shepparton News", "https://www.sheppnews.com.au/feed/", False),
    ("Geelong Advertiser", "https://www.geelongadvertiser.com.au/feed", False),   # robots.txt prohibits: always skipped
]
NEWS_SCHEMA = {
    "description": "Election news per district and statewide, refreshed daily by scripts/refresh.py from Bing News RSS searches "
                   "and publishers' RSS feeds. Headline, outlet, date and link only; article text is never stored.",
    "fields": {
        "updated": "ISO UTC time of the last refresh",
        "statewide": f"Up to {NEWS_STATEWIDE} latest items about the state election: [{{title, outlet, published (ISO UTC), url}}]",
        "seats": f"District id -> up to {NEWS_PER_SEAT} latest items mentioning the district or its sitting MP",
        "sources": "Source -> {status: ok | error | skipped, url, items, message}",
    },
}
ELECTION_WORDS = re.compile(r"\b(election|by-election|candidates?|preselect\w*|ballot|preferences|polling|MP|"
                            r"Premier|Liberals?|Labor|Greens|Nationals|One Nation)\b")
VICTORIA = re.compile(r"\b(Victoria|Victorian|Melbourne|Spring Street|VEC)\b")
STATE_ELECTION = re.compile(r"(state election|Victorian election|Victorian (poll|campaign|voters)|"
                            r"Ben Carroll|Jess Wilson|Warren Pickering|Spring Street)", re.I)


def _news_title_key(title: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", unicodedata.normalize("NFKD", title).lower()).strip()


def _dedupe_news(items: list[dict]) -> list[dict]:
    """Newest first; drop repeats by URL or near-identical headline."""
    out = []
    for it in sorted(items, key=lambda x: x.get("published") or "", reverse=True):
        if any(it["url"] == o["url"] or difflib.SequenceMatcher(None, _news_title_key(it["title"]), _news_title_key(o["title"])).ratio() > 0.9
               for o in out):
            continue
        out.append(it)
    return out


def _parse_rss(xml: bytes, outlet: str | None) -> list[dict]:
    """[{title, outlet, published, url, _text}]; _text (headline + summary) is for matching only and is never stored."""
    from lxml import etree
    root = etree.fromstring(xml, parser=etree.XMLParser(recover=True, resolve_entities=False, no_network=True))
    if root is None:
        return []
    out = []
    for item in root.iter("item"):
        def get(tag):
            return (item.findtext(tag) or "").strip()
        title, link = htmllib.unescape(clean_text(get("title"))), get("link")
        if not title or not link:
            continue
        src = next((el.text for el in item if isinstance(el.tag, str) and el.tag.lower().endswith("source") and el.text), None)
        if "bing.com/news/apiclick" in link:   # unwrap Bing's redirect to the publisher's URL
            m = re.search(r"[?&]url=([^&]+)", link)
            link = requests.utils.unquote(m.group(1)) if m else link
        try:
            published = email.utils.parsedate_to_datetime(get("pubDate"))   # RFC 822: "+1100" or "GMT"
        except (TypeError, ValueError):
            continue
        published = (published if published.tzinfo else published.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
        summary = re.sub(r"<[^>]+>", " ", htmllib.unescape(get("description")))
        out.append({"title": title, "outlet": clean_text(src or outlet or ""),
                    "published": published.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                    "url": link, "_text": f"{title} {summary}"})
    return out


def refresh_news(data_dir: Path, meta: dict) -> bool:
    path = data_dir / "news.json"
    existing = read_json(path, {}) or {}
    seats_old = existing.get("seats", {})
    districts = (read_json(data_dir / "districts.json", {}) or {}).get("districts", [])
    if not districts:
        log.error("news: districts.json missing; skipped")
        return False
    web = PoliteSession()
    web.session.headers["Accept"] = "application/rss+xml, application/xml;q=0.9, */*;q=0.5"
    status, robots_cache = {}, {}

    def allowed(url):
        host = re.match(r"https?://[^/]+", url).group(0)
        if host not in robots_cache:
            rp = urllib.robotparser.RobotFileParser()
            try:
                rp.parse(fetch(host + "/robots.txt").decode("utf-8", "replace").splitlines())
            except Exception:  # noqa: BLE001 - no readable robots.txt: don't fetch
                rp = None
            robots_cache[host] = rp
        rp = robots_cache[host]
        return bool(rp) and rp.can_fetch(ABC_USER_AGENT, url)

    def fetch(url):
        """One try, at most one request per ABC_DELAY seconds."""
        wait = web.last + ABC_DELAY - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        try:
            resp = web.session.get(url, timeout=TIMEOUT)
            resp.raise_for_status()
            return resp.content
        finally:
            web.last = time.monotonic()

    cutoff = (datetime.now(timezone.utc) - pd.Timedelta(days=NEWS_MAX_AGE_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    def fresh(items):
        return [i for i in items if i["published"] >= cutoff]
    def bare(items):
        return [{k: v for k, v in i.items() if k != "_text"} for i in items]

    # Publisher feeds, fetched once each.
    feed_items, statewide = [], []
    for outlet, url, is_abc in NEWS_FEEDS:
        if not allowed(url):
            status[outlet] = {"status": "skipped", "url": url, "message": "robots.txt disallows automated access"}
            continue
        try:
            items = fresh(_parse_rss(fetch(url), outlet))
            if not items:
                raise ValueError("feed returned no recent items")
            status[outlet] = {"status": "ok", "url": url, "items": len(items)}
            feed_items.extend(items)
            if is_abc:
                statewide.extend(i for i in items if STATE_ELECTION.search(i["_text"]))
            else:
                statewide.extend(i for i in items if re.search(r"state election", i["_text"], re.I))
        except Exception as exc:  # noqa: BLE001 - skip this feed
            log.warning("news: %s feed failed: %s", outlet, exc)
            status[outlet] = {"status": "error", "url": url, "message": str(exc)[:200]}

    def bing(q):
        url = f"{BING_NEWS}?{requests.compat.urlencode({'q': q, 'format': 'rss', 'cc': 'AU', 'setlang': 'en-AU'})}"
        # Video pages (ABC iview) carry the page's date, not the story's.
        return [i for i in fresh(_parse_rss(fetch(url), None)) if "iview.abc.net.au" not in i["url"]]

    # Bing News: statewide searches, then two per district (stops after 5 failures in a row).
    bing_ok = allowed(BING_NEWS + "?q=x&format=rss")
    failures, searched, seats = 0, 0, {}
    if bing_ok:
        for q in ('"Victorian state election"', '"Victorian election" 2026'):
            try:
                statewide.extend(i for i in bing(q) if STATE_ELECTION.search(i["_text"]))
            except Exception as exc:  # noqa: BLE001
                log.warning("news: Bing statewide search failed: %s", exc)
    for d in districts:
        name, mp = d["name"], d.get("sitting_mp") or ""
        name_re = re.compile(rf"\b{re.escape(name)}\b", re.I)
        mp_re = re.compile(rf"\b{re.escape(mp)}\b", re.I) if mp else None
        # Feed items: the MP's full name, or the district name in an election story.
        found = [it for it in feed_items
                 if (mp_re and mp_re.search(it["_text"])) or (name_re.search(it["_text"]) and ELECTION_WORDS.search(it["_text"]))]
        searched_ok = False
        # Two searches: the district with "Victorian election" (the result must name the district in a Victorian
        # election story: "Richmond" or "Melbourne" alone match far too much), and the sitting MP by name.
        district_hit = lambda t: name_re.search(t) and VICTORIA.search(t) and ELECTION_WORDS.search(t)
        if name == "Melbourne":   # the seat shares its name with the city
            district_hit = lambda t: re.search(r"\b(seat|electorate|district|member) (of|for) Melbourne\b", t, re.I)
        queries = [(f'"{name}" Victorian election', district_hit)] + ([(f'"{mp}" MP Victoria', mp_re.search)] if mp else [])
        for q, keep in queries:
            if not bing_ok or failures >= 5:
                break
            try:
                found.extend(i for i in bing(q) if keep(i["_text"]))
                searched += 1
                failures = 0
                searched_ok = True
            except Exception as exc:  # noqa: BLE001 - keep this seat's earlier items
                log.warning("news: Bing search %r failed: %s", q, exc)
                failures += 1
        statewide.extend(i for i in found if STATE_ELECTION.search(i["_text"]))
        merged = fresh(_dedupe_news(bare(found) + seats_old.get(d["id"], [])))
        seats[d["id"]] = merged[:NEWS_PER_SEAT] if (searched_ok or found) else seats_old.get(d["id"], [])
    status["Bing News search"] = ({"status": "ok" if searched else "error", "url": BING_NEWS, "items": searched,
                                   "message": f"{searched} searches for {len(districts)} districts"}
                                  if bing_ok else {"status": "skipped", "url": BING_NEWS, "message": "robots.txt disallows"})
    status["Google News"] = {"status": "skipped", "url": "https://news.google.com/rss",
                             "message": "robots.txt disallows /rss for all crawlers; Bing News search used instead"}

    if not any(s["status"] == "ok" for s in status.values()):
        log.error("news: every source failed; keeping %s", path.name)
        warn_ci("News: every source failed; kept existing news.json")
        return False
    data = {
        "_schema": NEWS_SCHEMA,
        "updated": now_iso(),
        "statewide": fresh(_dedupe_news(bare(statewide) + existing.get("statewide", [])))[:NEWS_STATEWIDE],
        "seats": seats,
        "sources": status,
    }
    write_json(path, data)
    total = sum(len(v) for v in seats.values())
    meta.setdefault("sources", {})["news"] = {"status": "ok", "url": BING_NEWS, "last_success": now_iso(),
                                              "message": f"{len(data['statewide'])} statewide, {total} seat items"}
    log.info("Wrote %s (%d statewide, %d seat items across %d seats)", path.name, len(data["statewide"]), total,
             sum(1 for v in seats.values() if v))
    return True


# --------------------------------------------------------------------------
# Change log: what changed in the data since the last run (changelog.json)
# --------------------------------------------------------------------------
# Each run reduces the data files to a compact "view" (candidate statuses, poll
# ids, seat prices, retirements, news links), compares it with the view saved
# by the previous run (changelog_state.json, i.e. the data as last committed),
# and appends what changed. Comparing with the saved view rather than the git
# checkout also catches hand edits (such as new Sportsbet prices) committed
# between runs. --backfill-changelog rebuilds the log from git history.

CHANGELOG_DAYS = 120
ODDS_MOVE = 0.5
CHANGELOG_BASE_COMMIT = "3b3b4e2"   # first commit with real (not sample) data
CHANGELOG_SCHEMA = {
    "description": "What changed in the tracker's data, newest first, written by scripts/refresh.py after each refresh "
                   f"by comparing the data with the previous run. Entries older than {CHANGELOG_DAYS} days are dropped.",
    "fields": {
        "updated": "ISO UTC time of the last run that changed anything",
        "entries": "[{date (Melbourne YYYY-MM-DD), at (ISO UTC), type, ...}] where type is one of: "
                   "candidate_added {seat, name, party, status, source}; candidate_superseded {seat, name, party, by}; "
                   "candidate_withdrawn {seat, name, party}; poll_added {id, pollster, end_date, tpp (L/NP), primary}; "
                   f"odds_move {{seat, label, party, from, to}} (a price moving {ODDS_MOVE} or more); "
                   "retirement {seat, name}; news {count} (new headlines collected)",
    },
}


def _poll_key(p: dict) -> str:
    return p.get("id") or f"{re.sub(r'[^a-z0-9]+', '-', p['pollster'].lower()).strip('-')}-{p['end_date']}"


def _cand_key(c: dict) -> str:
    return f"{c.get('district') or c.get('region')}|{_name_key(c['name'])}|{c.get('party')}"


def data_view(load) -> dict:
    """Compact view of the data; load(filename) returns parsed JSON or None."""
    cd, pd_, od = load("candidates.json") or {}, load("polls.json") or {}, load("seat_odds.json") or {}
    dd, rd, nd = load("districts.json") or {}, load("regions.json") or {}, load("news.json") or {}
    retiring = {d["id"]: d.get("sitting_mp") or "" for d in dd.get("districts", []) if d.get("retiring")}
    retiring.update({f"{r['id']}|{_name_key(m['name'])}": m["name"]
                     for r in rd.get("regions", []) for m in r.get("mlcs", []) if m.get("retiring")})
    urls = {i["url"] for i in nd.get("statewide", [])} | {i["url"] for v in nd.get("seats", {}).values() for i in v}
    return {
        "candidates": {_cand_key(c): c.get("status") for c in cd.get("candidates", [])},
        "polls": sorted({_poll_key(p) for p in pd_.get("polls", [])}),
        "odds": {s["district"]: {o["label"]: o["price"] for o in s.get("options", []) if o.get("price") is not None}
                 for s in od.get("seats", [])},
        "retiring": retiring,
        "news": sorted(hashlib.sha1(u.encode()).hexdigest()[:12] for u in urls),
    }


def diff_views(old: dict, new: dict, load, at: datetime) -> list[dict]:
    """Entries for what changed from view `old` to view `new` (load reads the new files, for details)."""
    stamp = {"date": at.astimezone(MELBOURNE).date().isoformat(),
             "at": at.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")}
    out = []
    rows = {_cand_key(c): c for c in (load("candidates.json") or {}).get("candidates", [])}
    inactive = ("superseded", "withdrawn")
    for key, status in new["candidates"].items():
        c, before = rows.get(key), old["candidates"].get(key)
        if not c:
            continue
        seat = c.get("district") or c.get("region")
        if before is None and status not in inactive:
            out.append({**stamp, "type": "candidate_added", "seat": seat, "name": c["name"], "party": c.get("party"),
                        "status": status, "source": c.get("source")})
        elif before is not None and before != status and status in inactive:
            out.append({**stamp, "type": f"candidate_{status}", "seat": seat, "name": c["name"], "party": c.get("party"),
                        **({"by": c["superseded_by"]} if c.get("superseded_by") else {})})
    polls = {_poll_key(p): p for p in (load("polls.json") or {}).get("polls", [])}
    for pid in sorted(set(new["polls"]) - set(old["polls"])):
        p = polls.get(pid)
        if p:
            out.append({**stamp, "type": "poll_added", "id": pid, "pollster": p["pollster"], "end_date": p["end_date"],
                        "tpp": (p.get("tpp") or {}).get("LNP"), "primary": p.get("primary")})
    seats = {s["district"]: s for s in (load("seat_odds.json") or {}).get("seats", [])}
    for did, prices in new["odds"].items():
        for label, price in prices.items():
            was = old["odds"].get(did, {}).get(label)
            if was is not None and abs(price - was) >= ODDS_MOVE - 1e-9:
                party = next((o.get("party") for o in seats.get(did, {}).get("options", []) if o["label"] == label), None)
                out.append({**stamp, "type": "odds_move", "seat": did, "label": label, "party": party, "from": was, "to": price})
    for key, name in new["retiring"].items():
        if key not in old["retiring"]:
            out.append({**stamp, "type": "retirement", "seat": key.split("|")[0], "name": name})
    fresh_news = len(set(new["news"]) - set(old["news"]))
    if fresh_news and old["news"]:
        out.append({**stamp, "type": "news", "count": fresh_news})
    return out


def _write_changelog(data_dir: Path, entries: list[dict], view: dict, now: datetime) -> None:
    cutoff = (now.astimezone(MELBOURNE).date() - pd.Timedelta(days=CHANGELOG_DAYS)).isoformat()
    entries = [e for e in entries if e["date"] >= cutoff]
    entries.sort(key=lambda e: e["at"], reverse=True)
    write_json(data_dir / "changelog.json", {"_schema": CHANGELOG_SCHEMA, "updated": now_iso(), "entries": entries})
    write_json(data_dir / "changelog_state.json", {
        "_schema": {"description": "Internal: the compact view of the data at the last refresh, which the next run compares "
                                   "against to build changelog.json. Not for display."},
        "view": view,
    })


def refresh_changelog(data_dir: Path, meta: dict) -> bool:
    def load(name):
        return read_json(data_dir / name, None)
    view = data_view(load)
    state = read_json(data_dir / "changelog_state.json", {}) or {}
    log_data = read_json(data_dir / "changelog.json", {}) or {}
    now = datetime.now(timezone.utc)
    if not state.get("view"):
        _write_changelog(data_dir, log_data.get("entries", []), view, now)
        log.info("Change log: no earlier state; recorded the current data as the baseline")
        return True
    new = diff_views(state["view"], view, load, now)
    if not new and view == state["view"]:
        log.info("Change log: nothing changed")
        return False
    _write_changelog(data_dir, new + log_data.get("entries", []), view, now)
    meta.setdefault("sources", {})["changelog"] = {"status": "ok", "last_success": now_iso(), "message": f"{len(new)} new entries"}
    log.info("Change log: %d new entries", len(new))
    return bool(new)


def backfill_changelog(data_dir: Path) -> None:
    """Rebuild changelog.json from git history: diff each commit's data with the previous one."""
    import subprocess
    root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=data_dir, text=True).strip())
    rel = data_dir.resolve().relative_to(root.resolve()).as_posix()
    commits = subprocess.check_output(["git", "log", "--reverse", "--format=%H %cI", f"{CHANGELOG_BASE_COMMIT}^..HEAD", "--", rel],
                                      cwd=root, text=True).split("\n")
    prev, entries = None, []
    for line in filter(None, commits):
        sha, when = line.split(" ", 1)
        def load(name, sha=sha):
            try:
                return json.loads(subprocess.check_output(["git", "show", f"{sha}:{rel}/{name}"], cwd=root,
                                                          stderr=subprocess.DEVNULL).decode("utf-8"))
            except (subprocess.CalledProcessError, json.JSONDecodeError):
                return None
        view = data_view(load)
        if prev is not None:
            entries = diff_views(prev, view, load, datetime.fromisoformat(when)) + entries
        prev = view
    def load_now(name):
        return read_json(data_dir / name, None)
    current = data_view(load_now)
    if prev is not None and current != prev:   # uncommitted edits in the working tree
        entries = diff_views(prev, current, load_now, datetime.now(timezone.utc)) + entries
    _write_changelog(data_dir, entries, current, datetime.now(timezone.utc))
    log.info("Change log rebuilt from %d commits: %d entries", len([c for c in commits if c]), len(entries))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR,
                        help="directory holding the JSON files (default: site/data)")
    parser.add_argument("--backfill-changelog", action="store_true",
                        help="rebuild changelog.json from git history instead of refreshing")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    data_dir = args.data_dir.resolve()
    if not data_dir.is_dir():
        log.error("Data directory not found: %s", data_dir)
        return 1

    if args.backfill_changelog:
        backfill_changelog(data_dir)
        return 0

    meta_path = data_dir / "meta.json"
    meta = read_json(meta_path, {}) or {}
    before = json.dumps(meta, sort_keys=True)

    updated = [
        refresh_polls(data_dir, meta),
        refresh_wiki_candidates(data_dir, meta),
        refresh_abc(data_dir, meta),           # after Wikipedia, so the ABC (primary) wins conflicts
        refresh_seat_odds(data_dir, meta),
        refresh_candidates(data_dir, meta),
        refresh_htv(data_dir, meta),
        refresh_news(data_dir, meta),
    ]
    refresh_changelog(data_dir, meta)   # last: compares everything written above with the previous run
    if any(updated):
        meta["last_updated"] = now_iso()

    if json.dumps(meta, sort_keys=True) != before:
        write_json(meta_path, meta)
        log.info("Updated %s", meta_path.name)
    else:
        log.info("%s unchanged", meta_path.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
