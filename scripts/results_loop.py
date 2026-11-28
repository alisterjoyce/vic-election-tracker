"""Election-night results loop, run on a computer (not GitHub): a fast pass every 2 minutes, a slow pass every 5th cycle.

Fast pass: each district's results page only (its first-preference and 2CP summary), up to 4 requests at a time, and
only districts whose page changed are rebuilt; the booth (voting-centre) figures come from the last slow pass.
Slow pass: the booth pages of every district whose page changed since its booths were last read, and the eight
region pages. The VEC sends no ETag or Last-Modified (Cache-Control: no-store), so "changed" is a hash of each page.

After each cycle the results files (and nothing else) are committed if the results changed, rebased onto main
(results win a conflict) and pushed; the push deploys the site. Each cycle is logged to .cache/results_loop.log:
time taken, pages fetched, files changed, seats with votes, leaders.

    python scripts/results_loop.py                 # until stopped
    python scripts/results_loop.py --once --slow   # one cycle, for testing
Stop: Ctrl+C, or create .cache/results_loop.stop (the loop exits before its next cycle).
"""
from __future__ import annotations

import argparse
import logging
import pickle
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import results as R  # noqa: E402

ROOT = R.ROOT
CACHE_DIR = ROOT / ".cache"
SUB_CACHE = CACHE_DIR / "results_sub.pkl"
STOP = CACHE_DIR / "results_loop.stop"
LOG = CACHE_DIR / "results_loop.log"
FILES = ["site/data/results.json", "site/data/results_lc.json", "site/data/results_2026"]
INTERVAL, SLOW_EVERY, WORKERS = 120, 5, 4
log = logging.getLogger("results_loop")


def git(*args, check=False):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=check)


def publish() -> str:
    """Commit the results files if the results (not just _fetch.json) changed; rebase onto main and push."""
    git("add", "--", *FILES)
    if git("diff", "--cached", "--quiet", "--", "site/data/results.json", "site/data/results_lc.json",
           ":(glob)site/data/results_2026/[!_]*").returncode == 0:
        git("reset", "-q", "--", *FILES)
        return "no results change"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    c = git("commit", "-q", "-m", f"Results {stamp} (local loop)", "--", *FILES)
    if c.returncode:
        return f"commit failed: {c.stderr.strip()[:200]}"
    for attempt in range(1, 4):
        p = git("pull", "-q", "--rebase", "--autostash", "-X", "theirs", "origin", "main")
        if p.returncode:
            git("rebase", "--abort")
            log.warning("pull --rebase failed (attempt %d): %s", attempt, p.stderr.strip()[:300])
            time.sleep(5)
            continue
        if git("push", "-q", "origin", "HEAD:main").returncode == 0:
            return f"pushed {git('rev-parse', '--short', 'HEAD').stdout.strip()}"
        time.sleep(5)
    return "push failed (the next cycle retries)"


def cycle(n: int, slow: bool) -> dict:
    cache = {}
    if SUB_CACHE.exists():
        try:
            cache = pickle.loads(SUB_CACHE.read_bytes())
        except Exception:  # noqa: BLE001 - a broken cache just means a full read
            cache = {}
    if not cache:
        slow = True   # nothing cached yet: booths must be read once
    git("pull", "-q", "--rebase", "--autostash", "-X", "theirs", "origin", "main")
    cfg = R.load_config(None)
    stats = {}
    t0 = time.monotonic()
    R.run(cfg, R.DEFAULT_DATA_DIR, fast=not slow, workers=WORKERS, sub_cache=cache, stats=stats)
    took = time.monotonic() - t0
    SUB_CACHE.write_bytes(pickle.dumps(cache))
    pushed = publish()
    t = stats.get("tally") or {}
    res = R.read_json(R.DEFAULT_DATA_DIR / "results.json", {}) or {}
    leaders = sorted(((s.get("counted_pct") or 0, did, s) for did, s in (res.get("districts") or {}).items() if s.get("leader")),
                     reverse=True)
    line = (f"cycle {n} {'slow' if slow else 'fast'}: {took:.0f}s, {stats.get('fetched', 0)} pages fetched, "
            f"changed {stats.get('changed') or 'nothing'}, {stats.get('with_votes', 0)} seats with votes, "
            f"called {t.get('called')}, leading {t.get('leading')}, skipped {len(stats.get('skipped') or [])}; {pushed}")
    log.info(line)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.now().astimezone().strftime('%H:%M:%S')} {line}\n")
    return {"took": took, "line": line, "leaders": leaders}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--once", action="store_true", help="one cycle, then stop")
    ap.add_argument("--slow", action="store_true", help="with --once: a slow pass")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    CACHE_DIR.mkdir(exist_ok=True)
    STOP.unlink(missing_ok=True)
    n = 0
    while True:
        start = time.monotonic()
        try:
            cycle(n, slow=a.slow if a.once else n % SLOW_EVERY == 0)
        except Exception as exc:  # noqa: BLE001 - never let one bad cycle end the night
            log.exception("cycle %d failed: %s", n, exc)
        if a.once:
            return 0
        n += 1
        while time.monotonic() - start < INTERVAL:
            if STOP.exists():
                log.info("Stop file found: stopping.")
                return 0
            time.sleep(2)
        if STOP.exists():
            return 0


if __name__ == "__main__":
    sys.exit(main())
