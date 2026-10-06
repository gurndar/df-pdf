# Generate a ~800MB, 1081-page PDF: text + one unique incompressible RGB image per page.
#   python3 gen.py [pages] [out.pdf] [--outline] [--links]
#     --outline  chapter/section bookmarks (chapters every 100 pages, sections every 25)
#     --links    a "See page N" internal link on every page, plus a web link on page 1
#     --small    tiny images (a few MB total) for fast CI runs; same pages, text and links
import os, zlib, sys
W, H = (8, 8) if "--small" in sys.argv else (490, 500)  # ~735KB raw RGB per page by default
args = [a for a in sys.argv[1:] if not a.startswith("--")]
PAGES = int(args[0]) if args else 1081
OUT = args[1] if len(args) > 1 else "big.pdf"
OUTLINE = "--outline" in sys.argv
LINKS = "--links" in sys.argv
URL = "https://example.com/"

def page_obj(i): return 4 + 3*i
def link_target(i): return (i + 100) % PAGES  # 0-based page that page i links to

# Object numbers: 1 catalog, 2 pages, 3 font; per page i: page, content, image;
# then outline objects, then link annotations.
chapters = [(f"Chapter {c+1}", c*100, [(f"{c+1}.{k+1} Section", c*100 + k*25) for k in range(4) if c*100 + k*25 < PAGES])
            for c in range((PAGES + 99) // 100)] if OUTLINE else []
OUTLINES = 4 + 3*PAGES
n_outline = (1 + sum(1 + len(s) for _, _, s in chapters)) if OUTLINE else 0
ANNOTS = OUTLINES + n_outline          # internal link annotation for page i: ANNOTS + i
URI_ANNOT = ANNOTS + PAGES             # web link on page 1
TOTAL = URI_ANNOT + 1 if LINKS else ANNOTS

out = open(OUT, "wb")
offsets = {}
def obj(n, body):
    offsets[n] = out.tell()
    out.write(f"{n} 0 obj\n".encode()); out.write(body); out.write(b"\nendobj\n")

out.write(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
kids = " ".join(f"{page_obj(i)} 0 R" for i in range(PAGES))
obj(1, (f"<< /Type /Catalog /Pages 2 0 R /Outlines {OUTLINES} 0 R /PageMode /UseOutlines >>" if OUTLINE
        else "<< /Type /Catalog /Pages 2 0 R >>").encode())
obj(2, f"<< /Type /Pages /Count {PAGES} /Kids [{kids}] >>".encode())
obj(3, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
for i in range(PAGES):
    p, c, im = page_obj(i), page_obj(i) + 1, page_obj(i) + 2
    annots = ""
    if LINKS:
        refs = [f"{ANNOTS + i} 0 R"] + ([f"{URI_ANNOT} 0 R"] if i == 0 else [])
        annots = f" /Annots [{' '.join(refs)}]"
    obj(p, f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 {im} 0 R >> >> /Contents {c} 0 R{annots} >>".encode())
    s = f"BT /F1 24 Tf 72 720 Td (Page {i+1}) Tj ET q 468 0 0 477 72 200 cm /Im0 Do Q"
    if LINKS:
        s += f" BT /F1 14 Tf 72 160 Td (See page {link_target(i)+1}) Tj ET"
        if i == 0:
            s += f" BT /F1 14 Tf 300 160 Td (Visit {URL}) Tj ET"
    s = s.encode()
    obj(c, b"<< /Length %d >>\nstream\n" % len(s) + s + b"\nendstream")
    data = zlib.compress(os.urandom(W*H*3), 1)
    obj(im, f"<< /Type /XObject /Subtype /Image /Width {W} /Height {H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream")

if OUTLINE:
    nums = {}
    nxt = OUTLINES + 1
    for ci, (_, _, secs) in enumerate(chapters):
        nums[ci] = nxt; nxt += 1
        for si in range(len(secs)):
            nums[(ci, si)] = nxt; nxt += 1
    def item(num, title, page, parent, prev, next_, kids=None):
        d = f"<< /Title ({title}) /Parent {parent} 0 R /Dest [{page_obj(page)} 0 R /Fit]"
        if prev: d += f" /Prev {prev} 0 R"
        if next_: d += f" /Next {next_} 0 R"
        if kids: d += f" /First {kids[0]} 0 R /Last {kids[-1]} 0 R /Count -{len(kids)}"
        obj(num, (d + " >>").encode())
    tops = [nums[ci] for ci in range(len(chapters))]
    obj(OUTLINES, f"<< /Type /Outlines /First {tops[0]} 0 R /Last {tops[-1]} 0 R /Count {len(tops)} >>".encode())
    for ci, (title, page, secs) in enumerate(chapters):
        kids = [nums[(ci, si)] for si in range(len(secs))]
        item(nums[ci], title, page, OUTLINES, tops[ci-1] if ci else None, tops[ci+1] if ci+1 < len(tops) else None, kids)
        for si, (stitle, spage) in enumerate(secs):
            item(kids[si], stitle, spage, nums[ci], kids[si-1] if si else None, kids[si+1] if si+1 < len(kids) else None)

if LINKS:
    for i in range(PAGES):
        obj(ANNOTS + i, f"<< /Type /Annot /Subtype /Link /Rect [70 155 200 175] /Border [0 0 0] /Dest [{page_obj(link_target(i))} 0 R /XYZ null null null] >>".encode())
    obj(URI_ANNOT, f"<< /Type /Annot /Subtype /Link /Rect [298 155 470 175] /Border [0 0 0] /A << /S /URI /URI ({URL}) >> >>".encode())

xref = out.tell()
out.write(f"xref\n0 {TOTAL}\n0000000000 65535 f \n".encode())
for k in range(1, TOTAL):
    out.write(f"{offsets[k]:010d} 00000 n \n".encode())
out.write(f"trailer\n<< /Size {TOTAL} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
out.close()
print(os.path.getsize(OUT)/1e6, "MB")
