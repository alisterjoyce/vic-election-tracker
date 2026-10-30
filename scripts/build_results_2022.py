#!/usr/bin/env python3
"""Build site/data/results_2022/: 2022 Legislative Assembly results by voting centre.

Sources (VEC, fetched politely: one request per second, cached in .cache/vec2022/):
  * each district's 2022 results page -> link to "<District> District-Results by Voting Centre.xls"
    (first preferences by voting centre, plus declaration vote types)
  * each district's "2CP results by voting centre" page (two-candidate-preferred by voting centre)
  * "Voting centre locations" for the 2022 State election (lat/long), from the VEC's
    Download boundary maps page
  * swings from the notional 2018 result: Wikipedia, "Results of the 2022 Victorian state
    election (Legislative Assembly)" (numbers only)

Output uses the shared vec-contest-v1 format (scripts/results_format.py), so the
2026 election-night feed can be rendered by the same booth map.

    pip install requests pandas xlrd openpyxl lxml
    python scripts/build_results_2022.py
"""
import io
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import lxml.html
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from results_format import CLASSIFICATIONS, FORMAT, SCHEMA, party_code  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "vec2022"
OUT = ROOT / "site" / "data" / "results_2022"
VEC = "https://www.vec.vic.gov.au"
RESULTS_INDEX = VEC + "/results/state-election-results/2022-state-election-results"
LOCATIONS_URL = VEC + "/-/media/d6faeb7027634194bf56150194ecd7f6.xlsx"   # "Voting centre locations", 2022 State election
WIKI_URL = "https://en.wikipedia.org/wiki/Results_of_the_2022_Victorian_state_election_(Legislative_Assembly)"
UA = "vic-election-tracker/1.0 (2022 results build; 1 request/second; https://github.com/alisterjoyce/vic-election-tracker)"

# Narracan's November 2022 election failed (a candidate died); its result is the
# supplementary election of 28 Jan 2023, published as a by-election.
SPECIAL = {
    "narracan": ("Narracan",
                 VEC + "/results/state-election-results/state-by-elections-timeline/narracan-district-supplementary-election-results",
                 {"name": "Narracan District supplementary election 2023", "date": "2023-01-28"}),
}

DECLARATION_ROWS = {   # report row label -> feed vote type
    "absent": "Absent", "early vote": "Early", "early votes": "Early", "postal vote": "Postal", "postal votes": "Postal",
    "marked as voted": "MarkedAsVoted", "marked as voted votes": "MarkedAsVoted",
    "provisional": "Provisional", "provisional votes": "Provisional", "absent votes": "Absent",
}

_last = [0.0]


def fetch(url, name):
    """GET with a one-second gap between live requests; cached by name."""
    path = CACHE / name
    if path.exists():
        return path.read_bytes()
    wait = _last[0] + 1.0 - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    for attempt in range(3):
        try:
            resp = requests.get(url, headers={"User-Agent": UA}, timeout=60)
            resp.raise_for_status()
            break
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(2)
    _last[0] = time.monotonic()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(resp.content)
    return resp.content


def key(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def num(v):
    try:
        return int(float(str(v).replace(",", "")))
    except (TypeError, ValueError):
        return None


def clean(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v is not None and not (isinstance(v, float) and pd.isna(v)) else ""


# ---------------------------------------------------------------- sources
def district_pages():
    doc = lxml.html.fromstring(fetch(RESULTS_INDEX, "index.html"))
    pages = {}
    for a in doc.iter("a"):
        text = clean(a.text_content())
        m = re.fullmatch(r"(.+) District results", text)
        if m and "/results-by-district/" in (a.get("href") or ""):
            pages[slug(m.group(1))] = (m.group(1), VEC + a.get("href"))
    return pages


def locations():
    df = pd.read_excel(io.BytesIO(fetch(LOCATIONS_URL, "locations_2022.xlsx")), sheet_name="VC Locations")
    out = {}
    for _, r in df.iterrows():
        loc = {"lat": round(float(r["Lat"]), 5) if pd.notna(r["Lat"]) else None,
               "lon": round(float(r["Long"]), 5) if pd.notna(r["Long"]) else None,
               "classification": CLASSIFICATIONS.get(clean(r["VotingLocationTypeDesc"]).lower(), clean(r["VotingLocationTypeDesc"]).replace(" ", ""))}
        for elec in re.split(r"[,;/]", clean(r["Electorates"])):
            dist = slug(elec.replace("District", ""))
            out.setdefault((dist, key(r["VotingLocationName"])), loc)
        out.setdefault(("*", key(r["VotingLocationName"])), loc)
    return out


def parse_fp_report(raw):
    """First preferences by voting centre from the VEC .xls report."""
    df = pd.read_excel(io.BytesIO(raw), header=None)
    meta = {"enrolment": None, "printed": None}
    for _, r in df.head(12).iterrows():
        label = clean(r[0]).upper()
        if label.startswith("ENROLMENT"):
            meta["enrolment"] = num(r[2])
        m = re.search(r"Print Date/Time:\s*(\d{2})/(\d{2})/(\d{4})", clean(r[0]))
        if m:
            meta["printed"] = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    header_row = next(i for i in range(len(df)) if any("Informal" in clean(v) for v in df.iloc[i]))
    header = df.iloc[header_row]
    cand_cols, informal_col, total_col = [], None, None
    for c, v in header.items():
        text = str(v) if pd.notna(v) else ""
        if "Informal" in text:
            informal_col = c
        elif "Total" in text:
            total_col = c
        elif "\n" in text or "," in text:
            parts = [p.strip() for p in text.split("\n")]
            cand_cols.append((c, parts[0], parts[1] if len(parts) > 1 else ""))
    booths, by_type = [], {}
    for i in range(header_row + 1, len(df)):
        r = df.iloc[i]
        name = clean(r[1]) or clean(r[0])
        if not name:
            continue
        low = name.lower()
        votes = [num(r[c]) for c, _, _ in cand_cols]
        if low.startswith(("total", "percentage")) or all(v is None for v in votes):
            continue
        row = {"name": name, "fp": votes, "informal": num(r[informal_col]), "total": num(r[total_col])}
        if low in DECLARATION_ROWS:
            by_type[DECLARATION_ROWS[low]] = row
        else:
            booths.append(row)
    return meta, cand_cols, booths, by_type


def parse_fp_page(raw):
    """First preferences by voting centre from the VEC HTML page (same shape as parse_fp_report).
    Used when the .xls has since been overwritten by a later by-election's report."""
    doc = lxml.html.fromstring(raw)
    rows = [[clean(c.text_content()) for c in tr] for tr in doc.xpath("//table")[0].xpath(".//tr")]
    names, parties = rows[0], rows[1]
    cand_cols = [(i, names[i], parties[i]) for i in range(1, len(names)) if names[i]]
    informal_col = next(i for i, p in enumerate(parties) if p.lower().startswith("informal"))
    total_col = next(i for i, p in enumerate(parties) if p.lower().startswith("total"))
    booths, by_type = [], {}
    for r in rows[2:]:
        if len(r) <= total_col or not r[0] or "total" in r[0].lower() or r[0].lower().startswith("percentage"):
            continue
        row = {"name": r[0], "fp": [num(r[i]) for i, _, _ in cand_cols], "informal": num(r[informal_col]), "total": num(r[total_col])}
        if r[0].lower() in DECLARATION_ROWS:
            by_type[DECLARATION_ROWS[r[0].lower()]] = row
        else:
            booths.append(row)
    return {"enrolment": None, "printed": None}, cand_cols, booths, by_type


def final_distribution(doc):
    """{candidate name: votes} from the results page's 'Votes after distribution' table."""
    for t in doc.xpath("//table"):
        rows = [[clean(c.text_content()) for c in tr] for tr in t.xpath(".//tr")]
        if rows and any("after distribution" in h.lower() for h in rows[0]):
            col = next(i for i, h in enumerate(rows[0]) if "after distribution" in h.lower())
            return {r[0]: num(r[col]) for r in rows[1:] if len(r) > col and r[0] and num(r[col]) is not None}
    return {}


def parse_tcp_page(raw):
    doc = lxml.html.fromstring(raw)
    table = doc.xpath("//table")[0]
    rows = [[clean(c.text_content()) for c in tr] for tr in table.xpath(".//tr")]
    names = [c for c in rows[0][1:3]]
    booths, by_type = {}, {}
    for r in rows[2:]:
        if len(r) < 3 or not r[0] or "total" in r[0].lower() or r[0].lower().startswith("percentage"):
            continue
        votes = [num(r[1]), num(r[2])]
        low = r[0].lower()
        if low in DECLARATION_ROWS:
            by_type[DECLARATION_ROWS[low]] = votes
        else:
            booths[key(r[0])] = votes
    return names, booths, by_type


def wiki_swings():
    """{district name key: {"fp": {candidate key: swing}, "tcp": {candidate key: swing}}}"""
    doc = lxml.html.fromstring(fetch(WIKI_URL, "wikipedia_results_2022.html"))
    for sup in doc.xpath("//sup[contains(@class,'reference')]"):
        sup.drop_tree()
    out = {}
    for t in doc.xpath("//table[contains(@class,'wikitable')]"):
        cap = t.xpath(".//caption")
        m = re.search(r"2022 Victorian state election:\s*(.+)", clean(cap[0].text_content())) if cap else None
        if not m:
            continue
        df = pd.read_html(io.StringIO(lxml.html.tostring(t, encoding="unicode")))[0]
        cols = list(df.columns)
        swings = {"fp": {}, "tcp": {}}
        section = "fp"
        for _, r in df.iterrows():
            cells = [clean(v) for v in r.tolist()]
            joined = " ".join(cells).lower()
            if "two-party-preferred" in joined or "two-candidate-preferred" in joined:
                section = "tcp"
                continue
            cand = cells[cols.index(next(c for c in cols if "Candidate" in str(c)))] if any("Candidate" in str(c) for c in cols) else ""
            sw = re.sub(r"[^\d.+\-−]", "", cells[-1]).replace("−", "-")
            if cand and "votes" not in cand.lower() and sw not in ("", "+", "-"):
                try:
                    swings[section][key(cand)] = float(sw)
                except ValueError:
                    pass
        out[key(m.group(1))] = swings
    return out


def match_swing(swings, vec_name):
    """VEC 'SURNAME, Given' -> Wikipedia 'Given Surname' (match on surname + first given name)."""
    surname, _, given = vec_name.partition(",")
    first = (given.split() or [""])[0]
    for k, v in swings.items():
        if k.endswith(key(surname)) and k.startswith(key(first)[:3]):
            return v
    return next((v for k, v in swings.items() if k.endswith(key(surname))), None)


# ---------------------------------------------------------------- build
def build_district(did, name, page_url, locs, swings, event=None):
    page = fetch(page_url, f"{did}/results.html")
    doc = lxml.html.fromstring(page)
    xls = next(a.get("href") for a in doc.iter("a") if (a.get("href") or "").endswith("Results by Voting Centre.xls"))
    tcp_href = next(a.get("href") for a in doc.iter("a") if "2cp-results-by-voting-centre" in (a.get("href") or ""))
    meta, cand_cols, booths, decl = parse_fp_report(fetch(xls.replace(" ", "%20"), f"{did}/fp.xls"))
    tcp_names, tcp_booths, tcp_decl = parse_tcp_page(fetch(VEC + tcp_href if tcp_href.startswith("/") else tcp_href, f"{did}/tcp.html"))
    # The .xls name is reused per district, so a later by-election can overwrite it. If the
    # 2CP pair isn't among its candidates, use the election's own HTML page instead.
    xls_surnames = {key(c[1].split(",")[0]) for c in cand_cols}
    if not all(key(n.split(",")[0]) in xls_surnames for n in tcp_names):
        fp_href = next((a.get("href") for a in doc.iter("a") if (a.get("href") or "").endswith("-district-results-by-voting-centre")), None)
        if not fp_href:
            raise ValueError(f"{did}: .xls is from another election and there is no HTML results-by-voting-centre page")
        print(f"{did}: .xls holds another election's results; using {fp_href}")
        meta, cand_cols, booths, decl = parse_fp_page(fetch(VEC + fp_href if fp_href.startswith("/") else fp_href, f"{did}/fp.html"))

    candidates = []
    for i, (_, cname, plabel) in enumerate(cand_cols, start=1):
        candidates.append({"id": f"c{i}", "name": cname, "party": party_code(plabel), "party_name": plabel or None,
                           "ballot_position": i, "independent": not plabel, "elected": False})
    ids = [c["id"] for c in candidates]
    by_name = {key(c["name"]): c["id"] for c in candidates}

    def find(n):   # exact name, else a unique surname match ("GROTH, Sam" vs "GROTH, Samuel")
        if key(n) in by_name:
            return by_name[key(n)]
        same = [c["id"] for c in candidates if key(c["name"].split(",")[0]) == key(n.split(",")[0])]
        return same[0] if len(same) == 1 else None
    tcp_ids = [find(n) for n in tcp_names]
    if None in tcp_ids:
        raise ValueError(f"{did}: 2CP candidates {tcp_names} not found in first preferences")

    def fp_map(votes):
        return {cid: v for cid, v in zip(ids, votes) if v is not None}

    places, ordinary = [], {cid: 0 for cid in ids}
    ordinary_tcp = {cid: 0 for cid in tcp_ids}
    for b in booths:
        loc = locs.get((did, key(b["name"]))) or locs.get(("*", key(b["name"]))) or {}
        tcp = tcp_booths.get(key(b["name"]))
        fp = fp_map(b["fp"])
        for cid, v in fp.items():
            ordinary[cid] += v
        if tcp:
            for cid, v in zip(tcp_ids, tcp):
                ordinary_tcp[cid] += v or 0
        places.append({"id": f"{did}-{slug(b['name'])}", "name": b["name"],
                       "classification": loc.get("classification", "VotingCentre"),
                       "lat": loc.get("lat"), "lon": loc.get("lon"),
                       "first_preferences": fp, "formal": sum(fp.values()), "informal": b["informal"], "total": b["total"],
                       "tcp": dict(zip(tcp_ids, tcp)) if tcp else None})

    fp_by_type = {"Ordinary": ordinary, **{t: fp_map(r["fp"]) for t, r in decl.items()}}
    fp_totals = {cid: sum(t.get(cid, 0) for t in fp_by_type.values()) for cid in ids}
    informal = sum(b["informal"] or 0 for b in booths) + sum(r["informal"] or 0 for r in decl.values())
    tcp_by_type = {"Ordinary": ordinary_tcp, **{t: dict(zip(tcp_ids, v)) for t, v in tcp_decl.items()}}
    tcp_totals = {cid: sum(t.get(cid, 0) or 0 for t in tcp_by_type.values()) for cid in tcp_ids}

    # Who was elected comes from the official full distribution of preferences on the
    # results page, not the indicative 2CP count: they can differ (Pakenham's 2CP count
    # had the Liberal ahead; Shepparton's paired the wrong two candidates).
    final = final_distribution(doc)
    final_ids = {find(n): v for n, v in final.items()} if final else {}
    final_ids.pop(None, None)
    winner = max(final_ids, key=final_ids.get) if final_ids else max(tcp_totals, key=tcp_totals.get)
    for c in candidates:
        c["elected"] = c["id"] == winner

    # Wikipedia's 2CP swing is for the final pair (the distribution of preferences), which
    # can differ from the VEC's indicative booth-level 2CP pair (Kew: Wilson v Torney at the
    # booths, Wilson v Skelton in the final count).
    # The distribution stops once someone passes 50%, so its table can list more than two
    # candidates; it's only a final *pair* when exactly two remain.
    sw = swings.get(key(name), {"fp": {}, "tcp": {}})
    final_pair = list(final_ids) if len(final_ids) == 2 else tcp_ids
    swing = {"source": WIKI_URL,
             "first_preferences": {c["id"]: s for c in candidates if (s := match_swing(sw["fp"], c["name"])) is not None},
             "tcp": {cid: s for cid in final_pair if (s := match_swing(sw["tcp"], next(c["name"] for c in candidates if c["id"] == cid))) is not None}}

    return {
        "format": FORMAT,
        "event": {**(event or {"name": "State Election 2022", "date": "2022-11-26"}), "source": page_url},
        "phase": "final",
        "updated": meta["printed"],
        "contest": {"district": did, "name": name, "enrolment": meta["enrolment"], "declared": True},
        "candidates": candidates,
        "first_preferences": {"candidates": fp_totals, "by_type": fp_by_type, "formal": sum(fp_totals.values()),
                              "informal": informal, "total": sum(fp_totals.values()) + informal},
        "tcp": {"candidates": tcp_totals, "by_type": tcp_by_type},
        "distribution": {"candidates": final_ids} if final_ids else None,
        "polling_places": places,
        "swing": swing,
    }


def main():
    districts = json.loads((ROOT / "site/data/districts.json").read_text(encoding="utf-8"))["districts"]
    pages = district_pages()
    locs = locations()
    swings = wiki_swings()
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])   # optional: build just these district ids (a trial run)
    index, problems = {}, []
    for d in sorted(districts, key=lambda d: d["id"]):
        if only and d["id"] not in only:
            continue
        event = None
        if d["id"] in SPECIAL:
            name, url, event = SPECIAL[d["id"]]
        elif d["id"] in pages:
            name, url = pages[d["id"]]
        else:
            problems.append(f"{d['id']}: no VEC 2022 results page")
            continue
        try:
            res = build_district(d["id"], d["name"], url, locs, swings, event)
        except Exception as exc:  # noqa: BLE001 - report and carry on with the other districts
            problems.append(f"{d['id']}: FAILED {type(exc).__name__}: {exc}")
            continue
        (OUT / f"{d['id']}.json").write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")) + "\n",
                                             encoding="utf-8", newline="\n")
        dist = res["distribution"] and res["distribution"]["candidates"]
        pair_final = bool(dist) and len(dist) == 2
        final = dist if pair_final else res["tcp"]["candidates"]
        win = next(c for c in res["candidates"] if c["elected"])
        total = sum(final.values())
        index[d["id"]] = {"winner": win["party"], "winner_name": win["name"],
                          "final": {next(c["party"] for c in res["candidates"] if c["id"] == cid): round(100 * v / total, 2)
                                    for cid, v in final.items()},
                          "booth_tcp_pair_differs": pair_final and set(dist) != set(res["tcp"]["candidates"]),
                          "booths": len(res["polling_places"]),
                          "booths_located": sum(1 for p in res["polling_places"] if p["lat"] is not None),
                          "swing_found": bool(res["swing"]["tcp"])}
        missing = [p["name"] for p in res["polling_places"] if p["lat"] is None]
        if missing:
            problems.append(f"{d['id']}: no location for {missing}")
        if not res["swing"]["tcp"]:
            problems.append(f"{d['id']}: no 2CP swing matched on Wikipedia")
        print(f"{d['id']}: {len(res['polling_places'])} booths, winner {win['party']} {index[d['id']]['final']}")
    (OUT / "index.json").write_text(json.dumps({"_schema": SCHEMA, "source": "VEC 2022 results by voting centre; swings from Wikipedia",
                                                "districts": index}, ensure_ascii=False, indent=1) + "\n",
                                     encoding="utf-8", newline="\n")
    print(f"\n{len(index)} districts written")
    print("\n".join(problems) or "no problems")


if __name__ == "__main__":
    main()
