#!/usr/bin/env python3
"""Refresh the tracker's data files in site/data.

* Polls: scraped from the Wikipedia page "Opinion polling for the 2026
  Victorian state election" with pandas.read_html, written to polls.json.
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
import io
import json
import logging
import os
import re
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

import lxml.html
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT / "site" / "data"

POLLS_URL = "https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Victorian_state_election"
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


def _candidate_key(c: dict) -> tuple[str, str]:
    return (c.get("district", ""), re.sub(r"[^a-z]", "", c.get("name", "").lower()))


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
    write_json(path, {**existing, "candidates": sorted(rows.values(), key=lambda c: (c["district"], c["name"]))})
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

    updated = [refresh_polls(data_dir, meta), refresh_candidates(data_dir, meta)]
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
