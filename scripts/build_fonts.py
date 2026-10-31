"""Self-hosted web fonts: Archivo and Inter (SIL Open Font License 1.1, no Reserved Font Names).

Downloads Google Fonts' variable WOFF2 files for the Latin, Latin Extended and Vietnamese subsets,
limits the weight axis to the weights the site uses, drops hinting, and writes
site/fonts/<family>-<subset>.woff2 plus each family's licence. The @font-face rules are at the top
of site/css/style.css; each page preloads only the two Latin files, and the browser fetches the
other subsets only for text that needs them (unicode-range).

Run by hand when changing fonts or weights: python scripts/build_fonts.py   (needs fonttools, brotli)
"""
import io
import re
import urllib.request
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "fonts"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
FAMILIES = {"Archivo": (600, 800), "Inter": (400, 700)}   # weight range the CSS uses
SUBSETS = ("latin", "latin-ext", "vietnamese")
FEATURES = ["kern", "liga", "calt", "tnum", "lnum", "case", "ccmp", "locl", "mark", "mkmk"]   # tnum: tabular figures
LICENCES = {"Archivo": "https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/OFL.txt",
            "Inter": "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
        return r.read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for family, (lo, hi) in FAMILIES.items():
        css = get(f"https://fonts.googleapis.com/css2?family={family}:wght@{lo}..{hi}&display=swap").decode()
        for subset in SUBSETS:
            m = re.search(rf"/\* {subset} \*/\s*@font-face\s*{{[^}}]*?src: url\(([^)]+)\)[^}}]*?unicode-range: ([^;]+);", css)
            if not m:
                print(f"{family}: no {subset} subset")
                continue
            font = TTFont(io.BytesIO(get(m.group(1))))
            buf = io.BytesIO()
            instancer.instantiateVariableFont(font, {"wght": (lo, hi)}).save(buf)
            font = TTFont(io.BytesIO(buf.getvalue()))   # reload: subsetting a font straight from the instancer fails
            opts = Options()
            opts.flavor = "woff2"
            opts.hinting = False
            opts.layout_features = FEATURES
            opts.unicodes = []
            sub = Subsetter(opts)
            sub.populate(unicodes=font.getBestCmap().keys())
            sub.subset(font)
            path = OUT / f"{family.lower()}-{subset}.woff2"
            font.flavor = "woff2"
            font.save(path)
            print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.1f} KB  unicode-range: {m.group(2)}")
        (OUT / f"OFL-{family}.txt").write_bytes(get(LICENCES[family]))


if __name__ == "__main__":
    main()
