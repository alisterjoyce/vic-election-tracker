"""List the candidates in some districts or regions who don't have a profile yet.

Candidates are every active row in site/data/candidates.json (not withdrawn or superseded) plus every
name on a regions.json ticket, keyed by candidate id ('<seat>/<slug of Given Surname>', the same id
as App.candidateId and build_headshots.py). Profiles are site/data/profiles.json.

Usage:
    python scripts/profile_seats.py bendigo-west northern-victoria   # these seats
    python scripts/profile_seats.py --all                            # every seat
    python scripts/profile_seats.py --all --summary                  # counts only
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "site" / "data"
INACTIVE = {"withdrawn", "superseded"}
PLACEHOLDER = re.compile(r"^TB[CD]$", re.I)   # ticket slots not yet filled (App.isPlaceholder)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).strip("-")


def given_first(name):
    """'SURNAME, Given' -> 'Given SURNAME'; other names unchanged (as in build_headshots.py)."""
    if "," in name:
        sur, _, given = name.partition(",")
        return f"{given.strip()} {sur.strip()}"
    return name


def candidate_id(seat, name):
    return f"{seat}/{slug(given_first(name))}"


def load(name):
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


def candidates_by_seat():
    """{seat id: {candidate id: (name, party)}} for every active candidacy."""
    seats = {}
    for c in load("candidates")["candidates"]:
        seat = c.get("district") or c.get("region")
        if seat and c.get("status") not in INACTIVE and not PLACEHOLDER.match(c["name"].strip()):
            seats.setdefault(seat, {})[candidate_id(seat, c["name"])] = (c["name"], c.get("party") or "")
    for r in load("regions")["regions"]:
        for t in r.get("tickets") or []:
            if t.get("status") in INACTIVE:
                continue
            for n in t.get("candidates") or []:
                if PLACEHOLDER.match(n.strip()):
                    continue
                seats.setdefault(r["id"], {}).setdefault(candidate_id(r["id"], n), (n, t.get("party") or ""))
    return seats


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("seats", nargs="*", help="district or region ids (as in districts.json / regions.json)")
    ap.add_argument("--all", action="store_true", help="every district and region")
    ap.add_argument("--summary", action="store_true", help="print counts only")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    names = {d["id"]: d["name"] for d in load("districts")["districts"]}
    names |= {r["id"]: f"{r['name']} Region" for r in load("regions")["regions"]}
    seats = candidates_by_seat()
    profiles = load("profiles").get("profiles", {})
    wanted = sorted(names) if args.all else args.seats
    unknown = [s for s in wanted if s not in names]
    if unknown or not wanted:
        ap.error(f"unknown seat id(s): {', '.join(unknown)}" if unknown else "name some seats, or use --all")

    total = done = 0
    for seat in wanted:
        cands = seats.get(seat, {})
        missing = {cid: v for cid, v in cands.items() if cid not in profiles}
        total += len(cands)
        done += len(cands) - len(missing)
        if args.summary:
            continue
        print(f"{names[seat]} ({seat}): {len(cands) - len(missing)} of {len(cands)} profiled")
        for cid, (name, party) in sorted(missing.items(), key=lambda kv: (kv[1][1], kv[1][0])):
            print(f"  {party:5} {name}  [{cid}]")
    print(f"{done} of {total} candidates profiled ({100 * done / total:.0f}%)" if total else "No candidates in those seats.")


if __name__ == "__main__":
    main()
