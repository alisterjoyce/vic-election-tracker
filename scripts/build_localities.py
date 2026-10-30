#!/usr/bin/env python3
"""Build site/data/localities.json: locality and postcode -> state district(s).

The VEC publishes no downloadable locality-to-district list (its lookup is
address-based), so this intersects Vicmap Admin polygons from the Victorian
open data WFS (opendata.maps.vic.gov.au, CC BY 4.0):
  state_assembly_2022  district boundaries (2021 redivision, used in 2022 and 2026)
  locality_polygon     suburbs and towns
  postcode_polygon     postcodes
Shares are by land area (EPSG:3111, metres), not population.

Run occasionally by hand (not part of the daily refresh); needs shapely:
    pip install shapely requests
    python scripts/build_localities.py
Downloads (~140 MB) are cached in .cache/vicmap/ (git-ignored).
On Windows, keep the venv on a short path: shapely's DLLs fail to load from very long paths.
"""
import json, re, sys, time
from pathlib import Path

import requests
from shapely.geometry import shape
from shapely.strtree import STRtree
from shapely.validation import make_valid

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
WFS = ("https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature"
       "&typeNames=open-data-platform:{layer}&outputFormat=application/json&srsName=EPSG:3111")
geo = ROOT / ".cache" / "vicmap"
districts_path = ROOT / "site" / "data" / "districts.json"
out_path = ROOT / "site" / "data" / "localities.json"

geo.mkdir(parents=True, exist_ok=True)
for layer in ("state_assembly_2022", "locality_polygon", "postcode_polygon"):
    target = geo / f"{layer}.json"
    if not target.exists():
        print(f"Downloading {layer}...")
        resp = requests.get(WFS.format(layer=layer), timeout=300,
                            headers={"User-Agent": "vic-election-tracker/1.0 (locality lookup build)"})
        resp.raise_for_status()
        target.write_bytes(resp.content)
        time.sleep(1)
MIN_SHARE = 0.02          # keep a district if it covers >= 2% of the locality/postcode area
MIN_POSTCODE_SHARE = 0.05


def load(name):
    feats = json.load(open(f"{geo}/{name}.json", encoding="utf-8"))["features"]
    out = []
    for f in feats:
        g = shape(f["geometry"])
        if not g.is_valid:
            g = make_valid(g)
        out.append((f["properties"], g))
    return out


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def title(name):
    def word(w):
        w = w.capitalize()
        w = re.sub(r"^Mc([a-z])", lambda m: "Mc" + m.group(1).upper(), w)
        w = re.sub(r"(?<=[-'])([a-z])", lambda m: m.group(1).upper(), w)
        return w
    return re.sub(r"[A-Za-z'-]+", lambda m: word(m.group(0)), name.strip())


our_ids = {d["id"] for d in json.load(open(districts_path, encoding="utf-8"))["districts"]}
districts = [(slug(p["district_label"].removesuffix(" District")), g) for p, g in load("state_assembly_2022")]
assert {d for d, _ in districts} == our_ids, sorted({d for d, _ in districts} ^ our_ids)
d_tree = STRtree([g for _, g in districts])

postcodes = [(p["postcode"], g) for p, g in load("postcode_polygon")]
p_tree = STRtree([g for _, g in postcodes])


def overlaps(g, tree, items, min_share):
    area = g.area or 1
    shares = []
    for i in tree.query(g):
        inter = g.intersection(items[i][1]).area
        if inter > 0:
            shares.append((items[i][0], inter / area))
    shares.sort(key=lambda x: -x[1])
    keep = [(k, s) for k, s in shares if s >= min_share] or shares[:1]
    return keep


localities = []
for props, g in load("locality_polygon"):
    ds = overlaps(g, d_tree, districts, MIN_SHARE)
    ps = overlaps(g, p_tree, postcodes, MIN_POSTCODE_SHARE)
    if not ds:
        continue  # offshore / outside all districts
    localities.append({"n": title(props["locality_name"]),
                       "p": sorted({k for k, _ in ps}),
                       "d": [[k, round(s, 2)] for k, s in ds]})
localities.sort(key=lambda x: x["n"])

pcs = []
for code, g in postcodes:
    ds = overlaps(g, d_tree, districts, MIN_SHARE)
    if ds:
        pcs.append({"p": code, "d": [[k, round(s, 2)] for k, s in ds]})
pcs.sort(key=lambda x: x["p"])

doc = {
    "_schema": {
        "description": "Locality (suburb/town) and postcode lookup for site search. Built by intersecting Vicmap Admin polygons (locality_polygon, postcode_polygon) with the state district boundaries (state_assembly_2022, the 2021 redivision used in 2026). The VEC publishes no downloadable locality-to-district list; its lookup is address-based. A locality or postcode can straddle districts; shares are by land area, not population, so check the VEC's lookup for a specific address.",
        "fields": {
            "source": "Data sources and licence",
            "built": "YYYY-MM-DD the file was built",
            "min_share": "Smallest area share kept for a district",
            "localities": "[{n: locality name, p: [postcodes overlapping it], d: [[district id, area share 0-1], ...] largest first}]",
            "postcodes": "[{p: postcode, d: [[district id, area share 0-1], ...] largest first}]",
        },
    },
    "source": "Vicmap Admin (locality_polygon, postcode_polygon, state_assembly_2022) via opendata.maps.vic.gov.au, © State of Victoria (DEECA), CC BY 4.0",
    "built": time.strftime("%Y-%m-%d"),
    "min_share": MIN_SHARE,
    "localities": localities,
    "postcodes": pcs,
}
text = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
open(out_path, "w", encoding="utf-8", newline="\n").write(text + "\n")
print(f"{len(localities)} localities, {len(pcs)} postcodes, {len(text)/1024:.0f} KB")
for name in ("Hopetoun Park", "Bacchus Marsh", "Melton", "St Albans", "McKinnon", "Fitzroy"):
    print(name, [l for l in localities if l["n"] == name])
print("3340", [p for p in pcs if p["p"] == "3340"])
print("multi-district localities:", sum(1 for l in localities if len(l["d"]) > 1))
