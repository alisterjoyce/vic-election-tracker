"""Check candidate profiles against the rules in CLAUDE.md ("Candidate profiles").

Checks every profile in site/data/profiles.json (or a batch file of {candidate id: profile}):
  - known candidate id (an active candidacy in candidates.json or a regions.json ticket);
  - fields and types match the _schema; every fact has src numbers that exist in its sources;
  - each source has a url, title and accessed date (YYYY-MM-DD); every source is cited;
  - summary is 2-4 sentences; at most 5 priorities; quoted priorities under 15 words;
  - born is a year only; no full dates of birth anywhere;
  - links and source urls are https.
With --overlap it also fetches each profile's Wikipedia and Parliament of Victoria pages (one request
a second) and flags any run of 8 or more words copied from them, so text stays in our own words.

Usage:
    python scripts/check_profiles.py                       # site/data/profiles.json
    python scripts/check_profiles.py batch.json --overlap  # a research batch, with the copy check
Exit status 1 if anything fails.
"""
import argparse
import hashlib
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from profile_seats import candidates_by_seat, load   # noqa: E402

FACTS = {"born": "year", "lives": "place", "occupation": "text", "faction": "name"}
ROLE_KINDS = {"mp", "minister", "shadow", "councillor", "mayor", "staffer", "union", "business", "party",
              "public-service", "community", "other"}
RESULTS = {"Won", "Lost", "Retained", "Withdrew", "Unknown"}
LINK_KEYS = {"website", "party_page", "abc", "wikipedia", "parliament", "facebook", "instagram", "x", "linkedin"}
UA = "vic-election-tracker/1.0 (profile copy check; +https://alisterjoyce.github.io/vic-election-tracker/)"
CACHE = Path(__file__).resolve().parent.parent / ".cache" / "profile_check"   # git-ignored; pages fetched once a day
FULL_DATE = re.compile(r"\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) (19|20)\d\d\b")


def words(s):
    return re.findall(r"[a-z0-9']+", s.lower())


def fetch_text(url):
    """The page's text, from .cache/profile_check when fetched today; politely retried on 429/503."""
    import datetime
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"{hashlib.sha1(url.encode()).hexdigest()}-{datetime.date.today().isoformat()}.txt"
    if cached.exists():
        raw = cached.read_text(encoding="utf-8")
    else:
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=30) as r:
                    raw = r.read().decode("utf-8", "replace")
                time.sleep(1)   # one request a second
                break
            except urllib.error.HTTPError as exc:
                if exc.code not in (429, 503) or attempt == 3:
                    raise
                time.sleep(int(exc.headers.get("Retry-After") or 0) or 5 * 2 ** attempt)
        cached.write_text(raw, encoding="utf-8")
    if "wikipedia.org/w/api.php" in url:
        pages = json.loads(raw)["query"]["pages"]
        return " ".join(p.get("extract", "") for p in pages.values())
    raw = re.sub(r"<(script|style)\b.*?</\1>", " ", raw, flags=re.S)
    return html.unescape(re.sub(r"<[^>]+>", " ", raw))


def check(cid, p, known, errors):
    err = lambda m: errors.append(f"{cid}: {m}")
    if cid not in known:
        err("not an active candidacy (check the id: <contested seat>/<slug of Given Surname>)")
    ids = {s.get("id") for s in p.get("sources", [])}
    cited = set()

    def src(field, f):
        s = f.get("src") if isinstance(f, dict) else None
        if not s or not isinstance(s, list):
            err(f"{field}: no src")
            return
        for n in s:
            if n not in ids:
                err(f"{field}: src {n} isn't in sources")
            cited.add(n)
        if f.get("unverified") and not f.get("note"):
            err(f"{field}: unverified without a note")

    if not p.get("name"):
        err("no name")
    summary = (p.get("summary") or {}).get("text", "")
    n_sent = len(re.findall(r"[.!?](\s|$)", summary.strip()))
    if not 2 <= n_sent <= 4:
        err(f"summary has {n_sent} sentences (2-4)")
    src("summary", p.get("summary") or {})
    for k, v in FACTS.items():
        f = p.get(k)
        if f is None:
            continue
        if not isinstance(f, dict) or f.get(v) in (None, ""):
            err(f"{k}: expected {{{v}, src}} or null")
            continue
        src(k, f)
    if p.get("born") and not (isinstance(p["born"].get("year"), int) and 1920 <= p["born"]["year"] <= 2008):
        err("born.year must be a year (integer)")
    for i, r in enumerate(p.get("prior_roles") or []):
        if not r.get("role") or r.get("kind") not in ROLE_KINDS:
            err(f"prior_roles[{i}]: needs role and kind in {sorted(ROLE_KINDS)}")
        if "ended" in r and not isinstance(r["ended"], bool):
            err(f"prior_roles[{i}].ended must be true or false")
        if r.get("ended") and r.get("to") is not None:
            err(f"prior_roles[{i}]: ended is only for a role with no known end year (to: null)")
        for y in ("from", "to"):
            if r.get(y) is not None and not isinstance(r[y], int):
                err(f"prior_roles[{i}].{y} must be a year or null")
        src(f"prior_roles[{i}]", r)
    for i, r in enumerate(p.get("previous_candidacies") or []):
        if not (r.get("election") and r.get("seat") and r.get("party")) or r.get("result") not in RESULTS:
            err(f"previous_candidacies[{i}]: needs election, seat, party and result in {sorted(RESULTS)}")
        src(f"previous_candidacies[{i}]", r)
    pri = p.get("priorities") or []
    if len(pri) > 5:
        err("more than 5 priorities")
    for i, x in enumerate(pri):
        if not x.get("text") or not isinstance(x.get("quoted"), bool):
            err(f"priorities[{i}]: needs text and quoted (true/false)")
        elif x["quoted"] and len(x["text"].split()) >= 15:
            err(f"priorities[{i}]: a quote must be under 15 words")
        src(f"priorities[{i}]", x)
    for k, u in (p.get("links") or {}).items():
        if k not in LINK_KEYS:
            err(f"links.{k}: unknown key")
        elif not str(u).startswith("https://"):
            err(f"links.{k}: not an https url")
    for k, f in (p.get("contact") or {}).items():
        if k not in ("email", "phone") or not isinstance(f, dict) or not f.get("value") or not f.get("kind"):
            err(f"contact.{k}: expected {{value, kind, src}}")
        else:
            src(f"contact.{k}", f)
    for s in p.get("sources", []):
        if not (isinstance(s.get("id"), int) and str(s.get("url", "")).startswith("https://") and s.get("title")
                and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(s.get("accessed", "")))):
            err(f"source {s.get('id')}: needs integer id, https url, title, accessed YYYY-MM-DD")
    for n in sorted(ids - cited, key=str):
        err(f"source {n} is never cited")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(p.get("profile_updated", ""))):
        err("profile_updated must be YYYY-MM-DD")
    if FULL_DATE.search(json.dumps(p)):
        err("contains a full date of birth or other full date in text: store the year only")


def own_words(cid, p, errors, n=8):
    """Flag any n-word run copied from the profile's Wikipedia or Parliament page."""
    ours = " ".join([(p.get("summary") or {}).get("text", "")] + [x.get("text", "") for x in p.get("priorities") or [] if not x.get("quoted")]
)   # role titles are facts (e.g. "Minister for Sport"), so they aren't checked
    mine = words(ours)
    grams = {" ".join(mine[i:i + n]) for i in range(len(mine) - n + 1)}
    links = p.get("links") or {}
    urls = []
    if links.get("wikipedia"):
        title = urllib.parse.unquote(links["wikipedia"].rsplit("/", 1)[-1])
        urls.append("https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles=" + urllib.parse.quote(title))
    if links.get("parliament"):
        urls.append(links["parliament"])
    for u in urls:
        try:
            theirs = words(fetch_text(u))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{cid}: couldn't fetch {u} for the copy check: {exc}")
            continue
        source = " ".join(theirs)
        for g in sorted(grams):
            if f" {g} " in f" {source} ":
                errors.append(f"{cid}: copied wording from {u.split('?')[0]}: \"{g}\"")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", nargs="?", help="a batch file of {candidate id: profile} (default: site/data/profiles.json)")
    ap.add_argument("--overlap", action="store_true", help="also check for wording copied from Wikipedia and Parliament pages")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    data = json.loads(Path(args.file).read_text(encoding="utf-8")) if args.file else load("profiles")
    profiles = data.get("profiles", data) if isinstance(data, dict) else {}
    profiles = {k: v for k, v in profiles.items() if not k.startswith("_")}
    known = {cid for seat in candidates_by_seat().values() for cid in seat}
    errors = []
    for cid, p in profiles.items():
        check(cid, p, known, errors)
        if args.overlap:
            own_words(cid, p, errors)
    for e in errors:
        print("FAIL", e)
    print(f"{len(profiles)} profiles checked, {len(errors)} problems")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
