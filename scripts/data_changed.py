"""Print "changed" if site/data differs from the last commit in anything beyond refresh bookkeeping,
else "unchanged". The refresh workflow commits (and deploys) only on "changed", so a run in which
every source failed (only status messages moved) doesn't make a commit.

Bookkeeping that doesn't count: meta.json's per-source status, news.json's updated time and per-feed
status, changelog.json's updated time, htv.json's last_checked and vec_nominations.json's fetched time. meta.json's last_updated does count:
refresh.py sets it on every successful run and the site shows it ("Data updated ..."), so every
successful run is committed and deployed. A run where every source failed leaves it alone and isn't.
Any other difference, or a file that can't be compared, counts as a change (so a real update is never lost).

Usage: python scripts/data_changed.py [--data-dir site/data]
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOLATILE = {   # top-level keys that change on every successful run
    "meta.json": {"sources"},
    "news.json": {"updated", "sources"},
    "changelog.json": {"updated"},
    "htv.json": {"last_checked"},
    "vec_nominations.json": {"fetched"},
}


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")


def committed(path):
    r = git("show", f"HEAD:{path.relative_to(ROOT).as_posix()}")
    return r.stdout if r.returncode == 0 else None


def same(path, before, after):
    skip = VOLATILE.get(path.name)
    if not skip:
        return False
    try:
        a, b = json.loads(before), json.loads(after)
    except ValueError:
        return False
    strip = lambda d: {k: v for k, v in d.items() if k not in skip} if isinstance(d, dict) else d
    return strip(a) == strip(b)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", type=Path, default=ROOT / "site" / "data")
    args = ap.parse_args()
    status = git("status", "--porcelain", "--untracked-files=all", "--", str(args.data_dir.resolve()))
    if status.returncode != 0:
        print("changed")   # can't tell: let the workflow commit
        return 0
    changed = []
    for line in status.stdout.splitlines():
        path = ROOT / line[3:].strip().strip('"')
        before = committed(path)
        if before is None or not path.exists() or not same(path, before, path.read_text(encoding="utf-8")):
            changed.append(path.relative_to(ROOT).as_posix())
    print("changed" if changed else "unchanged")
    for p in changed:
        print(f"  {p}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
