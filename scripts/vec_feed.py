#!/usr/bin/env python3
"""Convert a VEC media-feed results file (Legislative Assembly) into the
vec-contest-v1 JSON used by site/data/results_2022/, so election night can
reuse the same booth map and result panels.

Works with "verbose" files on their own, or "lite" files plus the setup
candidates file. The setup polling-locations file adds booth coordinates.
Element namespaces differ between file types, so matching is on local names.

    python scripts/vec_feed.py --result <mediafile...lh...zip|xml> \
        [--candidates <...CandidatesV2.xml>] [--locations <...PollingLocationsV2.xml>] --out site/data/results_2026
    python scripts/vec_feed.py --selftest <folder of VEC sample files>

The live feed is only available under the VEC's terms of use; keep feed files
out of the repository.
"""
import argparse
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from results_format import FORMAT, VOTE_TYPES, party_code  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------- XML helpers (namespace-agnostic)
def ln(el):
    return el.tag.rsplit("}", 1)[-1]


def kids(el, name):
    return [c for c in el if ln(c) == name] if el is not None else []


def kid(el, name):
    found = kids(el, name)
    return found[0] if found else None


def path(el, *names):
    for n in names:
        el = kid(el, n)
        if el is None:
            return None
    return el


def text(el, default=None):
    return el.text.strip() if el is not None and el.text and el.text.strip() else default


def intval(el):
    t = text(el)
    return int(t) if t is not None and re.fullmatch(r"-?\d+", t) else None


def read_xml(p):
    p = Path(p)
    if p.suffix.lower() == ".zip":
        with zipfile.ZipFile(p) as z:
            return ET.fromstring(z.read(z.namelist()[0]))
    return ET.parse(p).getroot()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def district_id(name):
    return slug(re.sub(r"\s+District$", "", name or ""))


# ---------------------------------------------------------------- setup files
def parse_locations(root):
    """Polling place id -> {lat, lon, classification, name}"""
    out = {}
    for pp in root.iter():
        if ln(pp) != "PollingPlace":
            continue
        ident = kid(pp, "PollingPlaceIdentifier")
        if ident is None:
            continue
        addr = kid(pp, "Address")
        lat, lon = text(kid(addr, "AddressLatitude")), text(kid(addr, "AddressLongitude"))
        out[ident.get("Id")] = {"name": ident.get("Name"), "classification": ident.get("Classification"),
                                "lat": float(lat) if lat else None, "lon": float(lon) if lon else None}
    return out


def parse_candidates(root):
    """Candidate id -> {name, party_name, independent, ballot_position}"""
    out = {}
    for c in root.iter():
        if ln(c) != "Candidate":
            continue
        ident = kid(c, "CandidateIdentifier")
        if ident is None or text(kid(ident, "CandidateName")) is None:
            continue
        aff = path(c, "Affiliation", "AffiliationIdentifier")
        out[ident.get("Id")] = {"name": text(kid(ident, "CandidateName")),
                                "party_name": text(kid(aff, "RegisteredName")),
                                "independent": c.get("Independent") == "yes",
                                "ballot_position": intval(kid(c, "BallotPosition"))}
    return out


# ---------------------------------------------------------------- results
def votes_by_type(el):
    out = {}
    for v in kids(kid(el, "VotesByType"), "Votes"):
        n = intval(v)
        if n is not None:
            out[v.get("Type")] = n
    return out


def candidate_votes(block):
    """{candidate id: votes} and {type: {candidate id: votes}} from a FirstPreferences/TwoCandidatePreferred block."""
    totals, by_type = {}, {}
    for c in kids(block, "Candidate"):
        cid = kid(c, "CandidateIdentifier").get("Id")
        totals[cid] = intval(kid(c, "Votes")) or 0
        for t, n in votes_by_type(c).items():
            by_type.setdefault(t, {})[cid] = n
    return totals, by_type


def convert(result_root, candidates=None, locations=None):
    """{district id: vec-contest-v1 dict} for every Assembly contest in the file."""
    candidates, locations = candidates or {}, locations or {}
    event = result_root.find(".//{*}EventIdentifier")
    out = {}
    for contest in result_root.iter():
        if ln(contest) != "Contest":
            continue
        name = text(path(contest, "PollingDistrictIdentifier", "Name")) or text(path(contest, "ContestIdentifier", "ContestName"))
        did = district_id(name)
        fp_block = kid(contest, "FirstPreferences")
        cand_list = []
        for c in kids(fp_block, "Candidate"):
            ident = kid(c, "CandidateIdentifier")
            cid = ident.get("Id")
            setup = candidates.get(cid, {})
            aff = path(c, "Affiliation", "AffiliationIdentifier")
            party_name = text(kid(aff, "RegisteredName")) or setup.get("party_name")
            independent = c.get("Independent") == "yes" if c.get("Independent") else setup.get("independent", False)
            cand_list.append({"id": cid, "name": text(kid(ident, "CandidateName")) or setup.get("name"),
                              "party": party_code(party_name, independent), "party_name": party_name,
                              "ballot_position": intval(kid(c, "BallotPosition")) or setup.get("ballot_position"),
                              "independent": independent, "elected": text(kid(c, "Elected")) == "true"})
        fp_totals, fp_by_type = candidate_votes(fp_block)
        tcp_block = kid(contest, "TwoCandidatePreferred")
        tcp = None
        if tcp_block is not None and kids(tcp_block, "Candidate"):
            tcp_totals, tcp_by_type = candidate_votes(tcp_block)
            tcp = {"candidates": tcp_totals, "by_type": tcp_by_type}

        places = []
        for pp in kids(kid(contest, "PollingPlaces"), "PollingPlace"):
            ident = kid(pp, "PollingPlaceIdentifier")
            pid = ident.get("Id")
            loc = locations.get(pid, {})
            pfp = kid(pp, "FirstPreferences")
            ptcp = kid(pp, "TwoCandidatePreferred")
            fp, _ = candidate_votes(pfp) if pfp is not None else ({}, {})
            places.append({"id": pid, "name": ident.get("Name") or loc.get("name"),
                           "classification": ident.get("Classification") or loc.get("classification"),
                           "lat": loc.get("lat"), "lon": loc.get("lon"),
                           "first_preferences": fp,
                           "formal": intval(path(pfp, "Formal", "Votes")) if pfp is not None else None,
                           "informal": intval(path(pfp, "Informal", "Votes")) if pfp is not None else None,
                           "total": intval(path(pfp, "Total", "Votes")) if pfp is not None else None,
                           "tcp": candidate_votes(ptcp)[0] if ptcp is not None and kids(ptcp, "Candidate") else None})

        out[did] = {
            "format": FORMAT,
            "event": {"name": text(kid(event, "EventName")), "date": None, "source": "VEC media feed"},
            "phase": result_root.get("Phase"),
            "updated": contest.get("Updated") or result_root.get("Created"),
            "contest": {"district": did, "name": re.sub(r"\s+District$", "", name or ""),
                        "enrolment": intval(kid(contest, "Enrolment")), "declared": text(kid(contest, "Declared")) == "true"},
            "candidates": cand_list,
            "first_preferences": {"candidates": fp_totals,
                                  "by_type": {t: fp_by_type[t] for t in VOTE_TYPES if t in fp_by_type},
                                  "formal": intval(path(fp_block, "Formal", "Votes")),
                                  "informal": intval(path(fp_block, "Informal", "Votes")),
                                  "total": intval(path(fp_block, "Total", "Votes"))},
            "tcp": tcp,
            "distribution": None,   # the feed carries the indicative 2CP only; the final count is published later
            "polling_places": places,
        }
    return out


# ---------------------------------------------------------------- self-test against the VEC samples
def selftest(folder):
    folder = Path(folder)
    cands = parse_candidates(read_xml(next(folder.glob("*Candidates*.xml"))))
    locs = parse_locations(read_xml(next(folder.glob("*PollingLocations*.xml"))))
    reference = json.loads(next((ROOT / "site/data/results_2022").glob("bass.json")).read_text(encoding="utf-8"))
    ref_keys = set(reference) - {"swing"}
    ref_place_keys = set(reference["polling_places"][0])
    files = sorted(folder.glob("*mediafile*lhv2_*.zip"))
    checked = 0
    for f in files:
        res = convert(read_xml(f), cands, locs)
        for did, c in res.items():
            assert set(c) == ref_keys, (f.name, did, set(c) ^ ref_keys)
            for p in c["polling_places"]:
                assert set(p) == ref_place_keys, (f.name, did, set(p) ^ ref_place_keys)
            fp = c["first_preferences"]
            if fp["formal"] is not None and fp["candidates"]:
                assert sum(fp["candidates"].values()) == fp["formal"], (f.name, did, "fp sum != formal")
            for p in c["polling_places"]:
                if p["formal"] is not None and p["first_preferences"]:
                    assert sum(p["first_preferences"].values()) == p["formal"], (f.name, did, p["name"])
            assert all(c2["name"] for c2 in c["candidates"]), (f.name, did, "candidate without a name")
            checked += 1
    last = convert(read_xml(files[-1]), cands, locs)
    print(f"selftest ok: {len(files)} files, {checked} contests; keys match results_2022; "
          f"final file declared: {sum(c['contest']['declared'] for c in last.values())}/{len(last)}; "
          f"elected: {[next((x['party'] for x in c['candidates'] if x['elected']), None) for c in last.values()]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--result")
    ap.add_argument("--candidates")
    ap.add_argument("--locations")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--selftest")
    a = ap.parse_args()
    if a.selftest:
        return selftest(a.selftest)
    res = convert(read_xml(a.result), parse_candidates(read_xml(a.candidates)) if a.candidates else None,
                  parse_locations(read_xml(a.locations)) if a.locations else None)
    a.out.mkdir(parents=True, exist_ok=True)
    for did, c in res.items():
        (a.out / f"{did}.json").write_text(json.dumps(c, ensure_ascii=False, separators=(",", ":")) + "\n",
                                           encoding="utf-8", newline="\n")
    print(f"{len(res)} contests written to {a.out}")


if __name__ == "__main__":
    main()
