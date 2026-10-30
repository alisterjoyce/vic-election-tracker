#!/usr/bin/env python3
"""Refresh the tracker's data files in site/data.

* Polls: scraped from the Wikipedia page "Opinion polling for the 2026
  Victorian state election" with pandas.read_html, written to polls.json.
* Candidates: new names from the Wikipedia page "Candidates of the 2026
  Victorian state election" (Assembly and Council tables) are added to
  candidates.json as "announced". Existing rows are never changed.
* VEC candidates: placeholder (see fetch_vec_candidates below).
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
import io
import json
import logging
import os
import re
import sys
import tempfile
import unicodedata
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
        "start_date": "Fieldwork start, YYYY-MM-DD (may equal end_date)",
        "end_date": "Fieldwork end, YYYY-MM-DD",
        "pollster": "Polling firm / brand",
        "sample_size": "Integer respondents, or null if not published",
        "primary": "Map of party code -> primary vote %. Codes: ALP, LNP (Liberal + National), GRN, ONP, IND, OTH",
        "tpp": "Two-party-preferred %: {ALP, LNP}; omitted when the poll did not publish an ALP v L/NP figure",
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


def statewide_tables(html: str) -> list[tuple[int | None, str]]:
    """Return (year, table_html) for each table under "Voting intention" ->
    "Legislative Assembly". The page also has upper-house, sub-state and
    demographic tables with identical headers, which must not be mixed in.
    The year comes from the h4 above each table (the current year's table
    leaves the year off its dates)."""
    doc = lxml.html.fromstring(html)
    h2 = h3 = ""
    year = None
    found = []
    for el in doc.iter("h2", "h3", "h4", "table"):
        text = clean_text(el.text_content()).lower() if el.tag != "table" else ""
        if el.tag == "h2":
            h2, h3, year = text, "", None
        elif el.tag == "h3":
            h3, year = text, None
        elif el.tag == "h4":
            m = re.fullmatch(r"(\d{4})", text)
            year = int(m.group(1)) if m else None
        elif ("voting intention" in h2 and "council" not in h3
              and "wikitable" in (el.get("class") or "")):
            found.append((year, lxml.html.tostring(el, encoding="unicode")))
    return found


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
            "sample_size": int(sample) if sample else None,
            "primary": primary,
        }
        if tpp:
            poll["tpp"] = tpp
        polls.append(poll)
    return polls


def fetch_polls(today: date | None = None) -> list[dict]:
    today = today or datetime.now(timezone.utc).date()
    resp = requests.get(POLLS_URL, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
    resp.raise_for_status()
    tables = statewide_tables(resp.text)
    if not tables:
        raise ValueError("no tables found under the 'Voting intention' heading")

    polls, used = [], 0
    for year, table_html in tables:
        for df in pd.read_html(io.StringIO(table_html)):
            rows = parse_poll_table(df, today, year)
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
    log.info("Parsed %d polls from %d of %d tables", len(unique), used, len(tables))
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
        if key in known or any(_same_person(c["name"], o) for o in others):
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

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR,
                        help="directory holding the JSON files (default: site/data)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    data_dir = args.data_dir.resolve()
    if not data_dir.is_dir():
        log.error("Data directory not found: %s", data_dir)
        return 1

    meta_path = data_dir / "meta.json"
    meta = read_json(meta_path, {}) or {}
    before = json.dumps(meta, sort_keys=True)

    updated = [
        refresh_polls(data_dir, meta),
        refresh_wiki_candidates(data_dir, meta),
        refresh_candidates(data_dir, meta),
    ]
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
