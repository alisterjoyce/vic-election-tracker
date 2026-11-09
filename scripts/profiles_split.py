"""Split site/data/profiles.json into one file per seat, so a candidate's page downloads only its seat's profiles.

profiles.json (all 1,000+ profiles, ~2.8 MB) stays the file that research, refresh.py and the checks read and
write, and the full download on /data/. The candidate page reads data/profiles/<seat id>.json instead: the
profiles of the candidates contesting that district or region (a candidate id is '<seat id>/<name slug>').
data/profiles/index.json lists every profiled id, for the Data page's completeness count.

These files are generated: never edit them by hand. refresh.py rewrites them whenever it writes profiles.json
and on every run (write_split), and check_profiles.py fails while they are out of step with profiles.json.
After editing profiles.json by hand, run:

    python scripts/profiles_split.py            # write data/profiles/ from data/profiles.json
    python scripts/profiles_split.py --check    # exit 1 if data/profiles/ is out of date
"""
import argparse
import json
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "site" / "data"
SEAT_ID = re.compile(r"^[a-z0-9-]+$")

SEAT_SCHEMA = {
    "description": "One seat's researched candidate profiles: the entries of profiles.json whose candidate id starts "
                   "with this seat's id. Generated from profiles.json by scripts/profiles_split.py; edit profiles.json, "
                   "never this file. The fields of each profile are those listed in profiles.json's _schema.",
    "fields": {
        "seat": "District or region id",
        "profiles": "{candidate id: profile}, exactly as in profiles.json",
    },
}
INDEX_SCHEMA = {
    "description": "Which candidates have a researched profile, and in which seat file (profiles/<seat>.json). "
                   "Generated from profiles.json by scripts/profiles_split.py.",
    "fields": {
        "count": "Number of profiles",
        "seats": "{seat id: number of profiles in profiles/<seat id>.json}",
        "ids": "Every profiled candidate id, sorted",
    },
}


def _dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def render(doc: dict) -> dict[str, str]:
    """{file name: text} for data/profiles/, from profiles.json's document. One profile per line, so a change to
    one profile is a one-line diff."""
    profiles = {k: v for k, v in (doc.get("profiles") or {}).items() if not k.startswith("_")}
    by_seat: dict[str, dict] = {}
    for cid in sorted(profiles):
        seat = cid.split("/", 1)[0]
        if not SEAT_ID.match(seat) or "/" not in cid:
            raise ValueError(f"profile id {cid!r} is not '<seat id>/<name slug>'")
        by_seat.setdefault(seat, {})[cid] = profiles[cid]
    files = {}
    for seat, entries in by_seat.items():
        lines = ",\n".join(f"{_dump(cid)}:{_dump(p)}" for cid, p in entries.items())
        files[f"{seat}.json"] = f'{{"_schema":{_dump(SEAT_SCHEMA)},\n"seat":{_dump(seat)},\n"profiles":{{\n{lines}\n}}}}\n'
    index = {"_schema": INDEX_SCHEMA, "count": len(profiles), "seats": {s: len(e) for s, e in by_seat.items()},
             "ids": sorted(profiles)}
    files["index.json"] = json.dumps(index, ensure_ascii=False, indent=1) + "\n"
    return files


def _plan(data_dir: Path, doc: dict | None):
    if doc is None:
        doc = json.loads((data_dir / "profiles.json").read_text(encoding="utf-8"))
    out_dir = data_dir / "profiles"
    want = render(doc)
    have = {p.name: p for p in out_dir.glob("*.json")} if out_dir.is_dir() else {}
    stale = [n for n, text in want.items() if n not in have or have[n].read_text(encoding="utf-8") != text]
    extra = sorted(set(have) - set(want))
    return out_dir, want, stale, extra


def write_split(data_dir: Path = DATA, doc: dict | None = None) -> list[str]:
    """Bring data/profiles/ into line with profiles.json (or `doc`, its contents). Writes only files whose text
    changed and deletes seat files with no profiles left. Returns the names written or removed."""
    out_dir, want, stale, extra = _plan(data_dir, doc)
    out_dir.mkdir(exist_ok=True)
    for name in stale:
        (out_dir / name).write_text(want[name], encoding="utf-8", newline="\n")
    for name in extra:
        (out_dir / name).unlink()
    return stale + extra


def check_split(data_dir: Path = DATA, doc: dict | None = None) -> list[str]:
    """The data/profiles/ files that don't match profiles.json (missing, different or left over)."""
    _, _, stale, extra = _plan(data_dir, doc)
    return stale + extra


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", type=Path, default=DATA)
    ap.add_argument("--check", action="store_true", help="report files out of date and exit 1; write nothing")
    args = ap.parse_args()
    if args.check:
        bad = check_split(args.data_dir)
        print(f"profiles/: {len(bad)} files out of date" + (f": {', '.join(bad[:10])}{' ...' if len(bad) > 10 else ''}" if bad else ""))
        return 1 if bad else 0
    changed = write_split(args.data_dir)
    print(f"profiles/: {len(changed)} files written or removed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
