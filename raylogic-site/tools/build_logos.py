#!/usr/bin/env python3
"""Erzeugt die Logo-Varianten (SVG) aus der Original-Vektordatei brand/RayLogic_blau_original.svg.

    python3 tools/build_logos.py

Ergebnis in brand/: horizontale, vertikale und kompakte Anordnung sowie die Bildmarke,
jeweils für helle und dunkle Hintergründe. Die SVGs nutzen nur Präsentationsattribute
(kein style/<style>), damit sie unter einer strikten CSP und in allen Programmen funktionieren.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand" / "RayLogic_blau_original.svg"
OUT = ROOT / "brand"

src = SRC.read_text(encoding="utf-8")
d = re.findall(r'<path[^>]*?\sd="([^"]+)"', src)
UPPER, LOWER, WORD = d  # oberer Bogen, unterer Bogen (Bildmarke), Schriftzug

# Bounding Boxes im Original-Koordinatensystem (per Browser gemessen)
MARK = (366.33, 181.98, 475.15, 304.24)
WORDBOX = (240.99, 326.32, 600.92, 376.63)

# Verläufe aus dem Original (userSpaceOnUse)
GRAD = {
    "upper": ((416.875, 181.98), (416.875, 265.176)),
    "lower": ((420.74, 215.692), (420.74, 304.24)),
    "word": ((420.955, 326.32), (420.955, 376.63)),
}
COLORS = {
    "hell": {"upper": ("#005fbb", "#003f75"), "lower": ("#5bafff", "#0068b1"), "word": ("#066db7", "#004576")},
    "dunkel": {"upper": ("#4f9cf0", "#2f74d0"), "lower": ("#8cc8ff", "#3b8fdc"), "word": ("#eef4fc", "#c3dbf7")},
}


def defs(theme, prefix):
    out = []
    for key, ((x1, y1), (x2, y2)) in GRAD.items():
        a, b = COLORS[theme][key]
        out.append(
            f'<linearGradient id="{prefix}-{key}" gradientUnits="userSpaceOnUse" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">'
            f'<stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'
        )
    return "<defs>" + "".join(out) + "</defs>"


def mark(prefix):
    return (f'<path fill="url(#{prefix}-upper)" fill-rule="evenodd" d="{UPPER}"/>'
            f'<path fill="url(#{prefix}-lower)" d="{LOWER}"/>')


def word(prefix):
    return f'<path fill="url(#{prefix}-word)" d="{WORD}"/>'


def svg(viewbox, body, theme, title):
    x, y, w, h = viewbox
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x:.2f} {y:.2f} {w:.2f} {h:.2f}" '
            f'width="{w:.0f}" height="{h:.0f}" role="img" aria-label="{title}">'
            f"<title>{title}</title>{defs(theme, 'rl')}{body}</svg>\n")


PAD = 4
mx0, my0, mx1, my1 = MARK
wx0, wy0, wx1, wy1 = WORDBOX
mw, mh = mx1 - mx0, my1 - my0
ww, wh = wx1 - wx0, wy1 - wy0


def layouts():
    # 1) Bildmarke allein
    yield "bildmarke", (mx0 - PAD, my0 - PAD, mw + 2 * PAD, mh + 2 * PAD), mark("rl")

    # 2) Vertikal wie im Original (Schriftzug breiter als die Marke, zentriert darunter)
    x0, x1 = min(mx0, wx0), max(mx1, wx1)
    yield "vertikal", (x0 - PAD, my0 - PAD, x1 - x0 + 2 * PAD, wy1 - my0 + 2 * PAD), mark("rl") + word("rl")

    # 3) Vertikal kompakt: Schriftzug exakt so breit wie die Marke
    s = mw / ww
    gap = mh * 0.13
    tx = mx0 - wx0 * s
    ty = my1 + gap - wy0 * s
    bottom = my1 + gap + wh * s
    body = mark("rl") + f'<g transform="matrix({s:.5f} 0 0 {s:.5f} {tx:.3f} {ty:.3f})">{word("rl")}</g>'
    yield "vertikal-kompakt", (mx0 - PAD, my0 - PAD, mw + 2 * PAD, bottom - my0 + 2 * PAD), body

    # 4) Horizontal: Schriftzug in Originalgröße rechts neben der Marke, optisch mittig
    gap = mw * 0.32
    dx = mx1 + gap - wx0
    dy = (my0 + my1) / 2 - (326.89 + 376.06) / 2  # Versalhöhe zentriert
    body = mark("rl") + f'<g transform="translate({dx:.3f} {dy:.3f})">{word("rl")}</g>'
    right = wx1 + dx
    yield "horizontal", (mx0 - PAD, my0 - PAD, right - mx0 + 2 * PAD, mh + 2 * PAD), body


for name, vb, body in layouts():
    for theme in ("hell", "dunkel"):
        suffix = "" if theme == "hell" else "-dunkel"
        (OUT / f"raylogic-{name}{suffix}.svg").write_text(svg(vb, body, theme, "RayLogic"), encoding="utf-8")
        print(f"brand/raylogic-{name}{suffix}.svg  viewBox={tuple(round(v, 1) for v in vb)}")
