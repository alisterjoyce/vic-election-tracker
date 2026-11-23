#!/usr/bin/env python3
"""How-to-vote cards registered with the VEC for the 2026 state election: the register, and each card's preference order.

Used by refresh.py (refresh_htv); runnable alone for a check or the first full read:
    python scripts/vec_htv.py --data-dir <copy of site/data> [--pdf-dir <folder for the card PDFs>]

The register: https://www.vec.vic.gov.au/voting/2026-state-election/how-to-vote-cards lists every district and region
with its count of registered cards ("District cards by registration date", "... by party", "... by independent
candidate", "... by non-candidate registrations"). Each list is HTML from
/api/sitecore/HtvcResults/GetTable?areaType=<district|region>&areaItemId=<area guid>&category=<list name>, a table of
registration date, registered by, registration number, HTVC type (Single, Combined, Multiple) and a link to the card
(/api/sitecore/HtvcResults/ViewCard?blobPath=<guid>/<file name>.pdf&settingsItemId=...). A Combined or Multiple card
is listed under every district and region it covers, under the same registration number.

Each run reads the main page and every area's "by registration date" list (96 requests, one a second). The kind of
registrant (party, independent candidate, anyone else) comes from the "by independent candidate" and "by
non-candidate registrations" lists, read only for areas that have such cards and a registration number not seen before.

Preference orders: each card PDF not read before (by its link: an amended card gets a new link) is downloaded and its
order for each district or region it covers is read from the PDF's text layer (pdfplumber words with positions):
a number printed in a ballot box immediately left of a candidate's ballot name, or above or left of a Council group's
name. An order is stored only when every candidate in the district (or, for Council groups, each numbered box) reads
as a clean sequence 1..n; otherwise the card is "unreadable" and the page links the card. Cards without a text layer
(scanned or outlined) are OCR'd when an OCR engine is installed (rapidocr-onnxruntime); without one they are
"unreadable" too. Nothing is ever guessed.

robots.txt: www.vec.vic.gov.au disallows /assets/, /sitecore/ and *.ashx, not /voting/ or /api/sitecore/ (checked
19 Nov 2026; checked again every run). The VEC's website content is CC BY 4.0; the cards themselves belong to whoever
registered them, so only facts are stored (who registered, dates, numbers, the order) and each card is linked.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import os
import re
import sys
import time
import unicodedata
import urllib.robotparser
from datetime import date, datetime
from pathlib import Path
from urllib.parse import unquote, urljoin

import lxml.html
import requests

log = logging.getLogger("vec_htv")
VEC = "https://www.vec.vic.gov.au"
REGISTER_PAGE = VEC + "/voting/2026-state-election/how-to-vote-cards"
TABLE_API = VEC + "/api/sitecore/HtvcResults/GetTable"
# Where card PDFs are kept between runs on this machine (outside OneDrive: ~4.4 GB). The one place to change it;
# VEC_HTV_PDF_DIR overrides it. refresh.py and --reread both read it; the Actions runner keeps no cache.
PDF_CACHE = Path(os.environ.get("VEC_HTV_PDF_DIR") or r"C:\vec-cache\htv-2026")
DELAY = 1.0
TIMEOUT = 60
ATTEMPTS = 3
USER_AGENT = ("vic-election-tracker/1.0 (static Victorian election tracker; reads the VEC's how-to-vote card register "
              "four times a day, one request a second; https://alisterjoyce.github.io/vic-election-tracker/)")
KIND_LISTS = {"independent": "cards by independent candidate", "non_candidate": "cards by non-candidate registrations"}
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


class FetchFailed(Exception):
    pass


class Polite:
    """GETs at most one request per DELAY seconds, three tries each."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.last = 0.0
        self.count = 0

    def get(self, url: str, params=None, binary=False):
        error = None
        for attempt in range(1, ATTEMPTS + 1):
            wait = self.last + DELAY - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            try:
                resp = self.session.get(url, params=params, timeout=TIMEOUT)
                self.count += 1
                if 400 <= resp.status_code < 500:   # not there: trying again won't help
                    raise FetchFailed(f"{url}: HTTP {resp.status_code}")
                resp.raise_for_status()
                if binary:
                    return resp.content
                # The VEC sends "charset=utf-8" (checked 23 Nov 2026). Without one, requests falls back to
                # ISO-8859-1 for text/html and an en dash comes out as "â€“", so read UTF-8 unless a charset is named.
                if "charset=" not in (resp.headers.get("content-type") or "").lower():
                    resp.encoding = "utf-8"
                return resp.text
            except requests.RequestException as exc:
                error = exc
                log.warning("VEC fetch %s failed (attempt %d/%d): %s", url, attempt, ATTEMPTS, exc)
            finally:
                self.last = time.monotonic()
        raise FetchFailed(f"{url} failed {ATTEMPTS} times: {error}")


def clean(s) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def parse_date(text: str) -> str | None:
    m = re.search(r"(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})", text or "")
    if not m or m.group(2).lower() not in MONTHS:
        return None
    return date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1))).isoformat()


def slug(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


# --------------------------------------------------------------------------
# The register
# --------------------------------------------------------------------------

def parse_areas(page: str) -> list[dict]:
    """[{type: district|region, guid, name, id (our slug), count, lists: {list name: count}}] from the main page."""
    doc = lxml.html.fromstring(page)
    areas: dict[str, dict] = {}
    for b in doc.xpath("//*[@data-category-key][@data-area-id]"):
        guid, name, kind = b.get("data-area-id"), clean(b.get("data-area-name")), b.get("data-area-type")
        if kind not in ("district", "region") or not name:
            continue
        a = areas.setdefault(guid, {"type": kind, "guid": guid, "name": name,
                                    "id": slug(re.sub(r"\s+(District|Region)$", "", name)), "lists": {}})
        row = b.xpath("ancestor::div[contains(@class,'htvc-category-row')][1]")
        count = row[0].xpath(".//*[contains(@class,'htvc-category-card-count')]") if row else []
        n = re.search(r"\d[\d,]*", count[0].text_content()) if count else None
        a["lists"][b.get("data-category-key")] = int(n.group().replace(",", "")) if n else 0
    for a in areas.values():
        a["count"] = max(a["lists"].values(), default=0)
    return list(areas.values())


def parse_table(page: str) -> list[dict]:
    """Rows of a GetTable list, by column label."""
    doc = lxml.html.fromstring(page or "<div></div>")
    out = []
    for table in doc.xpath("//table"):
        heads = [clean(th.text_content()).lower() for th in table.xpath(".//thead//th")]
        col = lambda *words: next((i for i, h in enumerate(heads) if any(w in h for w in words)), None)
        i_date, i_by, i_num, i_type = col("date"), col("registered by"), col("number"), col("type")
        for tr in table.xpath(".//tbody/tr[td]"):
            cells = tr.xpath("./td")
            get = lambda i: clean(cells[i].text_content()) if i is not None and i < len(cells) else ""
            link = tr.xpath(".//a[@href]/@href")
            if not get(i_num) and not link:
                continue
            out.append({"registration": get(i_num), "registered_by": get(i_by), "type": get(i_type) or None,
                        "registered_on": parse_date(get(i_date)), "card_url": urljoin(VEC, link[0]) if link else None})
    return out


def card_file(url: str | None) -> str | None:
    """The PDF's file name from a ViewCard link."""
    m = re.search(r"blobPath=([^&]+)", url or "")
    return unquote(m.group(1)).split("/")[-1] if m else None


def read_register(web: Polite, known_kinds: dict[str, str]) -> dict:
    """{areas: [...], cards: [{area, house, registration, registered_by, type, registered_on, card_url, kind}]}.
    known_kinds: registration number -> party | independent | non_candidate from earlier runs."""
    robots = urllib.robotparser.RobotFileParser()
    robots.parse(web.get(VEC + "/robots.txt").splitlines())
    for url in (REGISTER_PAGE, TABLE_API + "?areaType=district"):
        if not robots.can_fetch(USER_AGENT, url):
            raise FetchFailed(f"robots.txt disallows {url}")
    areas = parse_areas(web.get(REGISTER_PAGE))
    if len([a for a in areas if a["type"] == "district"]) < 80:
        raise FetchFailed(f"the register page lists {len(areas)} areas; its layout may have changed")
    cards, kinds = [], dict(known_kinds)
    for a in areas:
        prefix = "District" if a["type"] == "district" else "Region"
        by_date = f"{prefix} cards by registration date"
        rows = parse_table(web.get(TABLE_API, {"areaType": a["type"], "areaItemId": a["guid"], "category": by_date})) \
            if a["lists"].get(by_date) else []
        if len(rows) != a["lists"].get(by_date, 0):
            log.warning("%s: %d cards listed, the page counts %d", a["name"], len(rows), a["lists"].get(by_date, 0))
        a["listed"] = len(rows)
        # Kind of registrant: read the independent / non-candidate lists when this area has new registrations.
        if any(r["registration"] not in kinds for r in rows):
            for kind, words in KIND_LISTS.items():
                key = f"{prefix} {words}"
                if a["lists"].get(key):
                    for r in parse_table(web.get(TABLE_API, {"areaType": a["type"], "areaItemId": a["guid"], "category": key})):
                        kinds[r["registration"]] = kind
            for r in rows:
                kinds.setdefault(r["registration"], "party")
        for r in rows:
            cards.append({"house": "lower" if a["type"] == "district" else "upper", "area": a["id"], "area_name": a["name"],
                          **r, "kind": kinds.get(r["registration"], "party")})
    return {"areas": areas, "cards": cards}


# --------------------------------------------------------------------------
# Reading a card's preference order
# --------------------------------------------------------------------------

def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]", "", s)


def pdf_words(pdf_bytes: bytes) -> list[list[dict]]:
    """Words per page with positions (pdfplumber). [] if the PDF has no text layer."""
    import pdfplumber
    pages = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for p in pdf.pages:
            words = p.dedupe_chars().extract_words(keep_blank_chars=False, use_text_flow=False, x_tolerance=2, y_tolerance=1)
            pages.append([{"text": w["text"], "x0": w["x0"], "x1": w["x1"], "top": w["top"], "bottom": w["bottom"]}
                          for w in words])
    return pages


def pdf_name(url: str) -> str:
    """A safe local file name for a card: its blob guid and file name."""
    m = re.search(r"blobPath=([^&]+)", url or "")
    blob = unquote(m.group(1)) if m else hashlib.sha1((url or "").encode()).hexdigest()
    return re.sub(r"[^A-Za-z0-9._-]+", "_", blob)[:150]


def fetch_pdf(web: Polite, url: str, pdf_dir: Path | None) -> bytes:
    """A card's PDF, from pdf_dir if it was saved there before (pdf_dir is the git-ignored samples folder)."""
    path = pdf_dir / pdf_name(url) if pdf_dir else None
    if path and path.exists() and path.stat().st_size:
        return path.read_bytes()
    data = web.get(url, binary=True)
    if not data.startswith(b"%PDF"):
        raise FetchFailed(f"{url} is not a PDF")
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return data


NUM = re.compile(r"^\(?(\d{1,2})[.)]?$")


def _join_fragments(words: list[dict]) -> list[dict]:
    """Rejoin a word the extraction split at a raised or smaller letter (the 'c' of McRAE): a piece of one or two
    letters touching the next piece on the same line."""
    words = sorted((dict(w) for w in words if w["text"].strip()), key=lambda w: w["x0"])
    buckets: dict[int, list[int]] = {}
    for i, w in enumerate(words):
        buckets.setdefault(int(w["x0"]), []).append(i)
    gone = set()
    for i, w in enumerate(words):
        if i in gone:
            continue
        while True:
            nxt = None
            for b in (int(w["x1"]) - 1, int(w["x1"]), int(w["x1"]) + 1):
                for j in buckets.get(b, []):
                    o = words[j]
                    if j == i or j in gone or not (-0.6 <= o["x0"] - w["x1"] <= 0.8):
                        continue
                    if not (len(w["text"]) <= 2 or len(o["text"]) <= 2) or NUM.match(w["text"]) or NUM.match(o["text"]):
                        continue
                    cw, co = (w["top"] + w["bottom"]) / 2, (o["top"] + o["bottom"]) / 2
                    if w["top"] - 0.5 <= co <= w["bottom"] + 0.5 or o["top"] - 0.5 <= cw <= o["bottom"] + 0.5:
                        nxt = j
                        break
                if nxt is not None:
                    break
            if nxt is None:
                break
            o = words[nxt]
            gone.add(nxt)
            w.update(text=w["text"] + o["text"], x1=o["x1"], top=min(w["top"], o["top"]), bottom=max(w["bottom"], o["bottom"]))
    return [w for i, w in enumerate(words) if i not in gone]


class Page:
    """A page's words with positions, for neighbour lookups."""

    def __init__(self, words: list[dict], index: int, via: str = "text"):
        self.index, self.via = index, via
        self.words = [dict(w, n=_norm(w["text"]), cy=(w["top"] + w["bottom"]) / 2, h=max(w["bottom"] - w["top"], 1.0))
                      for w in _join_fragments(words) if w["text"].strip()]
        self.by_norm: dict[str, list[dict]] = {}
        for w in self.words:
            self.by_norm.setdefault(w["n"], []).append(w)
        self.odd = [w for w in self.words if "�" in w["text"]]
        self.numbers = [dict(w, num=int(NUM.match(w["text"]).group(1))) for w in self.words if NUM.match(w["text"])]

    def same_line(self, w, right=True, gap=14):
        """The nearest word right (or left) of w on its line, within gap points."""
        best, bd = None, gap
        for o in self.words:
            if o is w or abs(o["cy"] - w["cy"]) > 0.45 * max(w["h"], o["h"]):
                continue
            d = (o["x0"] - w["x1"]) if right else (w["x0"] - o["x1"])
            if -1.5 <= d <= bd:
                best, bd = o, d
        return best


def _name_parts(ballot_name: str) -> tuple[list[str], list[str]]:
    sur, _, given = ballot_name.partition(",")
    return [_norm(t) for t in sur.split() if _norm(t)], [_norm(t) for t in given.split() if _norm(t)]


def _given_ok(w, given: list[str]) -> bool:
    if not w or not given:
        return False
    a, b = w["n"], given[0]
    if len(a) == 1:   # an initial ("POBJOY, A")
        return b.startswith(a)
    return a == b or (len(a) >= 3 and (b.startswith(a) or a.startswith(b)))


def _word_is(w, token: str) -> bool:
    """A printed word is this name token; a letter the PDF's font can't map (U+FFFD, e.g. the S-caron of DOLEJS)
    stands for one letter of it."""
    if w["n"] == token:
        return True
    if "�" in w["text"]:
        pat = "".join("." if ch == "�" else re.escape(_norm(ch)) for ch in w["text"].strip(",.;:"))
        return bool(re.fullmatch(pat.replace("..", ".?."), token))
    return False


def find_names(page: Page, ballot_name: str) -> list[dict]:
    """Where a candidate's name is printed: [{left, top, bottom, cy, score}] (score 2 when the given name is beside it)."""
    sur, given = _name_parts(ballot_name)
    out = []
    if not sur:
        return out
    starts = page.by_norm.get(sur[0], []) + [w for w in page.odd if _word_is(w, sur[0])]
    for w in starts:
        last, ok = w, True
        for t in sur[1:]:
            nxt = page.same_line(last)
            if not nxt or not _word_is(nxt, t):
                ok = False
                break
            last = nxt
        if not ok:
            continue
        before, after = page.same_line(w, right=False), page.same_line(last)
        score, left = 1, w["x0"]
        if _given_ok(after, given):
            score = 2
        elif _given_ok(before, given):
            score, left = 2, before["x0"]
        out.append({"left": left, "top": w["top"], "bottom": w["bottom"], "cy": w["cy"], "h": w["h"], "score": score})
    return out


def number_left_of(page: Page, spot: dict, max_gap=90) -> dict | None:
    """The number printed in a box just left of a name: on the same line (their heights overlap), nearest."""
    best, bd = None, (max_gap, 0)
    for n in page.numbers:
        if n["x1"] > spot["left"] + 2:
            continue
        overlap = min(n["bottom"], spot["bottom"]) - max(n["top"], spot["top"])
        if overlap <= 0.25 * min(n["h"], spot["h"]):
            continue
        d = (round(spot["left"] - n["x1"]), -overlap)
        if d < bd:
            best, bd = n, d
    return best


def _pick(options: list[dict], centre) -> dict:
    return sorted(options, key=lambda o: (-o["score"], (o["x"] - centre[0]) ** 2 + (o["y"] - centre[1]) ** 2))[0]


def read_candidates(pages: list[Page], cands: list[dict], need_all=True) -> dict | None:
    """Preference numbers beside candidates' names, read page by page.
    cands: [{ballot_name, ballot_position}]. Returns {page, numbers: {ballot_name: n}, complete}, {conflict} or None."""
    results = []
    for page in pages:
        found, named = {}, set()
        for c in cands:
            opts = []
            for spot in find_names(page, c["ballot_name"]):
                named.add(c["ballot_name"])
                num = number_left_of(page, spot)
                if num:
                    opts.append({"num": num, "x": spot["left"], "y": spot["cy"], "score": spot["score"]})
            if opts:
                found[c["ballot_name"]] = opts
        if not found:
            continue
        # A printed name that matches one candidate's surname and given name isn't another candidate's (two KELLYs).
        claimed = {(o["x"], o["y"]): name for name, opts in found.items() for o in opts if o["score"] == 2}
        found = {name: kept for name, opts in found.items()
                 if (kept := [o for o in opts if claimed.get((o["x"], o["y"]), name) == name])}
        if not found:
            continue
        single = [o[0] for o in found.values() if len(o) == 1]
        centre = (sum(o["x"] for o in single) / len(single), sum(o["y"] for o in single) / len(single)) if single else (0, 0)
        chosen = {name: _pick(opts, centre) for name, opts in found.items()}
        nums = [o["num"]["num"] for o in chosen.values()]
        if len({id(o["num"]) for o in chosen.values()}) != len(nums) or sorted(nums) != list(range(1, len(nums) + 1)):
            continue
        # The names must sit in ballot order down (or across) the page, as on a ballot paper.
        in_order = [chosen[c["ballot_name"]] for c in sorted(cands, key=lambda c: c["ballot_position"]) if c["ballot_name"] in chosen]
        ys, xs = [o["y"] for o in in_order], [o["x"] for o in in_order]
        # (A single column or row, or columns left to right as on the Council's large paper.)
        down = all(b > a for a, b in zip(ys, ys[1:]))
        across = all(b > a for a, b in zip(xs, xs[1:]))
        columns = all(bx > ax + 5 or (abs(bx - ax) <= 5 and by > ay) for (ax, ay), (bx, by) in zip(zip(xs, ys), zip(xs[1:], ys[1:])))
        if not (down or across or (not need_all and columns)):
            continue
        complete = len(nums) == len(cands)
        # A card that numbers only some boxes counts if every other name is printed there without a number, or if it
        # prints just one candidate, numbered 1, and no other candidate's name (a "Vote 1" card).
        vote1 = len(chosen) == 1 and nums == [1] and named == set(chosen)
        if need_all and not complete and not (all(c["ballot_name"] in named for c in cands) or vote1):
            continue
        results.append({"page": page.index, "via": page.via, "numbers": {n: o["num"]["num"] for n, o in chosen.items()},
                        "complete": complete})
    if not results:
        return None
    pool = [r for r in results if r["complete"]] or results
    if any(r["numbers"] != pool[0]["numbers"] for r in pool):
        return {"conflict": True}
    return pool[0]


GROUP_STOP = {"PARTY", "VICTORIA", "AUSTRALIAN", "THE"}


def read_groups(pages: list[Page], groups: list[dict]) -> dict | None:
    """Above-the-line numbers: a number in the box under (or beside) a group letter, confirmed by the group's name
    printed near the box. groups: [{group, label}]. Returns {page, numbers: {letter: n}}, {conflict} or None."""
    letters = {g["group"]: g for g in groups}
    results = []
    for page in pages:
        pairs: dict[str, list] = {}
        for w in page.words:
            if w["text"] not in letters:
                continue
            cx = (w["x0"] + w["x1"]) / 2
            best, bd = None, 1e9
            for n in page.numbers:
                ncx = (n["x0"] + n["x1"]) / 2
                below = abs(ncx - cx) < 30 and 0 <= n["top"] - w["bottom"] <= 80
                beside = abs(n["cy"] - w["cy"]) < max(w["h"], n["h"]) and 0 <= n["x0"] - w["x1"] <= 40
                if below or beside:
                    d = abs(ncx - cx) + abs(n["cy"] - w["cy"])
                    if d < bd:
                        best, bd = n, d
            if best is None:
                continue
            label = letters[w["text"]].get("label") or ""
            words = {_norm(t) for t in re.split(r"[\s/\-–]+", label) if len(_norm(t)) >= 4} - GROUP_STOP
            ncx = (best["x0"] + best["x1"]) / 2
            # True / False; None for a group printed without a name (it can't be confirmed either way).
            confirmed = None if not words else any(o["n"] in words and abs((o["x0"] + o["x1"]) / 2 - ncx) < 70
                                                   and abs(o["cy"] - best["cy"]) < 110 for o in page.words)
            pairs.setdefault(w["text"], []).append((best, confirmed, (ncx - cx, best["cy"] - w["cy"])))
        if not pairs:
            continue
        # Where a letter appears twice (e.g. "find column B" in the instructions), take the pairing that sits the
        # way the other letters' boxes do: the same offset from letter to number.
        goods = {l: [o for o in opts if o[1]] or [o for o in opts if o[1] is None] or opts for l, opts in pairs.items()}
        settled = [g[0][2] for g in goods.values() if len({o[0]["num"] for o in g}) == 1]
        used = {g[0][0]["num"] for g in goods.values() if len({o[0]["num"] for o in g}) == 1}
        chosen = {}
        for letter, opts in pairs.items():
            good = goods[letter]
            if len({o[0]["num"] for o in good}) != 1:
                free = [o for o in good if o[0]["num"] not in used]   # numbers on a ballot are all different
                if len({o[0]["num"] for o in free}) == 1:
                    good = free
            if len({o[0]["num"] for o in good}) != 1:
                if len(settled) < 2:
                    chosen = None
                    break
                mx = sorted(o[0] for o in settled)[len(settled) // 2]
                my = sorted(o[1] for o in settled)[len(settled) // 2]
                far = sorted(good, key=lambda o: abs(o[2][0] - mx) + abs(o[2][1] - my))
                d0 = abs(far[0][2][0] - mx) + abs(far[0][2][1] - my)
                d1 = abs(far[1][2][0] - mx) + abs(far[1][2][1] - my)
                if not (d0 <= 6 and d1 > d0 + 10):
                    chosen = None
                    break
                good = [far[0]]
            chosen[letter] = (good[0][0], True if any(o[1] for o in opts) else (None if any(o[1] is None for o in opts) else False))
        if not chosen:
            continue
        nums = [o[0]["num"] for o in chosen.values()]
        if len({id(o[0]) for o in chosen.values()}) != len(nums) or sorted(nums) != list(range(1, len(nums) + 1)):
            continue
        named = [o for o in chosen.values() if o[1] is not None]
        if not named or sum(1 for o in named if o[1]) * 2 < len(named) or any(o[1] is False for o in chosen.values()) and len(named) < 3:
            continue
        results.append({"page": page.index, "via": page.via, "numbers": {l: o[0]["num"] for l, o in chosen.items()}})
    if not results:
        return None
    best = max(results, key=lambda r: len(r["numbers"]))
    if any(r["numbers"] != best["numbers"] and len(r["numbers"]) == len(best["numbers"]) for r in results):
        return {"conflict": True}
    return best


# --------------------------------------------------------------------------
# OCR, for cards without a text layer (optional: rapidocr-onnxruntime + pypdfium2)
# --------------------------------------------------------------------------

_OCR = None


def ocr_available() -> bool:
    global _OCR
    if os.environ.get("VEC_HTV_NO_OCR"):   # e.g. a re-read after a text-reader change
        return False
    if _OCR is None:
        try:
            from rapidocr_onnxruntime import RapidOCR   # noqa: F401
            import pypdfium2                            # noqa: F401
            _OCR = RapidOCR()
        except Exception:   # noqa: BLE001 - not installed: such cards stay unreadable
            _OCR = False
    return bool(_OCR)


def ocr_words(pdf_bytes: bytes, scale=3.0) -> list[list[dict]]:
    """Words with positions (in PDF points) from OCR of each page. Each OCR line is split into words with
    positions in proportion to their length."""
    import pypdfium2
    pages = []
    pdf = pypdfium2.PdfDocument(pdf_bytes)
    for i in range(len(pdf)):
        img = pdf[i].render(scale=scale).to_numpy()[:, :, :3].copy()
        found, _ = _OCR(img)
        words = []
        for box, text, conf in found or []:
            if float(conf) < 0.6:
                continue
            xs, ys = [p[0] / scale for p in box], [p[1] / scale for p in box]
            x0, x1, top, bottom = min(xs), max(xs), min(ys), max(ys)
            parts = text.replace(",", ", ").split()
            total = sum(len(p) for p in parts) + len(parts) - 1 or 1
            at = x0
            for p in parts:
                w = (x1 - x0) * len(p) / total
                words.append({"text": p, "x0": at, "x1": at + w, "top": top, "bottom": bottom})
                at += w + (x1 - x0) / total
        pages.append(words)
    return pages


# --------------------------------------------------------------------------
# Building htv.json
# --------------------------------------------------------------------------

UNREADABLE = "unreadable, see card"
MAJOR = {"ALP": "ALP", "LIB": "LNP", "NAT": "LNP", "LNP": "LNP"}     # the two sides of government
WATCH = ("ALP", "LNP", "GRN", "ONP")                                    # parties whose relative order is tracked


def ballots(vec: dict) -> dict[str, dict]:
    """area id -> {house, name, url, candidates (ballot order), groups} from vec_nominations.json."""
    out = {}
    for house, key in (("lower", "districts"), ("upper", "regions")):
        for aid, e in (vec.get(key) or {}).items():
            cands = sorted(e.get("candidates") or [], key=lambda c: (c.get("ballot_position") or 999, c.get("nominated") or 0))
            out[aid] = {"house": house, "name": e.get("name"), "url": e.get("url"), "drawn": bool(e.get("ballot_drawn")),
                        "candidates": cands, "groups": e.get("groups") or []}
    return out


def party_labels(vec: dict) -> dict[str, str]:
    """Normalised party label as the VEC prints it -> party code."""
    out = {}
    for e in list((vec.get("districts") or {}).values()) + list((vec.get("regions") or {}).values()):
        for c in e.get("candidates") or []:
            if c.get("party_label") and c.get("party") not in (None, "IND"):
                out.setdefault(_norm(c["party_label"]), c["party"])
    return out


def _person_key(name: str) -> str:
    """'SURNAME, Given' or 'Given Surname' -> a key independent of order and case."""
    return " ".join(sorted(_norm(t) for t in re.split(r"[\s,]+", name or "") if _norm(t)))


def match_candidate(name: str, cands: list[dict]) -> dict | None:
    key = _person_key(name)
    hit = [c for c in cands if _person_key(c["ballot_name"]) == key or _person_key(c.get("name")) == key]
    if len(hit) == 1:
        return hit[0]
    sur = {_norm(t) for t in re.split(r"[\s,]+", name or "") if _norm(t)}
    hit = [c for c in cands if _name_parts(c["ballot_name"])[0] and set(_name_parts(c["ballot_name"])[0]) <= sur]
    return hit[0] if len(hit) == 1 else None


def read_card(pdf_bytes: bytes, areas: list[str], ballot: dict[str, dict]) -> dict[str, dict]:
    """{area id: reading} for every district or region a card covers."""
    try:
        text = pdf_words(pdf_bytes)
    except Exception as exc:   # noqa: BLE001 - a broken PDF is unreadable, not fatal
        log.warning("card PDF could not be read: %s", exc)
        text = []
    pages = [Page(w, i) for i, w in enumerate(text)]
    ocr_pages = None

    def one(aid, pages):
        b = ballot.get(aid)
        if not b:
            return None
        if b["house"] == "lower":
            r = read_candidates(pages, b["candidates"])
            if r and not r.get("conflict"):
                order = [n for n, _ in sorted(r["numbers"].items(), key=lambda kv: kv[1])]
                return {"status": "read" if r["complete"] else "partial", "order": order, "via": r["via"]}
            return None
        r = read_groups(pages, b["groups"])
        btl = read_candidates(pages, b["candidates"], need_all=False)
        out = {}
        if r and not r.get("conflict"):
            out["atl"] = [g for g, _ in sorted(r["numbers"].items(), key=lambda kv: kv[1])]
            out["via"] = r["via"]
        if btl and not btl.get("conflict") and len(btl["numbers"]) >= 5:
            out["btl"] = [n for n, _ in sorted(btl["numbers"].items(), key=lambda kv: kv[1])]
            out.setdefault("via", btl["via"])
        if out:
            out["status"] = "read"
            return out
        return None

    result = {}
    for aid in areas:
        r = one(aid, pages)
        # OCR only a card with (almost) no text layer: a card with text that didn't read cleanly won't do better.
        image_only = sum(len(p.words) for p in pages) < 25 * max(len(pages), 1)
        if r is None and image_only and ocr_available():
            if ocr_pages is None:
                try:
                    ocr_pages = [Page(w, i, via="ocr") for i, w in enumerate(ocr_words(pdf_bytes))]
                except Exception as exc:   # noqa: BLE001
                    log.warning("OCR failed: %s", exc)
                    ocr_pages = []
            r = one(aid, ocr_pages) if ocr_pages else None
            if r and r.get("status") == "partial":
                r = None   # OCR misses box digits, so a partial OCR reading can't be told from a misread one
        result[aid] = r or {"status": "unreadable", "note": UNREADABLE}
    return result


def ranks(reading: dict, b: dict) -> dict[str, int]:
    """Where a card puts each tracked party (its best-placed candidate or group): {ALP|LNP|GRN|ONP: preference}."""
    out = {}
    if b["house"] == "lower" and reading.get("order"):
        party = {c["ballot_name"]: c.get("party") for c in b["candidates"]}
        seq = [party.get(n) for n in reading["order"]]
    elif b["house"] == "upper" and reading.get("atl"):
        party = {g["group"]: g.get("party") for g in b["groups"]}
        seq = [party.get(g) for g in reading["atl"]]
    else:
        return out
    for i, p in enumerate(seq, 1):
        side = MAJOR.get(p, p)
        if side in WATCH and side not in out:
            out[side] = i
    return out


def flags(card_party: str | None, r: dict[str, int], house: str) -> list[dict]:
    """Facts about a Labor, Liberal or Nationals card: where it puts One Nation or the Greens ahead of the other side
    of government. [{ahead: ONP|GRN, of: ALP|LNP, ahead_n, of_n}]. Only orders that number both parties count."""
    side = MAJOR.get(card_party or "")
    if not side:
        return []
    other = "LNP" if side == "ALP" else "ALP"
    out = []
    for p in ("ONP", "GRN"):
        if p in r and other in r and r[p] < r[other]:
            out.append({"ahead": p, "of": other, "ahead_n": r[p], "of_n": r[other]})
    return out


def build(register: dict, existing: dict, vec: dict, fetch_pdf_bytes, today: str, max_new: int = 2000) -> tuple[dict, list[dict]]:
    """Merge a fresh register read with the existing htv.json. fetch_pdf_bytes(url) -> bytes.
    Returns (doc, changes this run)."""
    ballot = ballots(vec)
    labels = party_labels(vec)
    old = {c["registration"]: c for c in existing.get("cards") or [] if c.get("registration")}
    regs: dict[str, dict] = {}
    for row in register["cards"]:
        r = regs.setdefault(row["registration"], {**{k: row[k] for k in ("registration", "registered_by", "type", "registered_on", "card_url", "kind")},
                                                  "areas": []})
        if row["area"] not in r["areas"]:
            r["areas"].append(row["area"])
    changes, cards, fetched = [], [], 0
    for reg, r in regs.items():
        prev = old.pop(reg, None)
        areas = sorted(r["areas"], key=lambda a: (ballot.get(a, {}).get("house") != "lower", a))
        card = {k: r[k] for k in ("registration", "registered_by", "kind", "type", "registered_on", "card_url")}
        card["file"] = card_file(r["card_url"])
        card["areas"] = areas
        # Who registered it: a party code, or the candidate an independent's card is for.
        card["party"], card["candidate"] = None, None
        if r["kind"] == "party":
            # The VEC lists a few cards with no "Registered by": no party is assumed for them.
            card["party"] = (labels.get(_norm(r["registered_by"])) or "OTH") if r["registered_by"].strip() else None
        elif r["kind"] == "independent":
            for aid in areas:
                hit = match_candidate(r["registered_by"], ballot.get(aid, {}).get("candidates") or [])
                if hit:
                    card["party"], card["candidate"] = "IND", hit.get("id")
                    break
            card["party"] = card["party"] or "IND"
        same_pdf = prev and prev.get("card_url") == r["card_url"]
        orders = dict(prev.get("orders") or {}) if same_pdf else {}
        # Orders read from the card's image (via "image", by eye, read twice) are kept with the rest while the PDF is
        # the same; an amended card drops them, since its numbers may have changed: read the new card again.
        if prev and not same_pdf:
            lost = sorted(a for a, o in (prev.get("orders") or {}).items() if o.get("via") == "image")
            if lost:
                log.warning("card %s (%s) amended: its image-read orders (%s) need reading again from the new card",
                            reg, r["registered_by"], ", ".join(lost))
        # Hand-entered orders survive unless a new PDF for this card reads cleanly.
        hand = {a: o for a, o in ((prev or {}).get("orders") or {}).items() if o.get("via") == "hand"}
        need = [a for a in areas if a not in orders or (orders[a].get("status") == "pending" and orders[a].get("tried") != today)]
        if need and r["card_url"] and fetched < max_new:
            try:
                data = fetch_pdf_bytes(r["card_url"])
                fetched += 1
                orders.update(read_card(data, need, ballot))
                card["read_on"] = today
            except Exception as exc:   # noqa: BLE001 - try again tomorrow
                log.warning("card %s (%s): %s", reg, r["registered_by"], exc)
                for a in need:
                    orders[a] = {"status": "pending", "tried": today, "note": "the VEC's link to this card didn't open"}
        else:
            for a in need:
                orders.setdefault(a, {"status": "pending"})
            if prev and prev.get("read_on") and same_pdf:
                card["read_on"] = prev["read_on"]
        for a, o in hand.items():
            if a in areas and (same_pdf or orders.get(a, {}).get("status") != "read"):
                orders[a] = o
        card["orders"] = {a: orders[a] for a in areas if a in orders}
        if prev and prev.get("notes"):
            card["notes"] = prev["notes"]
        cards.append(card)
        if not prev:
            changes.append({"date": today, "kind": "added", "registration": reg, "registered_by": r["registered_by"],
                            "areas": areas, "card_url": r["card_url"]})
        elif not same_pdf:
            changes.append({"date": today, "kind": "amended", "registration": reg, "registered_by": r["registered_by"],
                            "areas": areas, "card_url": r["card_url"], "detail": f"replaces {prev.get('file') or prev.get('card_url')}"})
        elif sorted(prev.get("areas") or []) != sorted(areas):
            changes.append({"date": today, "kind": "areas", "registration": reg, "registered_by": r["registered_by"],
                            "areas": areas, "detail": f"was {', '.join(prev.get('areas') or [])}"})
    for reg, prev in old.items():
        changes.append({"date": today, "kind": "removed", "registration": reg, "registered_by": prev.get("registered_by"),
                        "areas": prev.get("areas") or [], "card_url": prev.get("card_url")})
    cards.sort(key=lambda c: (int(c["registration"]) if str(c["registration"]).isdigit() else 10 ** 9, str(c["registration"])))
    doc = {"cards": cards, "areas": {a["id"]: {"name": a["name"], "house": "lower" if a["type"] == "district" else "upper",
                                               "listed": a.get("listed", a["count"])} for a in register["areas"]},
           "pending": sum(1 for c in cards for o in c["orders"].values() if o.get("status") == "pending")}
    return doc, changes


def coverage(cards: list[dict], vec: dict) -> dict:
    """Cards per party, districts and regions covered, and candidates (and Council groups) with no card registered."""
    ballot = ballots(vec)
    by_area: dict[str, list[dict]] = {}
    for c in cards:
        for a in c["areas"]:
            by_area.setdefault(a, []).append(c)
    parties: dict[str, dict] = {}
    for c in cards:
        key = (c["party"] or "UNNAMED") if c["kind"] == "party" else ("IND" if c["kind"] == "independent" else "NONCAND")
        p = parties.setdefault(key, {"cards": 0, "districts": set(), "regions": set(), "registered_by": set()})
        p["cards"] += 1
        if c["registered_by"].strip():
            p["registered_by"].add(c["registered_by"].replace("�", "-"))
        for a in c["areas"]:
            (p["districts"] if ballot.get(a, {}).get("house") == "lower" else p["regions"]).add(a)
    no_card = {}
    for aid, b in ballot.items():
        here = by_area.get(aid, [])
        # A party is its code; parties without their own code (OTH) are told apart by name.
        codes = {c["party"] if c["party"] != "OTH" else "OTH:" + _norm(c["registered_by"]) for c in here if c["kind"] == "party" and c["party"]}
        key = lambda party, label: party if party != "OTH" else "OTH:" + _norm(label or "")
        people = {c["candidate"] for c in here if c.get("candidate")}
        if b["house"] == "lower":
            missing = [c for c in b["candidates"] if c.get("id") not in people
                       and (c.get("party") in (None, "IND") or key(c["party"], c.get("party_label")) not in codes)]
        else:
            group_party = {g["group"]: g for g in b["groups"]}
            def covered(c):
                if c.get("id") in people:
                    return True
                g = group_party.get(c.get("group")) or {}
                if g.get("party") == "LNP":
                    return bool(codes & {"LIB", "NAT", "LNP"})
                if g.get("party") and g["party"] != "IND":
                    return key(g["party"], g.get("label")) in codes
                return c.get("party") not in (None, "IND") and key(c["party"], c.get("party_label")) in codes
            missing = [c for c in b["candidates"] if not covered(c)]
        no_card[aid] = [c["ballot_name"] for c in missing]
    read = sum(1 for c in cards for o in c["orders"].values() if o.get("status") in ("read", "partial"))
    same_as = sum(1 for c in cards for o in c["orders"].values() if o.get("status") == "same_as")
    listings = sum(len(c["orders"]) for c in cards)
    image = sum(1 for c in cards for o in c["orders"].values() if o.get("status") in ("read", "partial") and o.get("via") == "image")
    return {
        "cards": len(cards), "listings": listings, "orders_read": read, "orders_image": image, "orders_same_as": same_as,
        "orders_unreadable": sum(1 for c in cards for o in c["orders"].values() if o.get("status") == "unreadable"),
        "districts_with_cards": sum(1 for a, b in ballot.items() if b["house"] == "lower" and by_area.get(a)),
        "regions_with_cards": sum(1 for a, b in ballot.items() if b["house"] == "upper" and by_area.get(a)),
        "by_party": {k: {"cards": v["cards"], "districts": len(v["districts"]), "regions": len(v["regions"]),
                         **({"registered_by": sorted(v["registered_by"])} if k == "OTH" else {})}
                     for k, v in sorted(parties.items(), key=lambda kv: -kv[1]["cards"])},
        "no_card": {"lower": sum(len(v) for a, v in no_card.items() if ballot[a]["house"] == "lower"),
                    "upper": sum(len(v) for a, v in no_card.items() if ballot[a]["house"] == "upper"),
                    "candidates_lower": sum(len(ballot[a]["candidates"]) for a in ballot if ballot[a]["house"] == "lower"),
                    "candidates_upper": sum(len(ballot[a]["candidates"]) for a in ballot if ballot[a]["house"] == "upper")},
        "_no_card_by_area": no_card,
    }


# --------------------------------------------------------------------------
# Files: htv.json (everything), htv/<area>.json (what a seat or region page needs), htv/index.json (counts, watch)
# --------------------------------------------------------------------------

REG_OPENS, REG_CLOSES = "2026-11-10", "2026-11-20"
SCHEMA = {
    "description": "How-to-vote cards registered with the VEC for the 2026 state election, and the preference order "
                   "each card prints for each district and region it covers. scripts/refresh.py (scripts/vec_htv.py) reads the "
                   "VEC's register at every refresh; a card's PDF is read once (again only if the VEC replaces it), its order "
                   "taken from the PDF's text (OCR for scanned cards) and stored only when every number reads cleanly; otherwise "
                   "the order is marked unreadable and the card is linked. Facts only: the cards belong to whoever registered "
                   "them. Per-seat copies: htv/<district or region id>.json; counts: htv/index.json.",
    "fields": {
        "status": "not_open (before 9 am 10 Nov 2026) | open (registration period, to 20 Nov) | closed",
        "registration_opens": "YYYY-MM-DD", "registration_closes": "YYYY-MM-DD",
        "source_url": "The VEC's register of registered how-to-vote cards",
        "last_checked": "ISO UTC time the register was last read successfully",
        "pending": "Orders not read yet (cards whose PDF is still to be read, at most a set number per refresh)",
        "coverage": "{cards (registrations), listings (card x district or region), orders_read, orders_image (of those, read "
                    "from the card image by eye), orders_same_as, orders_unreadable, "
                    "districts_with_cards, regions_with_cards, by_party: {code | IND (independent candidates) | NONCAND "
                    "(registered by someone not standing): {cards, districts, regions}}, no_card: {lower, upper "
                    "(candidates with no card from their party or themselves), candidates_lower, candidates_upper}}",
        "cards": "[{registration (VEC number), registered_by (as the VEC lists it), kind (party | independent | non_candidate), "
                 "party (code; IND for an independent candidate; null for others), candidate (tracker id of the independent "
                 "it is for), type (Single | Combined | MEHTVC, as listed), registered_on (YYYY-MM-DD), card_url (the VEC's "
                 "link to the card PDF), file (its file name), areas (district and region ids it is listed under), read_on, "
                 "orders: {area id: {status (read | partial: numbers only some boxes | same_as: a translated card that couldn't be read, given the order every readable card from the same registrant prints for that seat, with same_as = their registration numbers and note 'same order as the English card' | unreadable | pending), order (Assembly: "
                 "ballot names, 'SURNAME, Given', first preference first), atl (Council: group letters numbered above the line, "
                 "first first), btl (Council: ballot names numbered below the line, when the card numbers at least 5), via "
                 "(text | ocr | hand | image: read by eye from the card's rendered image, twice, independently, and kept only "
                 "when both readings agree and the numbers form a complete sequence; the pages say 'read from card image, check the card'), note ('unreadable, see card'), ranks ({ALP | LNP | GRN | ONP: preference given to that "
                 "party's best-placed candidate or group}), flags ([{ahead, of, ahead_n, of_n}]: a Labor, Liberal or Nationals "
                 "card numbering One Nation or the Greens ahead of the other side of government)}}, notes}]",
        "changes": "Cards added, amended (new PDF), moved between areas or removed, as found at each refresh: "
                   "[{date, kind, registration, registered_by, areas, card_url, detail}], newest first, last 300",
    },
}


def status_for(today: str) -> str:
    return "not_open" if today < REG_OPENS else ("open" if today <= REG_CLOSES else "closed")


# A card in another language, by its file name: the Greens' "... arabic 2.pdf", Labor's "..._tr5_1.pdf".
TRANSLATED = re.compile(r"arabic|chinese|vietnamese|punjabi|hindi|greek|italian|turkish|somali|oromo|dari|persian|farsi|"
                        r"urdu|hazaragi|hazara|tamil|korean|khmer|nepali|sinhal|macedonian|serbian|croatian|spanish|amharic|tigrinya|"
                        r"dinka|swahili|karen|burmese|bengali|gujarati|telugu|filipino|tagalog|indonesian|thai|japanese|"
                        r"russian|ukrainian|polish|portuguese|cantonese|mandarin|(?:^|[_ ])tr\d", re.I)
SAME_AS_NOTE = "same order as the English card"


def borrow_translations(cards: list[dict]) -> int:
    """A translated card that can't be read takes the order of the same registrant's readable cards for the same
    district or region, when every one of those prints the same order (status "same_as", with the registration
    numbers it follows). Recomputed every run, so it lapses if those cards stop agreeing. Returns how many."""
    readable: dict[tuple, list[dict]] = {}
    for c in cards:
        if TRANSLATED.search(c.get("file") or ""):
            continue
        for aid, o in c["orders"].items():
            if o.get("status") == "read":
                readable.setdefault((c["kind"], c["registered_by"], aid), []).append((c, o))
    n = 0
    for c in cards:
        if not TRANSLATED.search(c.get("file") or ""):
            continue
        for aid, o in list(c["orders"].items()):
            if o.get("status") not in ("unreadable", "same_as"):
                continue
            sib = readable.get((c["kind"], c["registered_by"], aid), [])
            orders = {json.dumps([so.get("order"), so.get("atl"), so.get("btl")]) for _, so in sib}
            if sib and len(orders) == 1:
                src = sib[0][1]
                c["orders"][aid] = {"status": "same_as", **{k: src[k] for k in ("order", "atl", "btl") if src.get(k)},
                                    **({"via": "image"} if any(so.get("via") == "image" for _, so in sib) else {}),
                                    "same_as": sorted({sc["registration"] for sc, _ in sib}, key=lambda r: (len(r), r)),
                                    "note": SAME_AS_NOTE}
                n += 1
            elif o.get("status") == "same_as":
                c["orders"][aid] = {"status": "unreadable", "note": UNREADABLE}
    return n


def decorate(cards: list[dict], vec: dict) -> None:
    """Translated cards borrow their English card's order where it is certain; then ranks and flags on every read order."""
    borrowed = borrow_translations(cards)
    log.info("How-to-vote cards: %d translated-card orders taken from the same registrant's English cards", borrowed)
    ballot = ballots(vec)
    for c in cards:
        if c["kind"] == "party" and not (c.get("registered_by") or "").strip():
            c["party"] = None   # the VEC's list names no registrant
        for aid, o in c["orders"].items():
            o.pop("ranks", None)
            o.pop("flags", None)
            b = ballot.get(aid)
            if not b or o.get("status") not in ("read", "partial") or not (o.get("order") or o.get("atl")):
                continue
            r = ranks(o, b)
            if r:
                o["ranks"] = r
                f = flags(c.get("party"), r, b["house"])
                if f:
                    o["flags"] = f


# Seats where the seat page says which of Labor or the Greens each card ranks higher: every district whose 2022
# two-candidate-preferred count was Labor v Greens (from results_2022/), plus seats named by hand (Prahran: its 2022
# count was Greens v Liberal, but it was asked for on 20 Nov 2026).
LABOR_GREENS_EXTRA = {"prahran": "2022 two-candidate-preferred count: Greens v Liberal"}


def labor_greens_seats(data_dir: Path) -> dict[str, str]:
    """{district id: note} for the Labor-or-Greens panel."""
    out = {}
    for f in sorted((data_dir / "results_2022").glob("*.json")):
        if f.stem == "index":
            continue
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        ids = set(((d.get("tcp") or {}).get("candidates") or {}).keys())
        parties = {c.get("party") for c in d.get("candidates") or [] if c.get("id") in ids}
        if parties == {"ALP", "GRN"}:
            out[f.stem] = "2022 two-candidate-preferred count: Labor v Greens"
    for k, v in LABOR_GREENS_EXTRA.items():
        out.setdefault(k, v)
    return out


def area_doc(aid: str, b: dict, cards: list[dict], no_card: list[str], head: dict) -> dict:
    keep = ("registration", "registered_by", "kind", "party", "candidate", "type", "registered_on", "card_url")
    rows = []
    for c in cards:
        o = c["orders"].get(aid) or {"status": "pending"}
        rows.append({**{k: c.get(k) for k in keep}, **o, **({"notes": c["notes"]} if c.get("notes") else {})})
    rows.sort(key=lambda r: (r["kind"] != "party", r.get("party") or "", r.get("registered_on") or "", int(r["registration"]) if str(r["registration"]).isdigit() else 0))
    cands = [{k: c.get(k) for k in ("ballot_name", "name", "party", "party_label", "ballot_position", "group", "id") if c.get(k) is not None}
             for c in b["candidates"]]
    doc = {"area": aid, "house": b["house"], "name": b["name"], **{k: v for k, v in head.items() if k != "labor_greens"}, "ballot": cands}
    if b["house"] == "upper":
        doc["groups"] = [{k: g.get(k) for k in ("group", "label", "party")} for g in b["groups"]]
    doc["cards"] = rows
    doc["no_card"] = no_card
    if head.get("labor_greens", {}).get(aid):
        doc["labor_greens"] = head["labor_greens"][aid]
    return doc


def watch_rows(cards: list[dict], vec: dict) -> list[dict]:
    """Per district and party (Labor, Liberal, Nationals, One Nation, Greens): how many cards, how many read, and
    where they put the tracked parties when every read card agrees."""
    ballot = ballots(vec)
    groups: dict[tuple, list] = {}
    for c in cards:
        if c["kind"] != "party" or c.get("party") not in ("ALP", "LIB", "NAT", "ONP", "GRN"):
            continue
        for aid, o in c["orders"].items():
            if ballot.get(aid, {}).get("house") == "lower":
                groups.setdefault((aid, c["party"]), []).append((c, o))
    out = []
    for (aid, party), items in sorted(groups.items()):
        read = [o for _, o in items if o.get("ranks")]
        same = len({json.dumps(o["ranks"], sort_keys=True) for o in read}) == 1
        row = {"area": aid, "party": party, "cards": len(items), "read": len(read)}
        if read and same:
            row["ranks"] = read[0]["ranks"]
            if read[0].get("flags"):
                row["flags"] = read[0]["flags"]
        elif read:
            row["differ"] = True
            fl = {json.dumps(f, sort_keys=True) for o in read for f in o.get("flags") or []}
            if fl:
                row["flags_some"] = [json.loads(f) for f in sorted(fl)]
        row["card_url"] = next((c["card_url"] for c, o in items if o.get("ranks")), items[0][0]["card_url"])
        out.append(row)
    return out


def write_files(data_dir: Path, doc: dict, vec: dict, write_json) -> None:
    """htv.json, htv/<area>.json and htv/index.json. write_json(path, data) writes atomically."""
    cov = coverage(doc["cards"], vec)
    no_card = cov.pop("_no_card_by_area")
    doc["coverage"] = cov
    write_json(data_dir / "htv.json", doc)
    head = {"status": doc["status"], "source_url": doc["source_url"], "registration_closes": doc.get("registration_closes")}
    ballot = ballots(vec)
    lvg = labor_greens_seats(data_dir)
    folder = data_dir / "htv"
    folder.mkdir(exist_ok=True)
    by_area: dict[str, list] = {a: [] for a in ballot}
    for c in doc["cards"]:
        for a in c["areas"]:
            by_area.setdefault(a, []).append(c)
    areas = {}
    for aid, b in ballot.items():
        cs = by_area.get(aid, [])
        write_json(folder / f"{aid}.json", area_doc(aid, b, cs, no_card.get(aid, []), {**head, "labor_greens": lvg}))
        st = [c["orders"].get(aid, {}).get("status") for c in cs]
        parties: dict[str, int] = {}
        for c in cs:
            k = c["party"] if c["kind"] == "party" else ("IND" if c["kind"] == "independent" else "NONCAND")
            parties[k] = parties.get(k, 0) + 1
        areas[aid] = {"house": b["house"], "cards": len(cs), "read": sum(s in ("read", "partial") for s in st), "same_as": st.count("same_as"),
                      "unreadable": st.count("unreadable"), "parties": parties, "no_card": len(no_card.get(aid, []))}
    for stale in folder.glob("*.json"):
        if stale.stem not in ballot and stale.stem != "index":
            stale.unlink()
    index = {"_schema": {"description": "Summary of htv.json: coverage counts, per-area counts and, per district, where "
                                        "Labor's, the Liberals', the Nationals', One Nation's and the Greens' cards put Labor, "
                                        "the Coalition, the Greens and One Nation. Generated by scripts/vec_htv.py.",
                         "fields": {"areas": "{area id: {house, cards, read, same_as, unreadable, parties: {code: cards}, no_card}}",
                                    "htv/<area>.json": "{area, house, name, status, source_url, registration_closes, ballot: "
                                                       "[candidates in ballot order], groups (Council), cards: [each card with "
                                                       "this area's order, as in htv.json], no_card: [ballot names], "
                                                       "labor_greens (seats whose page says which of Labor or the Greens "
                                                       "each card ranks higher: why the seat is listed)}",
                                    "watch": "[{area, party, cards, read, ranks (when every read card agrees), differ, "
                                             "flags, flags_some, card_url}]"}},
             **head, "last_checked": doc.get("last_checked"), "coverage": cov, "areas": areas, "watch": watch_rows(doc["cards"], vec)}
    write_json(folder / "index.json", index)


def run(data_dir: Path, pdf_dir: Path | None, write_json, today: str, now_iso: str, max_new: int = 2000) -> tuple[dict, list[dict]]:
    """Read the register and any new cards, then write the files. Raises if the register can't be read (files untouched)."""
    path = data_dir / "htv.json"
    try:
        existing = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        existing = {}
    vec = json.loads((data_dir / "vec_nominations.json").read_text(encoding="utf-8"))
    web = Polite()
    known = {c["registration"]: c["kind"] for c in existing.get("cards") or [] if c.get("kind")}
    register = read_register(web, known)
    core, changes = build(register, existing, vec, lambda url: fetch_pdf(web, url, pdf_dir), today, max_new=max_new)
    decorate(core["cards"], vec)
    doc = {"_schema": SCHEMA, "status": status_for(today), "registration_opens": REG_OPENS, "registration_closes": REG_CLOSES,
           "source_url": REGISTER_PAGE, "last_checked": now_iso, "pending": core["pending"],
           "coverage": None, "cards": core["cards"],
           "changes": (changes + (existing.get("changes") or []))[:300]}
    write_files(data_dir, doc, vec, write_json)
    log.info("How-to-vote cards: %d registrations (%d requests); %d changes; %d orders pending",
             len(doc["cards"]), web.count, len(changes), core["pending"])
    return doc, changes


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data-dir", type=Path, required=True)
    ap.add_argument("--pdf-dir", type=Path, default=PDF_CACHE,
                    help=f"where card PDFs are saved and reused (default {PDF_CACHE}, or VEC_HTV_PDF_DIR)")
    ap.add_argument("--max-new", type=int, default=2000, help="most card PDFs to read in one run")
    ap.add_argument("--rewrite", action="store_true",
                    help="no fetching: recompute ranks, flags and coverage from htv.json and rewrite htv/ (after a code change)")
    ap.add_argument("--reread", action="store_true",
                    help="no fetching: read the unreadable orders again from the PDFs saved in --pdf-dir (after a reader change)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("pdfminer").setLevel(logging.ERROR)
    from zoneinfo import ZoneInfo

    def write_json(p: Path, data):
        # Same format as refresh.py's write_json, written to a temporary file and moved into place (a synced folder
        # such as OneDrive can briefly refuse to open the file itself for writing).
        tmp = p.with_name(f".{p.name}.tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        for attempt in range(5):
            try:
                os.replace(tmp, p)
                return
            except OSError:
                if attempt == 4:
                    raise
                time.sleep(1)
    if args.rewrite or args.reread:
        doc = json.loads((args.data_dir / "htv.json").read_text(encoding="utf-8"))
        vec = json.loads((args.data_dir / "vec_nominations.json").read_text(encoding="utf-8"))
        if args.reread:
            ballot, gained = ballots(vec), 0
            for c in doc["cards"]:
                again = [a for a, o in c["orders"].items() if o.get("status") == "unreadable" and o.get("via") != "hand"]
                path = args.pdf_dir / pdf_name(c["card_url"]) if c.get("card_url") else None
                if not again or not path or not path.exists():
                    continue
                for a, o in read_card(path.read_bytes(), again, ballot).items():
                    if o.get("status") != "unreadable":
                        c["orders"][a] = o
                        gained += 1
            log.info("Re-read: %d more orders read", gained)
        doc["_schema"] = SCHEMA
        decorate(doc["cards"], vec)
        write_files(args.data_dir, doc, vec, write_json)
        print(json.dumps(doc["coverage"], indent=1))
        return 0
    now = datetime.now(ZoneInfo("UTC")).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    doc, changes = run(args.data_dir, args.pdf_dir, write_json, datetime.now(ZoneInfo("Australia/Melbourne")).date().isoformat(), now,
                       max_new=args.max_new)
    print(json.dumps(doc["coverage"], indent=1))
    for ch in changes[:20]:
        print(ch["kind"], ch["registration"], ch["registered_by"], ", ".join(ch["areas"][:6]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
