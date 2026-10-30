#!/usr/bin/env python3
"""Build simplified district and region boundaries for the site's maps.

Source: Vicmap Admin `state_assembly_2022` (the 2021 redivision boundaries,
used in 2022 and 2026) from the Victorian open data WFS, which is where the
VEC's "Download boundary maps" page points for spatial data (the VEC itself
only offers PDF/PNG maps). CC BY 4.0, © State of Victoria.

Simplification is topology-preserving (the `topojson` package: shared borders
are simplified once, so neighbouring districts never gap or overlap), the
Python equivalent of `mapshaper -simplify`. Regions are the union of their
simplified districts, so region and district borders line up exactly.

Outputs (run by hand; not part of the daily refresh):
    site/data/geo/districts.geojson   {id, name, region}
    site/data/geo/regions.geojson     {id, name}

    pip install shapely topojson requests
    python scripts/build_boundaries.py [--epsilon 0.0006]
Downloads are cached in .cache/vicmap/ (git-ignored). On Windows keep the venv
on a short path: shapely's DLLs fail to load from very long paths.
"""
import argparse
import json
import re
from pathlib import Path

import requests
import topojson
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "vicmap" / "state_assembly_2022_4326.json"
OUT = ROOT / "site" / "data" / "geo"
WFS = ("https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature"
       "&typeNames=open-data-platform:state_assembly_2022&outputFormat=application/json")
MAX_BYTES = 1.5 * 1024 * 1024


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def rounded(geom, places=4):
    """GeoJSON geometry with coordinates rounded (4 dp is about 10 m)."""
    def r(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], places), round(c[1], places)]
        return [r(x) for x in c]
    g = mapping(geom)
    return {"type": g["type"], "coordinates": r(g["coordinates"])}


def write(path, features):
    fc = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(fc, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    return path.stat().st_size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epsilon", type=float, default=0.0006,
                    help="Douglas-Peucker tolerance in degrees (0.0006 is about 60 m)")
    args = ap.parse_args()

    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        resp = requests.get(WFS, timeout=300, headers={"User-Agent": "vic-election-tracker/1.0 (boundary map build)"})
        resp.raise_for_status()
        CACHE.write_bytes(resp.content)
    src = json.loads(CACHE.read_text(encoding="utf-8"))

    known = {d["id"] for d in json.loads((ROOT / "site/data/districts.json").read_text(encoding="utf-8"))["districts"]}
    feats = []
    for f in src["features"]:
        p = f["properties"]
        did = slug(p["district_label"].removesuffix(" District"))
        assert did in known, did
        feats.append({"type": "Feature", "geometry": f["geometry"],
                      "properties": {"id": did, "name": p["district_label"].removesuffix(" District"),
                                     "region": slug(p["region_label"].removesuffix(" Region")),
                                     "region_name": p["region_label"].removesuffix(" Region")}})

    topo = topojson.Topology({"type": "FeatureCollection", "features": feats}, prequantize=1e6,
                             toposimplify=args.epsilon, simplify_algorithm="dp")
    simplified = json.loads(topo.to_geojson())

    OUT.mkdir(parents=True, exist_ok=True)
    districts, by_region = [], {}
    for f in simplified["features"]:
        p = f["properties"]
        geom = shape(f["geometry"]).buffer(0)
        by_region.setdefault((p["region"], p["region_name"]), []).append(geom)
        districts.append({"type": "Feature", "properties": {"id": p["id"], "name": p["name"], "region": p["region"]},
                          "geometry": rounded(geom)})
    districts.sort(key=lambda f: f["properties"]["id"])
    regions = [{"type": "Feature", "properties": {"id": rid, "name": name},
                "geometry": rounded(unary_union(geoms).buffer(0))}
               for (rid, name), geoms in sorted(by_region.items())]

    size = write(OUT / "districts.geojson", districts) + write(OUT / "regions.geojson", regions)
    print(f"{len(districts)} districts, {len(regions)} regions, {size / 1024:.0f} KB total")
    if size > MAX_BYTES:
        raise SystemExit(f"Over the {MAX_BYTES / 1024 / 1024:.1f} MB budget; raise --epsilon")


if __name__ == "__main__":
    main()
