import json, os, shutil, sys
import cairosvg
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from PIL import Image

S = sys.argv[1]
FONT = os.path.join(S, "fontdl/package/files/nunito-latin-800-normal.woff")
OUT = os.path.join(S, "pengou-logo-kit")
shutil.rmtree(OUT, ignore_errors=True)

NAVY, CORAL, CYAN, WHITE, BLACK = "#0B2545", "#FF7A3C", "#00A6CC", "#FFFFFF", "#000000"

def mk(p):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p

def write(path, text):
    with open(mk(path), "w", encoding="utf-8") as fh:
        fh.write(text)

# ---------- symbol geometry (design grid: outer circle centre 50,50 r38) ----------
def circle_d(cx, cy, r):
    return (f"M{cx - r:g} {cy:g}a{r:g} {r:g} 0 1 0 {2 * r:g} 0a{r:g} {r:g} 0 1 0 {-2 * r:g} 0Z")

OUTER = (50, 50, 38)
INNER = (58, 52, 28)
BEAK = "M58 48L76 54L58 60Z"

def symbol_body(ink, belly, beak):
    """belly=None -> belly is a knockout (transparent)."""
    if belly is None:
        return (f'<path fill="{ink}" fill-rule="evenodd" d="{circle_d(*OUTER)}{circle_d(*INNER)}"/>'
                f'<path fill="{beak}" stroke="{beak}" stroke-width="3" stroke-linejoin="round" d="{BEAK}"/>')
    return (f'<circle cx="{OUTER[0]}" cy="{OUTER[1]}" r="{OUTER[2]}" fill="{ink}"/>'
            f'<circle cx="{INNER[0]}" cy="{INNER[1]}" r="{INNER[2]}" fill="{belly}"/>'
            f'<path fill="{beak}" stroke="{beak}" stroke-width="3" stroke-linejoin="round" d="{BEAK}"/>')

SYM_BOX = (12, 12, 76, 76)  # tight crop of the outer circle

# favicon: redrawn on a 32 px grid, thicker crescent and bigger beak
def favicon_body(ink, belly, beak):
    o, i = (16, 16, 15), (19, 17, 10.5)
    b = "M18 14.5L25.5 17L18 19.5Z"
    if belly is None:
        return (f'<path fill="{ink}" fill-rule="evenodd" d="{circle_d(*o)}{circle_d(*i)}"/>'
                f'<path fill="{beak}" stroke="{beak}" stroke-width="1" stroke-linejoin="round" d="{b}"/>')
    return (f'<circle cx="16" cy="16" r="15" fill="{ink}"/><circle cx="19" cy="17" r="10.5" fill="{belly}"/>'
            f'<path fill="{beak}" stroke="{beak}" stroke-width="1" stroke-linejoin="round" d="{b}"/>')

# ---------- wordmark: Nunito ExtraBold outlined ----------
font = TTFont(FONT)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
TRACK = 12  # font units

def word_path(text):
    pen = SVGPathPen(gs)
    bp = BoundsPen(gs)
    x = 0
    for ch in text:
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (1, 0, 0, -1, x, 0))
        gs[g].draw(tp)
        gs[g].draw(TransformPen(bp, (1, 0, 0, -1, x, 0)))
        x += gs[g].width + TRACK
    return pen.getCommands(), bp.bounds  # bounds in y-down units, baseline at 0

WORD_D, WB = word_path("pengou")  # WB = (xmin, ymin, xmax, ymax), ymin = top of i-dot (negative)
XH = font["OS/2"].sxHeight

def wordmark_group(color, scale, tx, ty):
    return f'<g transform="translate({tx:.3f} {ty:.3f}) scale({scale:.5f})"><path fill="{color}" d="{WORD_D}"/></g>'

D = 76.0  # symbol diameter in symbol units

def svg_doc(w, h, inner, bg=None, vb=None):
    vb = vb or f"0 0 {w:.3f} {h:.3f}"
    bgr = f'<rect x="{vb.split()[0]}" y="{vb.split()[1]}" width="100%" height="100%" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w:.3f}" height="{h:.3f}">'
            f'<title>Pengou</title>{bgr}{inner}</svg>\n')

def sym_at(body, x, y, size):
    s = size / D
    return f'<g transform="translate({x:.3f} {y:.3f}) scale({s:.5f}) translate(-12 -12)">{body}</g>'

def horizontal(body, text_color):
    # x-height band centred on the circle centre; x-height = 0.40 D
    s = 0.40 * D / XH
    gap = 0.20 * D
    tw = (WB[2] - WB[0]) * s
    base = D / 2 + XH * s / 2
    top = min(0, base + WB[1] * s)
    bottom = max(D, base + WB[3] * s)
    h = bottom - top
    w = D + gap + tw
    inner = sym_at(body, 0, -top, D) + wordmark_group(text_color, s, D + gap - WB[0] * s, base - top)
    return w, h, inner

def vertical(body, text_color):
    s = 0.34 * D / XH
    tw = (WB[2] - WB[0]) * s
    gap = 0.16 * D
    w = max(D, tw)
    base = D + gap - WB[1] * s
    h = base + WB[3] * s
    inner = sym_at(body, (w - D) / 2, 0, D) + wordmark_group(text_color, s, (w - tw) / 2 - WB[0] * s, base)
    return w, h, inner

def wordmark_only(text_color):
    s = 1.0
    w = WB[2] - WB[0]
    h = WB[3] - WB[1]
    return w / 10, h / 10, wordmark_group(text_color, s / 10, -WB[0] / 10, -WB[1] / 10)

VARIANTS = {
    # name: (symbol body, text colour, preview bg)
    "couleur":    (symbol_body(NAVY, WHITE, CORAL), NAVY, "#FFFFFF"),
    "inverse":    (symbol_body(WHITE, None, CORAL), WHITE, NAVY),
    "bleu-nuit":  (symbol_body(NAVY, None, NAVY), NAVY, "#FFFFFF"),
    "noir":       (symbol_body(BLACK, None, BLACK), BLACK, "#FFFFFF"),
    "blanc":      (symbol_body(WHITE, None, WHITE), WHITE, "#333333"),
}
FAV = {
    "couleur": favicon_body(NAVY, WHITE, CORAL),
    "inverse": favicon_body(WHITE, None, CORAL),
    "bleu-nuit": favicon_body(NAVY, None, NAVY),
    "noir": favicon_body(BLACK, None, BLACK),
    "blanc": favicon_body(WHITE, None, WHITE),
}

def png(svg_text, path, width=None, height=None, dpi=None):
    kw = {}
    if width: kw["output_width"] = int(round(width))
    if height: kw["output_height"] = int(round(height))
    if dpi: kw["dpi"] = dpi
    cairosvg.svg2png(bytestring=svg_text.encode(), write_to=mk(path), **kw)

def pdf(svg_text, path):
    cairosvg.svg2pdf(bytestring=svg_text.encode(), write_to=mk(path))

sources = {}  # (kind, variant) -> svg text

# ---------- 1. SVG sources ----------
for v, (body, tc, _) in VARIANTS.items():
    sym = svg_doc(D, D, body, vb="12 12 76 76")
    sources[("symbole", v)] = sym
    write(f"{OUT}/svg/symbole/pengou-symbole-{v}.svg", sym)
    w, h, inner = horizontal(body, tc)
    sources[("logo-horizontal", v)] = svg_doc(w, h, inner)
    write(f"{OUT}/svg/logo-horizontal/pengou-logo-horizontal-{v}.svg", sources[("logo-horizontal", v)])
    w, h, inner = vertical(body, tc)
    sources[("logo-vertical", v)] = svg_doc(w, h, inner)
    write(f"{OUT}/svg/logo-vertical/pengou-logo-vertical-{v}.svg", sources[("logo-vertical", v)])
    w, h, inner = wordmark_only(tc)
    sources[("logotype", v)] = svg_doc(w, h, inner)
    write(f"{OUT}/svg/logotype/pengou-logotype-{v}.svg", sources[("logotype", v)])

for v, body in FAV.items():
    write(f"{OUT}/svg/favicon/pengou-favicon-{v}.svg", svg_doc(32, 32, body, vb="0 0 32 32"))

# ---------- 2. PNG web ----------
SYM_SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 256, 512, 1024]
for v in VARIANTS:
    for sz in SYM_SIZES:
        src = svg_doc(32, 32, FAV.get(v, ""), vb="0 0 32 32") if (sz <= 48 and v in FAV) else sources[("symbole", v)]
        png(src, f"{OUT}/png/symbole/{v}/pengou-symbole-{v}-{sz}.png", sz, sz)
    for kind in ("logo-horizontal", "logotype"):
        for hpx in (32, 48, 64, 128, 256):
            png(sources[(kind, v)], f"{OUT}/png/{kind}/{v}/pengou-{kind}-{v}-h{hpx}.png", height=hpx)
    for hpx in (128, 256, 512, 1024):
        png(sources[("logo-vertical", v)], f"{OUT}/png/logo-vertical/{v}/pengou-logo-vertical-{v}-h{hpx}.png", height=hpx)

# ---------- 3. favicons, app icons, manifest ----------
W = f"{OUT}/web"
write(f"{W}/favicon.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>Pengou</title>'
      f'<style>.i{{fill:{NAVY}}}.b{{fill:{WHITE}}}@media (prefers-color-scheme: dark){{.i{{fill:{WHITE}}}.b{{fill:{NAVY}}}}}</style>'
      '<circle class="i" cx="16" cy="16" r="15"/><circle class="b" cx="19" cy="17" r="10.5"/>'
      f'<path fill="{CORAL}" stroke="{CORAL}" stroke-width="1" stroke-linejoin="round" d="M18 14.5L25.5 17L18 19.5Z"/></svg>\n')
fav_src = svg_doc(32, 32, FAV["couleur"], vb="0 0 32 32")
for sz in (16, 32, 48):
    png(fav_src, f"{W}/favicon-{sz}x{sz}.png", sz, sz)
Image.open(f"{W}/favicon-48x48.png").save(f"{W}/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

def icon(size, bg, body, ratio, path, round_mask=False):
    inner_size = size * ratio
    off = (size - inner_size) / 2
    doc = svg_doc(size, size, f'<rect width="{size}" height="{size}" fill="{bg}"/>' + sym_at(body, off, off, inner_size))
    png(doc, path, size, size)
    return doc

ICON_DARK = VARIANTS["inverse"][0]
ICON_LIGHT = VARIANTS["couleur"][0]
icon(180, NAVY, ICON_DARK, 0.66, f"{W}/apple-touch-icon.png")
icon(192, NAVY, ICON_DARK, 0.70, f"{W}/android-chrome-192x192.png")
icon(512, NAVY, ICON_DARK, 0.70, f"{W}/android-chrome-512x512.png")
icon(512, NAVY, ICON_DARK, 0.56, f"{W}/maskable-512x512.png")
write(f"{W}/site.webmanifest", json.dumps({
    "name": "Pengou", "short_name": "Pengou",
    "icons": [
        {"src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "/maskable-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
    "theme_color": NAVY, "background_color": NAVY, "display": "standalone"}, indent=2, ensure_ascii=False) + "\n")
write(f"{W}/head-snippet.html",
      '<link rel="icon" href="/favicon.ico" sizes="48x48">\n'
      '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
      '<link rel="manifest" href="/site.webmanifest">\n'
      f'<meta name="theme-color" content="{NAVY}">\n'
      '<meta property="og:image" content="/og-image.png">\n')

# ---------- 4. social ----------
SO = f"{OUT}/social"
def social_card(w, h, bg, variant, path, logo_w_ratio):
    lw, lh, inner = horizontal(VARIANTS[variant][0], VARIANTS[variant][1])
    target_w = w * logo_w_ratio
    s = target_w / lw
    tx, ty = (w - lw * s) / 2, (h - lh * s) / 2
    doc = svg_doc(w, h, f'<rect width="{w}" height="{h}" fill="{bg}"/><g transform="translate({tx:.2f} {ty:.2f}) scale({s:.5f})">{inner}</g>')
    png(doc, path, w, h)
social_card(1200, 630, NAVY, "inverse", f"{SO}/og-image-1200x630-sombre.png", 0.5)
social_card(1200, 630, "#F3F7FA", "couleur", f"{SO}/og-image-1200x630-clair.png", 0.5)
social_card(1500, 500, NAVY, "inverse", f"{SO}/banniere-1500x500-sombre.png", 0.36)
icon(512, NAVY, ICON_DARK, 0.60, f"{SO}/avatar-512-sombre.png")
icon(512, "#FFFFFF", ICON_LIGHT, 0.60, f"{SO}/avatar-512-clair.png")
icon(512, CYAN, ICON_LIGHT, 0.60, f"{SO}/avatar-512-cyan.png")
shutil.copy(f"{SO}/og-image-1200x630-sombre.png", f"{W}/og-image.png")

# ---------- 5. print ----------
P = f"{OUT}/print"
for v in VARIANTS:
    for kind in ("symbole", "logo-horizontal", "logo-vertical", "logotype"):
        pdf(sources[(kind, v)], f"{P}/pdf-vectoriel/pengou-{kind}-{v}.pdf")
MM = 300 / 25.4
for v in ("couleur", "inverse", "noir"):
    for mm in (50, 100, 200):
        png(sources[("logo-horizontal", v)], f"{P}/png-300dpi/pengou-logo-horizontal-{v}-{mm}mm.png", width=mm * MM)
    for mm in (20, 50, 100):
        png(sources[("symbole", v)], f"{P}/png-300dpi/pengou-symbole-{v}-{mm}mm.png", width=mm * MM)
    for mm in (40, 80):
        png(sources[("logo-vertical", v)], f"{P}/png-300dpi/pengou-logo-vertical-{v}-{mm}mm.png", width=mm * MM)
# set 300 dpi metadata
for root, _, files in os.walk(f"{P}/png-300dpi"):
    for fn in files:
        p = os.path.join(root, fn)
        im = Image.open(p); im.load(); im.save(p, dpi=(300, 300))

# ---------- 6. preview sheet ----------
cells = []
y = 40
cells.append(f'<text x="40" y="{y + 30}" font-family="sans-serif" font-size="30" font-weight="700" fill="{NAVY}">Pengou — kit logo Croissant</text>')
y += 70
for v, (body, tc, bg) in VARIANTS.items():
    cells.append(f'<rect x="40" y="{y}" width="1520" height="190" rx="16" fill="{bg}" stroke="#DDE2E8"/>')
    cells.append(f'<text x="60" y="{y + 30}" font-family="sans-serif" font-size="16" fill="{"#9FB3C8" if bg in (NAVY, "#333333") else "#3D4F66"}">{v}</text>')
    cells.append(sym_at(body, 70, y + 50, 110))
    lw, lh, inner = horizontal(body, tc)
    s = 110 / lh
    cells.append(f'<g transform="translate(260 {y + 50}) scale({s:.4f})">{inner}</g>')
    vw, vh, vin = vertical(body, tc)
    s2 = 150 / vh
    cells.append(f'<g transform="translate({760:.1f} {y + 25}) scale({s2:.4f})">{vin}</g>')
    ww, wh, win = wordmark_only(tc)
    s3 = 70 / wh
    cells.append(f'<g transform="translate(1040 {y + 60}) scale({s3:.4f})">{win}</g>')
    y += 210
sheet = svg_doc(1600, y + 20, "".join(cells), bg="#F3F7FA")
png(sheet, f"{OUT}/apercu-kit.png", 1600)
print("done", OUT)
