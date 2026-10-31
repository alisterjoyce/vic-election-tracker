#!/usr/bin/env python3
"""Build candidate headshots from a research zip.

Reads the zip's PHOTO_INDEX.txt (file, candidate, seat, party, image URL, source pages,
notes), matches each photo to a tracker candidate, crops it square, and writes
    site/photos/320/<seat>--<name>.webp and site/photos/160/<seat>--<name>.webp  (each < 25 KB)
    site/data/headshots.json
The original images never enter the repository.

Matching never guesses. A photo is matched only to a candidate in the same seat with
the exact same name (ignoring case, accents and punctuation), or a unique near-identical
spelling (reported as "near"). Anything else, including two candidates with the same
surname, is listed for a person to resolve in scripts/headshot_overrides.json:
    {"<file path inside the zip>": "<candidate id>"}   to match by hand
    {"<file path inside the zip>": null}               to skip a photo

Candidate ids are "<district or region id>/<slug of 'Given Surname'>", the same as
App.candidateId() in site/js/common.js.

    pip install pillow   (AVIF needs Pillow 11.2+)
    python scripts/build_headshots.py <zip> [--publish all|non-abc|none]
"""
import argparse
import difflib
import io
import json
import re
import sys
import unicodedata
import zipfile
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site" / "data"
PHOTOS = ROOT / "site" / "photos"
OVERRIDES = Path(__file__).resolve().parent / "headshot_overrides.json"
SOURCES = Path(__file__).resolve().parent / "headshot_sources.json"   # provenance the site doesn't load
SIZES = (320, 160)
MAX_BYTES = 25 * 1024

PARTY = [("one nation", "ONP"), ("victorian socialists", "VS"), ("socialist alliance", "SAL"), ("animal justice", "AJP"),
         ("family first", "FF"), ("legalise cannabis", "LCV"), ("libertarian", "LBT"), ("liberal", "LIB"), ("national", "NAT"),
         ("green", "GRN"), ("labor", "ALP"), ("independent", "IND"), ("west", "WEST"), ("new democrats", "ND"),
         ("sustainable", "SUS"), ("shooters", "SFF"), ("democratic labour", "DLP"), ("coalition", "LNP")]

# Source pages in the index that have since gone dead, mapped to a live page showing the same photo (checked by hand).
PAGE_FIXES = {
    # The West Party's own candidate list links to this profile, but it returns 404.
    "https://thewestparty.org.au/local-representation/brucelancashire": "https://thewestparty.org.au/local-representation/",
}

# Source page host -> credit name (falls back to the host itself)
CREDITS = {
    "abc.net.au": "ABC News", "vicliberal.org.au": "Liberal Party Victoria", "greens.org.au": "Australian Greens",
    "victoriansocialists.org.au": "Victorian Socialists", "animaljusticeparty.org": "Animal Justice Party",
    "nationals.org.au": "The Nationals Victoria", "viclabor.com.au": "Victorian Labor", "parliament.vic.gov.au": "Parliament of Victoria",
    "onenation.org.au": "Pauline Hanson's One Nation", "familyfirst.org.au": "Family First",
    "socialist-alliance.org": "Socialist Alliance", "thewestparty.org.au": "The West Party",
    "viclabor.org.au": "Victorian Labor", "familyfirstparty.org.au": "Family First", "libertarians.org.au": "Libertarian Party",
    "lcvicparty.org.au": "Legalise Cannabis Victoria", "sustainableaustralia.org.au": "Sustainable Australia",
    "newdemocrats.org.au": "New Democrats", "citizensparty.org.au": "Australian Citizens Party",
}


def key(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"^(dr|mr|mrs|ms|prof|hon)\.?\s+", "", s)
    return re.sub(r"[^a-z]", "", s)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).strip("-")


def given_first(name):
    """'SURNAME, Given' (VEC/ABC style) -> 'Given SURNAME'; other names unchanged."""
    if "," in name:
        sur, _, given = name.partition(",")
        return f"{given.strip()} {sur.strip()}"
    return name


def candidate_id(seat, name):
    return f"{seat}/{slug(given_first(name))}"


def near(a, b):
    pa, pb = given_first(a).split(), given_first(b).split()
    fa, fb, sa, sb = key(pa[0]), key(pb[0]), key(pa[-1]), key(pb[-1])
    first_ok = fa == fb or fa.startswith(fb) or fb.startswith(fa) or difflib.SequenceMatcher(None, fa, fb).ratio() >= 0.7
    return first_ok and difflib.SequenceMatcher(None, sa, sb).ratio() >= 0.85


def party_code(label):
    low = (label or "").lower()
    return next((c for w, c in PARTY if w in low), "OTH")


def host(url):
    h = urlparse(url or "").netloc.lower()
    return h[4:] if h.startswith("www.") else h


def credit_for(e):
    """Credit the page the photo came from: the candidate's own party/campaign page if listed, else the image host."""
    pages = [p for p in e["sources"] if "abc.net.au" not in p] if "abc.net.au" not in host(e.get("image_url")) else []
    page = pages[0] if pages else (e["sources"][0] if e["sources"] else e.get("image_url"))
    h = host(e.get("image_url")) if "abc.net.au" in host(e.get("image_url")) else host(page)
    name = next((v for k, v in CREDITS.items() if h.endswith(k)), h)
    return name, page


# ---------------------------------------------------------------- index + candidates
def parse_index(text):
    entries = []
    for block in re.split(r"\n(?=0[12]_Legislative_)", text):
        lines = [l.rstrip() for l in block.strip().splitlines()]
        if not lines or not lines[0].startswith(("01_", "02_")):
            continue
        e = {"file": lines[0], "sources": [], "notes": []}
        for l in lines[1:]:
            m = re.match(r"\s*([A-Za-z /]+):\s*(.*)", l)
            if not m:
                e["notes"].append(l.strip())
                continue
            k, v = m.group(1).strip().lower(), m.group(2).strip()
            if k == "source page":
                v = PAGE_FIXES.get(v, v)
                if v not in e["sources"]:
                    e["sources"].append(v)
            elif k == "image url":
                e["image_url"] = v
            elif k == "candidate":
                e["candidate"] = v
            elif k == "party":
                e["party"] = v
            elif k == "electorate / region":
                e["seat"] = v
            elif k == "notes":
                e["notes"].append(v)
        entries.append(e)
    return entries


def candidate_pool():
    cands = json.loads((DATA / "candidates.json").read_text(encoding="utf-8"))["candidates"]
    regions = json.loads((DATA / "regions.json").read_text(encoding="utf-8"))["regions"]
    districts = json.loads((DATA / "districts.json").read_text(encoding="utf-8"))["districts"]
    pool = {}
    for c in cands:
        if c.get("status") in ("superseded", "withdrawn"):
            continue
        seat = c.get("district") or c.get("region")
        pool.setdefault(seat, []).append({"id": candidate_id(seat, c["name"]), "name": c["name"], "party": c["party"]})
    for r in regions:   # ticket names that aren't rows in candidates.json
        have = {key(given_first(x["name"])) for x in pool.get(r["id"], [])}
        for t in r.get("tickets", []):
            for n in t.get("candidates", []):
                if n not in ("TBC", "TBD") and key(n) not in have:
                    have.add(key(n))
                    pool.setdefault(r["id"], []).append({"id": candidate_id(r["id"], n), "name": n, "party": t["party"]})
    seats = {key(d["name"]): d["id"] for d in districts} | {key(r["name"]): r["id"] for r in regions}
    return pool, seats


def match(entries, pool, seats, overrides):
    matched, unmatched = [], []
    all_ids = {p["id"]: p for people in pool.values() for p in people}
    for e in entries:
        if e["file"] in overrides:
            target = overrides[e["file"]]
            if target is None:
                continue
            if target not in all_ids:
                unmatched.append({**e, "reason": f"override points to unknown candidate id {target!r}"})
                continue
            matched.append((e, all_ids[target], "override"))
            continue
        seat = seats.get(key(e.get("seat", "")))
        if not seat:
            unmatched.append({**e, "reason": f"seat '{e.get('seat')}' not recognised"})
            continue
        people = pool.get(seat, [])
        exact = [p for p in people if key(given_first(p["name"])) == key(e["candidate"])]
        if len(exact) == 1:
            matched.append((e, exact[0], "exact"))
            continue
        if len(exact) > 1:
            unmatched.append({**e, "reason": f"{len(exact)} candidates with this exact name in the seat"})
            continue
        close = [p for p in people if near(p["name"], e["candidate"])]
        same_surname = [p for p in people if key(given_first(p["name"]).split()[-1]) == key(e["candidate"].split()[-1])]
        if len(close) == 1 and len(same_surname) <= 1:
            matched.append((e, close[0], "near"))
        else:
            unmatched.append({**e, "reason": "no candidate with this name in the seat" if not (close or same_surname)
                              else f"ambiguous between {[p['name'] for p in close or same_surname]}"})
    return matched, unmatched


# ---------------------------------------------------------------- images
def square(img):
    """Square crop: centred for wide images, biased to the top for tall portraits (faces sit high)."""
    w, h = img.size
    if w == h:
        return img
    if w > h:
        left = (w - h) // 2
        return img.crop((left, 0, left + h, h))
    top = int((h - w) * 0.18)
    return img.crop((0, top, w, top + w))


def to_webp(img, size):
    out = img.resize((size, size), Image.LANCZOS)
    for q in (82, 75, 68, 60, 52, 45, 38):
        buf = io.BytesIO()
        out.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= MAX_BYTES:
            return buf.getvalue(), q
    return buf.getvalue(), q


def load_image(raw):
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        return bg
    return img.convert("RGB")


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("zip", type=Path)
    ap.add_argument("--publish", choices=["all", "non-abc", "none"], default="all",
                    help="which matched photos to write into site/ (non-abc skips images hosted by the ABC)")
    ap.add_argument("--report", type=Path, help="write the unmatched list as JSON here")
    args = ap.parse_args()

    z = zipfile.ZipFile(args.zip)
    root = next(n for n in z.namelist() if n.endswith("PHOTO_INDEX.txt")).rsplit("PHOTO_INDEX.txt", 1)[0]
    entries = parse_index(z.read(root + "PHOTO_INDEX.txt").decode("utf-8", "replace"))
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
    overrides = {k: v for k, v in overrides.items() if not k.startswith("_")}
    pool, seats = candidate_pool()
    matched, unmatched = match(entries, pool, seats, overrides)

    previous = {}
    if (DATA / "headshots.json").exists():
        previous = {h["id"]: h for h in json.loads((DATA / "headshots.json").read_text(encoding="utf-8")).get("headshots", [])}
    for size in SIZES:
        (PHOTOS / str(size)).mkdir(parents=True, exist_ok=True)
        for old in (PHOTOS / str(size)).glob("*.webp"):
            old.unlink()

    today = date.today().isoformat()
    records, provenance, skipped, upscaled = [], {}, [], []
    for e, cand, how in matched:
        abc = "abc.net.au" in host(e.get("image_url"))
        if args.publish == "none" or (args.publish == "non-abc" and abc):
            skipped.append(e["file"])
            continue
        img = load_image(z.read(root + e["file"]))
        sq = square(img)
        if sq.size[0] < SIZES[0]:
            upscaled.append(f"{e['file']} ({sq.size[0]}px source)")
        stem = cand["id"].replace("/", "--")
        files = {}
        for size in SIZES:
            data, _ = to_webp(sq, size)
            (PHOTOS / str(size) / f"{stem}.webp").write_bytes(data)
            files[str(size)] = f"photos/{size}/{stem}.webp"
        credit, page = credit_for(e)
        records.append({
            "id": cand["id"], "name": e["candidate"], "seat": cand["id"].split("/")[0], "files": files,
            "source": {"credit": credit, "page": page},
            "licence": "No licence stated by the source. Published by the candidate's party or campaign (or the outlet credited) "
                       "for public promotion of the candidate; reproduced with attribution for election coverage. "
                       "Permission not individually obtained." if not abc else
                       "ABC News candidate photo. No licence stated; ABC content is copyright. Permission not obtained.",
            "date_added": previous.get(cand["id"], {}).get("date_added", today),
        })
        # Research detail the site doesn't show stays out of site/data, so every page loads less.
        provenance[cand["id"]] = {"image_url": e.get("image_url"), "listed_on": [p for p in e["sources"] if p != page],
                                  "notes": e["notes"], "match": how}

    doc = {
        "_schema": {
            "description": "Candidate headshots: 320px and 160px square WebP crops in site/photos/, built by scripts/build_headshots.py from a research zip (originals are not in the repo). Candidates without an entry get a party-colour initials avatar.",
            "fields": {
                "id": "Candidate id: '<district or region id>/<slug of Given Surname>' (App.candidateId)",
                "name": "Name as published with the photo",
                "seat": "District or region id",
                "files": "{'320': path, '160': path}, relative to site/",
                "source": "{credit (shown under the photo), page (where the photo was published)}",
                "licence": "Licence or permission note",
                "date_added": "YYYY-MM-DD first added",
            },
            "provenance": "Image URLs, other listings, index notes and match type are in scripts/headshot_sources.json",
        },
        "source_archive": args.zip.name,
        "headshots": sorted(records, key=lambda r: r["id"]),
    }
    (DATA / "headshots.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    SOURCES.write_text(json.dumps({
        "_schema": {"description": "Where each published headshot came from (scripts/build_headshots.py). site/data/headshots.json has the credit the site shows.",
                    "fields": {"image_url": "The image's own URL", "listed_on": "Other pages listing the candidate",
                               "notes": "Notes from the source index (e.g. an earlier portrait reused)",
                               "match": "exact | near (spelling differs; check) | override (resolved by hand in scripts/headshot_overrides.json)"}},
        "sources": dict(sorted(provenance.items())),
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")

    sizes = [p.stat().st_size for s in SIZES for p in (PHOTOS / str(s)).glob("*.webp")]
    print(f"{len(entries)} photos in the index; {len(matched)} matched ({sum(1 for _, _, h in matched if h == 'near')} near-spelling, "
          f"{sum(1 for _, _, h in matched if h == 'override')} by override); {len(unmatched)} unmatched; {len(skipped)} not published ({args.publish})")
    print(f"wrote {len(records)} headshots; largest file {max(sizes, default=0) / 1024:.1f} KB; {sum(sizes) / 1024 / 1024:.1f} MB total; "
          f"{len(upscaled)} enlarged from sources under 320px")
    if args.report:
        args.report.write_text(json.dumps({"unmatched": unmatched, "upscaled": upscaled,
                                           "near": [(e["file"], c["id"]) for e, c, h in matched if h == "near"]},
                                          ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
