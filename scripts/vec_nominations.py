"""The VEC's official 2026 candidate list: fetch, parse, compare and apply.

Nominations closed at noon on Mon 9 Nov 2026 and the ballot draw followed at 4 pm. The VEC publishes:
  - a spreadsheet of every nominated candidate (linked from /voting/2026-state-election), grouped by district and
    region: name as on the ballot ("SURNAME, Given"), and the registered party (blank for independents). It also
    carries each candidate's contact person, phone and email: those are never read into our data;
  - a nominations page per district and region (/electoral-boundaries/state-districts/<id>-district/nominations,
    /electoral-boundaries/state-regions/<id>-region/nominations). Before the draw they list candidates in the order
    they nominated; after it, in ballot-paper order, and region pages head each group with "A. <party>" (then
    "Ungrouped"). Region pages also print each candidate's locality, which we don't keep.

fetch_nominations() reads both, one request a second, and returns the vec_nominations.json document.
diff_nominations() compares two documents (withdrawals, corrections, the draw arriving), and
apply_nominations() brings candidates.json, regions.json, profiles.json and headshots.json into line with the list.

refresh.py runs this (refresh_vec_nominations) on the evening refresh, and on every refresh until the ballot order is
published. By hand:
    python scripts/vec_nominations.py --data-dir <copy of site/data> [--raw-dir <folder for the raw spreadsheet>]
"""
from __future__ import annotations

import argparse
import collections
import difflib
import io
import json
import logging
import re
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

import lxml.html
import requests

log = logging.getLogger("vec_nominations")

VEC = "https://www.vec.vic.gov.au"
STATE_PAGE = VEC + "/voting/2026-state-election"
DISTRICT_URL = VEC + "/electoral-boundaries/state-districts/{id}-district/nominations"
REGION_URL = VEC + "/electoral-boundaries/state-regions/{id}-region/nominations"
DELAY = 1.0        # seconds between requests
ATTEMPTS = 3       # tries per page
TIMEOUT = 45

SCHEMA = {
    "description": "The VEC's official list of candidates for the 2026 state election (nominations closed 12 noon Mon 9 Nov "
                   "2026; ballot draw 4 pm that day), read from the VEC's nominations page for each district and region and "
                   "its spreadsheet of all candidates. Facts only: no contact details or localities are kept. Rewritten by "
                   "scripts/vec_nominations.py (refresh.py runs it nightly, and every run until the ballot order is "
                   "published); candidates.json and regions.json are brought into line with it.",
    "fields": {
        "source": "{label, url (the VEC's 2026 election page), spreadsheet_url, spreadsheet_as_at (as printed on it)}",
        "fetched": "ISO UTC time the VEC pages were last read",
        "ballot_drawn": "true once every nominations page lists candidates in ballot-paper order",
        "totals": "{candidates, assembly, council, independents (Assembly independents plus Council candidates with no "
                  "registered party), by_party: {code: count, both houses}, assembly_by_party, council_by_party}",
        "districts": "{district id: {name, url, vacancies, ballot_drawn, candidates: [{ballot_name (as on the ballot, "
                     "'SURNAME, Given'), name ('Given Surname', the tracker's display spelling), party (code; IND for "
                     "independents), party_label (as the VEC prints it; null for independents), ballot_position (null "
                     "until the draw), nominated (order on the pre-draw list), id (candidate id in the tracker)}]}}",
        "regions": "{region id: {name, url, vacancies, ballot_drawn, groups: [{group (letter), label (as printed), "
                   "party (code), candidates: [names in group order]}], candidates: [as for districts, plus group "
                   "(letter, null if ungrouped) and group_position (position within the group)]}}",
        "changes": "What the last run found different from the run before: [{date, kind (added | removed | renamed | "
                   "party | ballot_position | group | drawn), contest, name, detail}], newest first, last 200",
    },
}

# Party labels as the VEC prints them (page) or registers them (spreadsheet) -> codes. First keyword found wins.
PARTY_KEYWORDS = [
    ("libertarian", "LBT"), ("liberal democrat", "LBT"), ("liberal", "LIB"), ("national", "NAT"),
    ("green", "GRN"), ("one nation", "ONP"), ("victorian socialists", "VS"), ("socialist alliance", "SAL"),
    ("animal justice", "AJP"), ("family first", "FF"), ("legalise cannabis", "LCV"), ("shooters", "SFF"),
    ("democratic labour", "DLP"), ("sustainable", "SUS"), ("new democrats", "ND"), ("west", "WEST"),
    ("labor", "ALP"),
]


def clean(s) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(s or ""))).strip()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).strip("-")


def party_code(*labels) -> str | None:
    """The party code for the first label that names a party; 'IND' when none is given (an independent)."""
    labels = [clean(x) for x in labels if clean(x)]
    if not labels:
        return "IND"
    for label in labels:
        low = label.lower()
        if "liberal" in low and "national" in low:
            return "LNP"    # a joint Coalition group
        if "independent" in low:
            return "IND"
        for kw, code in PARTY_KEYWORDS:
            if kw in low:
                return code
    return "OTH"


def _cap_word(w: str) -> str:
    """'MCDONALD' -> 'McDonald', "O'BRIEN" -> "O'Brien", 'SMITH-JONES' -> 'Smith-Jones'."""
    if not w:
        return w
    out = "-".join("'".join(p[:1].upper() + p[1:].lower() for p in part.split("'")) for part in w.split("-"))
    m = re.match(r"^Mc([a-z])(.*)$", out)
    if m and len(out) > 3:
        out = "Mc" + m.group(1).upper() + m.group(2)
    return out


def display_surname(surname: str) -> str:
    """Capitals to title case word by word ('DE WACHT' -> 'De Wacht'). Particles that the person writes in lower
    case ('van der Eynden') come from the tracker's existing spelling (display_name's known)."""
    return " ".join(_cap_word(w) for w in surname.split())


def split_ballot_name(ballot_name: str) -> tuple[str, str]:
    """'VAN DER EYNDEN, Jacob' -> ('VAN DER EYNDEN', 'Jacob')."""
    sur, _, given = ballot_name.partition(",")
    return clean(sur), clean(given)


def display_name(ballot_name: str, known: str | None = None) -> str:
    """The tracker's 'Given Surname' spelling of a ballot name. The VEC prints surnames in capitals, so when the
    tracker already spells the surname the same way apart from case ('McDonald', 'van der Eynden') its casing is kept."""
    sur, given = split_ballot_name(ballot_name)
    surname = display_surname(sur)
    if known:
        k = known.split()
        for n in range(len(k) - 1, 0, -1):
            tail = " ".join(k[n:])
            if tail.lower() == sur.lower():
                surname = tail
                break
    return clean(f"{given} {surname}") if given else surname


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------

class Polite:
    def __init__(self, user_agent: str):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = user_agent
        self.last = 0.0

    def get(self, url: str) -> requests.Response:
        error = None
        for attempt in range(1, ATTEMPTS + 1):
            wait = self.last + DELAY - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            try:
                r = self.s.get(url, timeout=TIMEOUT)
                r.raise_for_status()
                return r
            except requests.RequestException as exc:
                error = exc
                log.warning("VEC fetch %s failed (attempt %d/%d): %s", url, attempt, ATTEMPTS, exc)
            finally:
                self.last = time.monotonic()
        raise RuntimeError(f"{url} failed {ATTEMPTS} times: {error}")


def parse_spreadsheet(content: bytes) -> dict:
    """{'as_at', 'total', 'contests': {(house, id): {'name', 'vacancies', 'candidates': [{ballot_name, rpp}]}}}.
    Contact columns are skipped."""
    import xlrd   # only needed here; refresh.py carries on with the pages alone if it's missing
    book = xlrd.open_workbook(file_contents=content, logfile=io.StringIO())
    sh = book.sheet_by_index(0)
    out = {"as_at": None, "total": None, "contests": {}}
    current = None
    for i in range(sh.nrows):
        row = [clean(v) for v in sh.row_values(i)]
        first = row[0]
        if not any(row):
            current = None
            continue
        if first.startswith("As at "):
            out["as_at"] = first[6:]
        elif first.startswith("Total Candidates"):
            out["total"] = int(float(row[1])) if row[1] else None
        elif re.match(r"^.+ (District|Region)$", first) and not any(row[1:]):
            house = "district" if first.endswith("District") else "region"
            name = re.sub(r" (District|Region)$", "", first)
            current = {"name": name, "vacancies": None, "candidates": []}
            out["contests"][(house, slug(name))] = current
        elif current is not None and first.startswith("(") and "vacanc" in first:
            m = re.search(r"(\d+) vacanc", first)
            current["vacancies"] = int(m.group(1)) if m else None
        elif current is not None and first == "Candidates":
            continue
        elif current is not None:   # "SURNAME, Given", or a single name with no comma ("DAVINDER KAUR")
            current["candidates"].append({"ballot_name": first, "rpp": row[4] if len(row) > 4 and row[4] else None})
    return out


def parse_page(html: str, house: str) -> dict:
    """One nominations page: {'drawn', 'candidates': [{ballot_name, party_label, group, group_label}], 'groups'}.
    Localities (region pages) and contact details are not kept."""
    doc = lxml.html.fromstring(html)
    main = (doc.xpath("//main") or [doc])[0]
    text = clean(main.text_content())
    drawn = "PostBallotDrawText" in html or bool(re.search(r"in the order in which they will appear on the", text))
    if re.search(r"listed in the order they nominated", text):
        drawn = False
    groups, cands, group = [], [], None
    for tr in main.xpath(".//table//tr"):
        cls = tr.get("class") or ""
        if "party-row" in cls:
            if "mobile" in cls:
                continue   # the same heading is repeated for small screens
            cell = (tr.xpath(".//*[contains(@class,'party-name')]") or tr.xpath("./td"))[0]
            label = clean(cell.text_content())
            m = re.match(r"^([A-Z]{1,2})\.\s*(.*)$", label)
            if m:   # 2022: "A. Victorian Socialists"
                group = {"group": m.group(1), "label": clean(m.group(2)) or None}
            elif label.lower().startswith("ungrouped"):
                group = {"group": None, "label": "Ungrouped"}
            else:   # 2026: the name alone, groups in ballot order (A, B, ...); "Unnamed-1" is a group with no name
                group = {"group": _letter(sum(1 for g in groups if g["group"])),
                         "label": None if label.lower().startswith("unnamed") else (label or None)}
            groups.append(group)
            continue
        if "candidate-row" not in cls or tr.xpath("./th"):
            continue
        tds = tr.xpath("./td")
        if not tds:
            continue
        cell = tds[0]
        name = clean(cell.text)
        if not name:   # the name may sit in its own element
            bits = [clean(t) for t in cell.xpath("./text()|./*[not(self::p)]//text()") if clean(t)]
            name = bits[0] if bits else ""
        if not name:
            continue
        ps = [clean(p.text_content()) for p in cell.findall("p") if clean(p.text_content())]
        # District pages: <p>party</p>. Region pages: <p>party</p><p>locality</p>, or just <p>locality</p>.
        party_label = (ps[0] if ps else None) if house == "district" else (ps[0] if len(ps) >= 2 else None)
        cands.append({"ballot_name": name, "party_label": party_label,
                      "group": group["group"] if group else None,
                      "group_label": group["label"] if group else None})
    return {"drawn": drawn and bool(cands), "candidates": cands, "groups": groups}


def group_party(label: str | None, member_parties: list[str]) -> str:
    """A group's party code: from its own name ("Liberal / The Nationals" is a joint L/NP group); when the name
    doesn't say ("Labour DLP") or there is none, the code most of its members carry (independents: IND)."""
    code = party_code(label) if label else "OTH"
    if code == "OTH" and member_parties:
        code = collections.Counter(member_parties).most_common(1)[0][0]
    return code


def _letter(i: int) -> str:
    """Group letters in ballot order: A..Z, then AA, AB, ..."""
    return chr(65 + i) if i < 26 else chr(64 + i // 26) + chr(65 + i % 26)


def fetch_nominations(districts: list[dict], regions: list[dict], user_agent: str,
                      raw_dir: Path | None = None) -> dict:
    """Read the spreadsheet and every nominations page; return the vec_nominations.json document (without
    tracker ids or changes, which apply/diff add). Raises if a page can't be read or parsed."""
    web = Polite(user_agent)
    sheet, sheet_url = None, None
    try:
        page = web.get(STATE_PAGE).text
        m = re.search(r'href="([^"]+\.xlsx?)"[^>]*>[^<]*spreadsheet', page, re.I)
        if m:
            sheet_url = requests.compat.urljoin(STATE_PAGE, m.group(1))
            content = web.get(sheet_url).content
            if raw_dir:
                raw_dir.mkdir(parents=True, exist_ok=True)
                stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
                (raw_dir / f"vec_candidates_{stamp}.xls").write_bytes(content)
            sheet = parse_spreadsheet(content)
        else:
            log.warning("VEC: no spreadsheet link on %s", STATE_PAGE)
    except Exception as exc:  # noqa: BLE001 - the pages alone are enough
        log.warning("VEC spreadsheet not read (%s); using the nominations pages alone", exc)

    doc = {"_schema": SCHEMA,
           "source": {"label": "Victorian Electoral Commission", "url": STATE_PAGE, "spreadsheet_url": sheet_url,
                      "spreadsheet_as_at": sheet and sheet["as_at"]},
           "fetched": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
           "ballot_drawn": False, "totals": {}, "districts": {}, "regions": {}}
    problems = []
    for house, items, url_t in (("district", districts, DISTRICT_URL), ("region", regions, REGION_URL)):
        for item in items:
            url = url_t.format(id=item["id"])
            parsed = parse_page(web.get(url).text, house)
            ss = (sheet or {}).get("contests", {}).get((house, item["id"]))
            if not parsed["candidates"]:
                problems.append(f"{url}: no candidates found")
                continue
            if ss and sorted(c["ballot_name"].lower() for c in ss["candidates"]) != sorted(
                    c["ballot_name"].lower() for c in parsed["candidates"]):
                log.warning("VEC %s: the spreadsheet (as at %s) and the page list different names; the page wins",
                            item["id"], sheet["as_at"])
            rpp = {c["ballot_name"].lower(): c["rpp"] for c in (ss or {}).get("candidates", [])}
            nominated = {c["ballot_name"].lower(): i + 1 for i, c in enumerate((ss or {}).get("candidates", []))}
            rows = []
            for i, c in enumerate(parsed["candidates"]):
                reg = rpp.get(c["ballot_name"].lower())
                row = {"ballot_name": c["ballot_name"], "name": display_name(c["ballot_name"]),
                       "party": party_code(c["party_label"], reg), "party_label": c["party_label"],
                       "ballot_position": i + 1 if parsed["drawn"] else None,
                       "nominated": nominated.get(c["ballot_name"].lower()) or (None if parsed["drawn"] else i + 1)}
                if house == "region":
                    if parsed["drawn"]:
                        row["group"] = c["group"]
                        row["group_position"] = (sum(1 for r in rows if r.get("group") == c["group"]) + 1
                                                 if c["group"] else None)
                    else:
                        row["group"] = row["group_position"] = None
                rows.append(row)
            entry = {"name": item["name"], "url": url, "vacancies": (ss or {}).get("vacancies") or (1 if house == "district" else 5),
                     "ballot_drawn": parsed["drawn"], "candidates": rows}
            if house == "region":
                entry["groups"] = [{"group": g["group"], "label": g["label"],
                                    # the group's own name first ("Liberal / The Nationals" is a joint L/NP group), else
                                    # its members' parties (a group with no name is independents: IND)
                                    "party": group_party(g["label"], [r["party"] for r in rows if r.get("group") == g["group"]])
                                    if g["group"] else None,
                                    "candidates": [r["name"] for r in rows if r.get("group") == g["group"]]}
                                   for g in parsed["groups"] if g["group"]]
            doc["districts" if house == "district" else "regions"][item["id"]] = entry
    if problems:
        raise RuntimeError("; ".join(problems))
    doc["ballot_drawn"] = all(e["ballot_drawn"] for h in ("districts", "regions") for e in doc[h].values())
    doc["totals"] = totals(doc)
    if sheet and sheet.get("total") and sheet["total"] != doc["totals"]["candidates"]:
        log.warning("VEC: spreadsheet total %s, pages list %s", sheet["total"], doc["totals"]["candidates"])
    return doc


def totals(doc: dict) -> dict:
    la = [c for e in doc["districts"].values() for c in e["candidates"]]
    lc = [c for e in doc["regions"].values() for c in e["candidates"]]

    def by(rows):
        out = {}
        for c in rows:
            out[c["party"]] = out.get(c["party"], 0) + 1
        return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))
    return {"candidates": len(la) + len(lc), "assembly": len(la), "council": len(lc),
            "independents": sum(1 for c in la + lc if c["party"] == "IND"),
            "by_party": by(la + lc), "assembly_by_party": by(la), "council_by_party": by(lc)}




# --------------------------------------------------------------------------
# Comparing two lists (the nightly check)
# --------------------------------------------------------------------------

def diff_nominations(old: dict | None, new: dict, today: str) -> list[dict]:
    """What changed between two vec_nominations.json documents: a candidate added or removed (nobody can join or
    leave after the close, so this is a correction, a death or an error on either side), a respelling, a party
    change, a ballot position or group moving, and the draw being published."""
    if not old:
        return []
    out = []
    for house in ("districts", "regions"):
        for cid, e in new[house].items():
            o = old.get(house, {}).get(cid)
            if not o:
                continue
            if e.get("ballot_drawn") and not o.get("ballot_drawn"):
                out.append({"date": today, "kind": "drawn", "contest": cid, "name": None,
                            "detail": "ballot order published"})
            before = {c["ballot_name"].lower(): c for c in o["candidates"]}
            after = {c["ballot_name"].lower(): c for c in e["candidates"]}
            gone = [before[k] for k in before if k not in after]
            came = [after[k] for k in after if k not in before]
            for c in list(came):   # a respelling shows up as one name gone and a near-identical one added
                twin = next((g for g in gone if difflib.SequenceMatcher(
                    None, g["ballot_name"].lower(), c["ballot_name"].lower()).ratio() >= 0.8), None)
                if twin:
                    out.append({"date": today, "kind": "renamed", "contest": cid, "name": c["ballot_name"],
                                "detail": f"was {twin['ballot_name']}"})
                    gone.remove(twin)
                    came.remove(c)
            out += [{"date": today, "kind": "removed", "contest": cid, "name": c["ballot_name"],
                     "detail": "no longer on the VEC's list"} for c in gone]
            out += [{"date": today, "kind": "added", "contest": cid, "name": c["ballot_name"],
                     "detail": f"new on the VEC's list ({c.get('party_label') or 'no party'})"} for c in came]
            for k in sorted(set(before) & set(after)):
                b, a = before[k], after[k]
                if b["party"] != a["party"] or (b.get("party_label") or "") != (a.get("party_label") or ""):
                    out.append({"date": today, "kind": "party", "contest": cid, "name": a["ballot_name"],
                                "detail": f"{b.get('party_label') or 'no party'} -> {a.get('party_label') or 'no party'}"})
                if o.get("ballot_drawn") and b.get("ballot_position") != a.get("ballot_position"):
                    out.append({"date": today, "kind": "ballot_position", "contest": cid, "name": a["ballot_name"],
                                "detail": f"{b.get('ballot_position')} -> {a.get('ballot_position')}"})
                if o.get("ballot_drawn") and (b.get("group"), b.get("group_position")) != (a.get("group"), a.get("group_position")):
                    out.append({"date": today, "kind": "group", "contest": cid, "name": a["ballot_name"],
                                "detail": f"{b.get('group') or 'ungrouped'} {b.get('group_position') or ''} -> "
                                          f"{a.get('group') or 'ungrouped'} {a.get('group_position') or ''}".replace("  ", " ")})
    return out


# --------------------------------------------------------------------------
# Matching the list to the tracker's candidates
# --------------------------------------------------------------------------

def _key(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"^(dr|mr|mrs|ms|prof)\.?\s+", "", s)
    return re.sub(r"[^a-z]", "", s)


def _tokens(s: str) -> set[str]:
    """Name parts, split on spaces and hyphens, initials dropped: 'Khalili-Naghadeh Sahar' -> {khalili, naghadeh, sahar}."""
    return {k for k in (_key(w) for w in re.split(r"[\s\-]+", s or "")) if len(k) > 1}


def _first_near(a: str, b: str) -> bool:
    a, b = _key(a), _key(b)
    return bool(a and b) and (a == b or a.startswith(b) or b.startswith(a)
                              or difflib.SequenceMatcher(None, a, b).ratio() >= 0.7)


def _party_ok(tracker: str | None, vec: str) -> bool:
    """Same party for matching. The tracker codes joint Coalition tickets LNP; the VEC prints each candidate's own
    party. OTH in the tracker is a party it couldn't code, so it agrees with anything but a main party."""
    tracker = tracker or "OTH"
    return (tracker == vec or (tracker == "LNP" and vec in ("LIB", "NAT"))
            or (tracker == "OTH" and vec not in ("ALP", "LIB", "NAT", "LNP", "GRN"))
            or (tracker in ("IND", "ILAB") and vec in ("IND", "OTH")))


def score(v: dict, name: str, party: str | None) -> tuple[int, str]:
    """How well VEC candidate v matches a tracker name: 100 same name; 98 same first given name and surname (the
    VEC adds middle names); 90 same surname and first names alike (Tim/Timothy); 88 same surname, going by a later given name; 85 near-identical spelling; 75 same
    surname and party but another first name; 88 the VEC's name adds parts to the tracker's (a second surname, the
    family name written first). 0: not the same person. The note says why a person should look."""
    sur, given = split_ballot_name(v["ballot_name"])
    gw = given.split()
    full, tk = _key(f"{given} {sur}"), _key(name)
    parts = name.split()
    first = parts[0] if parts else ""
    if tk == full:
        s, why = 100, ""
    elif gw and tk == _key(f"{gw[0]} {sur}"):
        s, why = 98, ""
    elif _key(sur) and tk.endswith(_key(sur)) and len(tk) > len(_key(sur)):
        if gw and _first_near(first, gw[0]):
            s, why = 90, ""
        elif any(_first_near(first, g) for g in gw[1:]):
            s, why = 88, f"goes by a later given name ({display_name(v['ballot_name'])})"
        else:
            s, why = 75, f"first name differs ({first} / {gw[0] if gw else '-'})"
    elif len(parts) >= 2 and _tokens(name) <= _tokens(f"{given} {sur}") and _tokens(name) & _tokens(sur):
        s, why = 88, f"the VEC's name has more parts ({display_name(v['ballot_name'])})"
    elif len(parts) >= 2 and gw and _first_near(first, gw[0]) and difflib.SequenceMatcher(
            None, _key(parts[-1]), _key(sur.split()[-1])).ratio() >= 0.85:
        s, why = 85, f"surname spelt differently ({' '.join(parts[1:])} / {display_surname(sur)})"
    else:
        return 0, ""
    if not _party_ok(party, v["party"]):
        if s < 85:
            return 0, ""
        why = "; ".join(filter(None, [why, f"party differs (tracker {party or '?'}, VEC {v['party']})"]))
    elif s == 75 and v["party"] in ("IND", "OTH"):
        return 0, ""   # independents can share a surname: another first name is another person
    return s, why


def match_contest(vecs: list[dict], people: list[dict], overrides: dict, contest: str, assembly: bool):
    """Pair VEC candidates with tracker people in one contest. people: [{name, party, ballot_name?, ...}].
    overrides: {"<contest>|<BALLOT NAME>": tracker name, or null for 'a new person'}.
    Returns (pairs [(v, person, score, note)], new [v], gone [person], review [str])."""
    review, pairs, used_v, used_p = [], [], set(), set()
    # 1. Rows matched on an earlier run carry the VEC's ballot name.
    for vi, v in enumerate(vecs):
        pi = next((i for i, p in enumerate(people) if i not in used_p and p.get("ballot_name")
                   and p["ballot_name"].lower() == v["ballot_name"].lower()), None)
        if pi is not None:
            pairs.append((v, people[pi], 101, ""))
            used_v.add(vi)
            used_p.add(pi)
    # 2. Decisions made by hand (scripts/vec_overrides.json).
    for vi, v in enumerate(vecs):
        okey = f"{contest}|{v['ballot_name']}"
        if vi in used_v or okey not in overrides:
            continue
        used_v.add(vi)
        target = overrides[okey]
        if target is None:
            continue   # a new person
        pi = next((i for i, p in enumerate(people) if i not in used_p and _key(p["name"]) == _key(target)), None)
        if pi is None:
            review.append(f"{contest}: the override for {v['ballot_name']} names {target}, who isn't in the tracker here")
            continue
        pairs.append((v, people[pi], 99, "matched by hand"))
        used_p.add(pi)
    # 3. Scored, best first. A tie is matched to the first and reported.
    cands = []
    for vi, v in enumerate(vecs):
        if vi in used_v:
            continue
        for pi, p in enumerate(people):
            if pi not in used_p:
                s, why = score(v, p["name"], p.get("party"))
                if s:
                    cands.append((s, vi, pi, why))
    cands.sort(key=lambda x: -x[0])
    for cur in cands:
        s, vi, pi, why = cur
        if vi in used_v or pi in used_p:
            continue
        rivals = [c for c in cands if c is not cur and c[0] == s and (c[1] == vi or c[2] == pi)
                  and c[1] not in used_v and c[2] not in used_p]
        if rivals:
            review.append(f"{contest}: {vecs[vi]['ballot_name']} / {people[pi]['name']} tied with "
                          + ", ".join(f"{vecs[c[1]]['ballot_name']} / {people[c[2]]['name']}" for c in rivals)
                          + "; matched the first (add an override if that's wrong)")
        pairs.append((vecs[vi], people[pi], s, why))
        used_v.add(vi)
        used_p.add(pi)
        if why:
            review.append(f"{contest}: {vecs[vi]['ballot_name']} ({vecs[vi]['party']}) matched to {people[pi]['name']} "
                          f"({people[pi].get('party')}): {why}")
    paired = {id(v) for v, *_ in pairs}
    new = [v for v in vecs if id(v) not in paired]
    gone = [p for pi, p in enumerate(people) if pi not in used_p]
    if assembly:   # one party, one candidate per seat: a leftover on both sides is a replacement or a new name
        for p in gone:
            twin = next((v for v in new if v["party"] == p.get("party") and v["party"] not in ("IND", "OTH")), None)
            if twin:
                review.append(f"{contest}: {p['name']} ({p.get('party')}) didn't nominate and {twin['ballot_name']} "
                              f"did for the same party (a replacement, or a change of name?)")
    return pairs, new, gone, review


# --------------------------------------------------------------------------
# Applying the list
# --------------------------------------------------------------------------

INACTIVE = {"superseded", "withdrawn", "not_standing"}
PLACEHOLDER = re.compile(r"^TB[CD]$", re.I)
WITHDRAWN_NOTE = "did not nominate"
NOMINATIONS_CLOSED = "2026-11-09"

# Field descriptions this step adds to candidates.json's and regions.json's _schema (kept in step with the data).
CANDIDATE_FIELDS = {
    "status": "vec_nominated (on the VEC's official list, from 9 Nov 2026) | endorsed (preselected or endorsed by the party, "
              "or listed in the ABC guide) | reported (reported, not independently verified) | announced (listed on Wikipedia, "
              "added automatically) | withdrawn (withdrew, or not on the VEC's list at the close: notes say 'did not nominate') | "
              "superseded (replaced by an ABC entry for the same party and seat) | not_standing (not a 2026 candidate: a row "
              "entered in error, kept with a note saying why, hidden like superseded rows)",
    "ballot_position": "Position on the ballot paper (Assembly; for the Council, the position among all the region's candidates) "
                       "once the VEC publishes its 9 Nov draw, else null",
    "ticket_position": "Council rows: place within the group once the VEC publishes the draw; before that, as reported",
    "group": "Council rows: the group's letter on the ballot once the VEC publishes the draw (null when ungrouped or not yet published)",
    "ballot_name": "vec_nominated rows: the name exactly as on the VEC's list and the ballot ('SURNAME, Given')",
    "vec_url": "vec_nominated rows: the VEC nominations page that lists the candidate",
    "party_name": "Rows coded OTH: the party as the VEC prints it",
    "former_names": "Earlier spellings in the tracker before the VEC's (the candidate id, profile and photo moved to the new spelling)",
    "withdrawn_on": "withdrawn rows: YYYY-MM-DD the row was marked withdrawn",
    "moved_to": "withdrawn rows of a person who nominated for another seat: their candidate id there",
    "source": "vec (added from the VEC's list of nominations) | abc (listed in the ABC guide) | wikipedia (added from Wikipedia) | "
              "electiontracker (found through electiontracker.au's reconciliation report and added by hand; source_url is the party or "
              "campaign page it cites) | absent for rows from the research report or entered by hand from a news report (cited in source_url)",
}
TICKETS_FIELD = ("Groups on the 2026 ballot: [{group (ballot letter; null before the VEC publishes the 9 Nov draw, and for "
                 "ungrouped candidates), party, label (the group's name as the VEC prints it), status (vec_nominated from 9 Nov; "
                 "earlier endorsed | reported | withdrawn), order_official (true once the order is the VEC's ballot order; false "
                 "while it is the order reported before the draw), ungrouped (true: a candidate in no group, listed after the "
                 "groups), candidates: [names in order; TBC/TBD where a position was unfilled], notes}]")


def _update_schemas(cand_doc: dict, reg_doc: dict) -> None:
    fields = cand_doc.setdefault("_schema", {}).setdefault("fields", {})
    fields.update(CANDIDATE_FIELDS)
    desc = cand_doc["_schema"].get("description", "")
    if "VEC's official list" not in desc:
        cand_doc["_schema"]["description"] = re.sub(
            r"\s*Nominations close 12 noon 9 Nov 2026;.*$", "", desc) + (
            " From 9 Nov 2026 the VEC's official list (scripts/vec_nominations.py, vec_nominations.json) decides who is "
            "standing: every candidate on it is a vec_nominated row with its ballot position, and a row it doesn't list is "
            "withdrawn ('did not nominate'). After that, Wikipedia and the ABC add no rows.")
    reg_doc.setdefault("_schema", {}).setdefault("fields", {})["tickets"] = TICKETS_FIELD


def apply_nominations(doc: dict, data_dir: Path, today: str, overrides: dict | None = None, meta: dict | None = None) -> dict:
    """Bring candidates.json, regions.json, districts.json (retiring flags), profiles.json and headshots.json into
    line with the VEC list, and fill each VEC candidate's 'id' (candidate id in the tracker). Returns a report:
    matched, new, withdrawn, moved_seat, renamed, party changes, review notes, profile moves, sitting members who
    didn't nominate."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from profile_seats import candidate_id
    from refresh import carry_profiles, read_json, write_json, _sort_candidates

    overrides = overrides or {}
    cand_doc = read_json(data_dir / "candidates.json", {}) or {}
    reg_doc = read_json(data_dir / "regions.json", {}) or {}
    dist_doc = read_json(data_dir / "districts.json", {}) or {}
    rows = cand_doc.get("candidates", [])
    regions = {r["id"]: r for r in reg_doc.get("regions", [])}
    seat_names = {**{d["id"]: d["name"] for d in dist_doc.get("districts", [])},
                  **{r["id"]: f"{r['name']} Region" for r in reg_doc.get("regions", [])}}
    sitting = {d["id"]: _key(d.get("sitting_mp") or "") for d in dist_doc.get("districts", [])}
    report = {"matched": 0, "matched_by_score": {}, "new": [], "withdrawn": [], "moved_seat": [], "renamed": [],
              "party": [], "review": [], "moved": [], "sitting_not_nominated": []}
    respelled = []

    # ---- 1. match each contest
    contests = []
    for house in ("districts", "regions"):
        for contest, entry in doc[house].items():
            is_lc = house == "regions"
            field = "region" if is_lc else "district"
            people = [{"name": c["name"], "party": c.get("party"), "ballot_name": c.get("ballot_name"), "row": c,
                       "seat": contest} for c in rows if c.get(field) == contest and c.get("status") not in INACTIVE]
            if is_lc:   # ticket names without a row of their own
                have = {candidate_id(contest, p["name"]) for p in people}
                for t in (regions.get(contest) or {}).get("tickets") or []:
                    if t.get("status") in INACTIVE:
                        continue
                    for i, n in enumerate(t.get("candidates") or []):
                        if not PLACEHOLDER.match(n.strip()) and candidate_id(contest, n) not in have:
                            have.add(candidate_id(contest, n))
                            people.append({"name": n, "party": t.get("party"), "row": None, "seat": contest,
                                           "ticket_position": i + 1})
            pairs, new, gone, review = match_contest(entry["candidates"], people, overrides, contest, assembly=not is_lc)
            report["review"] += review
            contests.append({"id": contest, "lc": is_lc, "entry": entry, "pairs": pairs, "new": new, "gone": gone,
                             "names": {}, "ticket_names": {}})

    # ---- 2. someone who didn't nominate where we had them may have nominated in another seat
    elsewhere = {}   # id(person) -> (contest dict, v)
    for c in contests:
        for p in c["gone"]:
            best = None
            for o in contests:
                if o is c:
                    continue
                for v in o["new"]:
                    s, why = score(v, p["name"], p.get("party"))
                    if s >= 88 and v["party"] == p.get("party") and (best is None or s > best[0]):
                        best = (s, o, v)
            if best and not any(v is best[2] for _, v in elsewhere.values()):
                elsewhere[id(p)] = (best[1], best[2])
    for c in contests:
        for p in c["gone"]:
            if id(p) in elsewhere:
                o, v = elsewhere[id(p)]
                o["new"].remove(v)
                o["pairs"].append((v, {**p, "from_seat": c["id"]}, 88, ""))
                report["moved_seat"].append({"name": p["name"], "from": c["id"], "to": o["id"], "ballot_name": v["ballot_name"]})
                report["review"].append(f"{c['id']}: {p['name']} ({p.get('party')}) nominated for "
                                        f"{seat_names.get(o['id'], o['id'])} instead (VEC: {v['ballot_name']}); "
                                        f"check the profile's wording for the new seat")

    # ---- 3. apply
    for c in contests:
        contest, entry, is_lc = c["id"], c["entry"], c["lc"]
        for v, p, s, why in c["pairs"]:
            report["matched"] += 1
            report["matched_by_score"][str(s)] = report["matched_by_score"].get(str(s), 0) + 1
            row, from_seat = p["row"], p.get("from_seat")
            if from_seat:   # the old row stays where it was, marked; the person gets a row in the new seat
                old_row = row or {"district": None, "region": from_seat, "name": p["name"], "party": p.get("party"),
                                  "ticket_position": p.get("ticket_position"), "date_added": today}
                if row is None:
                    rows.append(old_row)
                _withdraw(old_row, today, f"{WITHDRAWN_NOTE} here: nominated for {seat_names.get(contest, contest)} "
                                          f"instead (VEC list, {today})")
                old_row["moved_to"] = candidate_id(contest, display_name(v["ballot_name"], known=p["name"]))
                row = {"district": None if is_lc else contest, **({"region": contest} if is_lc else {}),
                       "name": p["name"], "party": p.get("party"), "source": "vec", "source_url": entry["url"],
                       "date_added": today}
                for k in ("website",):
                    if old_row.get(k):
                        row[k] = old_row[k]
                if not is_lc:
                    row["incumbent"] = False
                rows.append(row)
            elif row is None:   # a ticket name gets a row of its own
                row = {"district": None, "region": contest, "name": p["name"], "party": p.get("party"),
                       "date_added": today}
                rows.append(row)
            old_name, old_party = p["name"], p.get("party")
            new_name = display_name(v["ballot_name"], known=old_name)
            if _key(new_name) != _key(old_name) or from_seat:
                if _key(new_name) != _key(old_name):
                    report["renamed"].append({"seat": contest, "old": old_name, "new": new_name, "score": s})
                    row["former_names"] = list(dict.fromkeys((row.get("former_names") or []) + [old_name]))
                # The match is the check (doubtful ones are listed for review), so the profile and photo follow.
                respelled.append({"seat": from_seat or contest, "new_seat": contest, "old": old_name,
                                  "old_party": old_party, "new": new_name, "new_party": v["party"], "reviewed": True})
            row["name"] = new_name
            if old_party and old_party != v["party"]:
                report["party"].append({"seat": contest, "name": new_name, "from": old_party, "to": v["party"],
                                        "label": v.get("party_label")})
            row["party"] = v["party"]
            _set_vec_fields(row, v, entry, is_lc, today)
            v["id"] = candidate_id(contest, new_name)
            c["names"][id(v)] = new_name
            c["ticket_names"][_key(old_name)] = v

        for v in c["new"]:
            row = {"district": None if is_lc else contest, **({"region": contest} if is_lc else {}),
                   "name": v["name"], "party": v["party"]}
            if not is_lc:
                sur, given = split_ballot_name(v["ballot_name"])
                row["incumbent"] = bool(sitting.get(contest)) and sitting[contest] in (
                    _key(v["name"]), _key(f"{(given.split() or [''])[0]} {sur}"))
            row.update(source="vec", source_url=entry["url"], date_added=today)
            _set_vec_fields(row, v, entry, is_lc, today)
            rows.append(row)
            v["id"] = candidate_id(contest, v["name"])
            c["names"][id(v)] = v["name"]
            report["new"].append({"seat": contest, "name": v["name"], "party": v["party"],
                                  "party_label": v.get("party_label")})

        for p in c["gone"]:
            if id(p) in elsewhere:
                continue
            row = p["row"]
            if row is None:
                row = {"district": None, "region": contest, "name": p["name"], "party": p.get("party"),
                       "ticket_position": p.get("ticket_position"), "date_added": today}
                rows.append(row)
            if row.get("ballot_name"):   # on an earlier VEC list, gone from this one: a correction or a removal
                _withdraw(row, today, f"removed from the VEC's list of nominations ({today})")
            else:
                _withdraw(row, today, f"{WITHDRAWN_NOTE} (not on the VEC's list of nominations at the close, {today})")
            report["withdrawn"].append({"seat": contest, "name": p["name"], "party": p.get("party")})

        if is_lc and contest in regions:
            rebuild_tickets(regions[contest], entry, c["names"], c["ticket_names"])

    # ---- 4. a sitting member who nominated nowhere isn't recontesting: flag them retiring, citing the VEC list
    #         (the ABC step keeps a flag that has a retiring_source). One standing elsewhere is only reported.
    everywhere = {}
    for c in contests:
        for v in c["entry"]["candidates"]:
            everywhere.setdefault(c["id"], []).append(v)

    def stands(name: str) -> str | None:
        return next((cid for cid, vs in everywhere.items() if any(score(v, name, None)[0] >= 90 for v in vs)), None)

    def source_for(seat: str, name: str) -> dict:
        entry = doc["districts"].get(seat) or doc["regions"].get(seat)
        return {"name": name, "url": entry["url"], "publisher": "Victorian Electoral Commission",
                "title": f"Candidates for {seat_names.get(seat, seat)} (nominations closed 9 Nov 2026)",
                "published": today, "kind": "official", "via": "vec", "added": today}
    members = [(d, d.get("sitting_mp") or "", d["id"]) for d in dist_doc.get("districts", [])]
    members += [(m, m["name"], r["id"]) for r in reg_doc.get("regions", []) for m in r.get("mlcs", [])]
    for holder, mp, seat in members:
        if not mp or seat not in everywhere or any(score(v, mp, None)[0] >= 90 for v in everywhere[seat]):
            continue
        where = stands(mp)
        report["sitting_not_nominated"].append({"seat": seat, "name": mp, "retiring_flag": bool(holder.get("retiring")),
                                                "elsewhere": where})
        if where is None and not holder.get("retiring"):
            holder["retiring"] = True
            holder["retiring_source"] = source_for(seat, mp)
            report["review"].append(f"{seat}: sitting member {mp} nominated nowhere; now flagged as retiring (VEC list)")

    # ---- 5. profiles left under an inactive row (the ABC superseded a respelling, or moved someone, before this ran):
    #         move each to the VEC candidate it matches (same seat first, else the same party anywhere) if that one has
    #         no profile yet. A row superseded since the close whose person isn't on the list didn't nominate.
    profile_ids = set((read_json(data_dir / "profiles.json", {}) or {}).get("profiles", {}))
    on_list = {v.get("id") for c in contests for v in c["entry"]["candidates"]}
    taken = {candidate_id(ev["new_seat"], ev["new"]) for ev in respelled if candidate_id(ev["seat"], ev["old"]) in profile_ids}
    leaving = {candidate_id(ev["seat"], ev["old"]) for ev in respelled}
    row_by_id = {candidate_id(r.get("district") or r.get("region"), r["name"]): r for r in rows if r.get("district") or r.get("region")}
    for pid in sorted(profile_ids - on_list - leaving):
        row = row_by_id.get(pid)
        if not row or row.get("status") not in INACTIVE:
            continue
        seat = pid.split("/")[0]
        best = None
        for c in contests:
            for v in c["entry"]["candidates"]:
                if v.get("id") in profile_ids or v.get("id") in taken:
                    continue
                s, _ = score(v, row["name"], row.get("party"))
                if s >= 88 and (c["id"] == seat or v["party"] == row.get("party")):
                    rank = (c["id"] == seat, s)
                    if best is None or rank > best[0]:
                        best = (rank, c, v)
        if best is None:
            if row.get("status") == "superseded" and (row.get("superseded_on") or "") >= NOMINATIONS_CLOSED:
                row["status"] = "withdrawn"
                row["withdrawn_on"] = today
                row["notes"] = "; ".join(filter(None, [row.get("notes"), f"{WITHDRAWN_NOTE} (not on the VEC's list of "
                                                                         f"nominations at the close, {today})"]))
                report["withdrawn"].append({"seat": seat, "name": row["name"], "party": row.get("party")})
            continue
        _, c, v = best
        new_name = c["names"].get(id(v)) or v["name"]
        respelled.append({"seat": seat, "new_seat": c["id"], "old": row["name"], "old_party": row.get("party"),
                          "new": new_name, "new_party": v["party"], "reviewed": True})
        taken.add(v["id"])
        target = row_by_id.get(v["id"])
        if target is not None:
            target["former_names"] = list(dict.fromkeys((target.get("former_names") or []) + [row["name"]]))
        if c["id"] != seat:
            row["moved_to"] = v["id"]
            report["moved_seat"].append({"name": row["name"], "from": seat, "to": c["id"], "ballot_name": v["ballot_name"]})
        report["review"].append(f"{seat}: profile of {row['name']} ({row['status']} row) moved to {v['id']} "
                                f"(VEC: {v['ballot_name']}){'; check its wording for the new seat' if c['id'] != seat else ''}")

    cand_doc["candidates"] = _sort_candidates(rows)
    _update_schemas(cand_doc, reg_doc)
    write_json(data_dir / "candidates.json", cand_doc)
    write_json(data_dir / "regions.json", reg_doc)
    write_json(data_dir / "districts.json", dist_doc)
    report["moved"] = carry_profiles(data_dir, respelled, meta if meta is not None else {})
    return report


def _withdraw(row: dict, today: str, note: str) -> None:
    row["status"] = "withdrawn"
    row["withdrawn_on"] = today
    if row.get("district"):
        row["ballot_position"] = None
    if note not in (row.get("notes") or ""):
        row["notes"] = "; ".join(filter(None, [row.get("notes"), note]))
    row["updated"] = today


def _set_vec_fields(row: dict, v: dict, entry: dict, is_lc: bool, today: str) -> None:
    row["status"] = "vec_nominated"
    row["ballot_name"] = v["ballot_name"]
    row["ballot_position"] = v.get("ballot_position")
    if is_lc:
        row["group"] = v.get("group")
        if entry.get("ballot_drawn"):
            row["ticket_position"] = v.get("group_position")
    if v["party"] == "OTH" and v.get("party_label"):
        row["party_name"] = v["party_label"]
    else:
        row.pop("party_name", None)
    row["vec_url"] = entry["url"]
    row.pop("superseded_by", None)
    row.pop("superseded_on", None)
    row.pop("withdrawn_on", None)
    row["updated"] = today


def rebuild_tickets(region: dict, entry: dict, tracker_names: dict, ticket_names: dict) -> None:
    """regions.json tickets from the VEC list. After the draw: one ticket per group in letter order, then each
    ungrouped candidate, all in the official order. Before it: the tracker's tickets in their order, trimmed to the
    people who nominated, with the other nominees added by party (order_official false)."""
    vecs = entry["candidates"]
    name = lambda v: tracker_names.get(id(v)) or v["name"]   # noqa: E731
    # Tickets already marked withdrawn stay at the end, for the record (the region page doesn't show them).
    inactive = [t for t in region.get("tickets") or [] if t.get("status") in INACTIVE]
    if entry.get("ballot_drawn"):
        tickets = []
        for g in entry.get("groups", []):
            members = [v for v in vecs if v.get("group") == g["group"]]
            tickets.append({"group": g["group"], "party": g.get("party") or (members[0]["party"] if members else "OTH"),
                            "label": g.get("label"), "status": "vec_nominated", "order_official": True,
                            "candidates": [name(v) for v in members]})
        for v in vecs:
            if not v.get("group"):
                tickets.append({"group": None, "ungrouped": True, "party": v["party"], "label": v.get("party_label"),
                                "status": "vec_nominated", "order_official": True, "candidates": [name(v)]})
        region["tickets"] = tickets + inactive
        return
    placed, tickets = set(), []
    for t in region.get("tickets") or []:
        if t.get("status") in INACTIVE:
            continue
        keep = []
        for n in t.get("candidates") or []:
            v = ticket_names.get(_key(n))
            if v is not None and id(v) not in placed:
                keep.append(name(v))
                placed.add(id(v))
        if keep:
            # Notes about unconfirmed places are settled by the VEC's list, so they go.
            kept = {k: t[k] for k in t if k not in ("candidates", "status", "group", "order_official", "notes")}
            tickets.append({"group": None, **kept, "status": "vec_nominated", "order_official": False, "candidates": keep})
    for v in vecs:
        if id(v) in placed:
            continue
        home = None
        if v["party"] not in ("IND", "OTH"):
            home = next((t for t in tickets if t["party"] == v["party"]
                         or (t["party"] == "LNP" and v["party"] in ("LIB", "NAT"))), None)
        elif v["party"] == "OTH":
            home = next((t for t in tickets if t["party"] == "OTH" and t.get("label") == v.get("party_label")), None)
        if home is None:
            home = {"group": None, "party": v["party"], "status": "vec_nominated", "order_official": False, "candidates": []}
            if v.get("party_label"):
                home["label"] = v["party_label"]
            tickets.append(home)
        home["candidates"].append(name(v))
        placed.add(id(v))
    region["tickets"] = tickets + inactive


def counts_for_meta(doc: dict) -> dict:
    t = doc["totals"]
    return {"total": t["candidates"], "assembly": t["assembly"], "council": t["council"],
            "independents": t["independents"], "by_party": t["by_party"],
            "assembly_by_party": t["assembly_by_party"], "council_by_party": t["council_by_party"],
            "ballot_drawn": doc.get("ballot_drawn", False), "source_url": doc["source"]["url"]}


# --------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", type=Path, required=True, help="the data folder to update (a copy, when testing)")
    ap.add_argument("--raw-dir", type=Path, help="save the VEC spreadsheet here (the git-ignored samples folder)")
    ap.add_argument("--from-file", action="store_true", help="don't fetch: apply the vec_nominations.json already there")
    ap.add_argument("--report", type=Path, help="write the match report (JSON) here")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from refresh import ABC_USER_AGENT, MELBOURNE, read_json
    data = args.data_dir.resolve()
    today = datetime.now(MELBOURNE).date().isoformat()
    path = data / "vec_nominations.json"
    old = read_json(path)
    if args.from_file:
        doc = old
    else:
        ds = read_json(data / "districts.json")["districts"]
        rs = read_json(data / "regions.json")["regions"]
        doc = fetch_nominations(ds, rs, ABC_USER_AGENT, args.raw_dir)
        doc["changes"] = (diff_nominations(old, doc, today) + (old or {}).get("changes", []))[:200]
    overrides = (read_json(OVERRIDES, {}) or {}).get("overrides", {})
    report = apply_nominations(doc, data, today, overrides)
    write_doc(path, doc)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in report.items()}, indent=1))
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


OVERRIDES = Path(__file__).resolve().parent / "vec_overrides.json"


def write_doc(path: Path, doc: dict) -> None:
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    sys.exit(main())
