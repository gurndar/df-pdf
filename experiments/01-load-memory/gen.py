# Generate a ~800MB, 1081-page PDF: text + one unique incompressible RGB image per page.
#   python3 gen.py [pages] [out.pdf] [--outline]   (--outline adds chapters/sections bookmarks)
import os, zlib, sys
W, H = 490, 500  # ~735KB raw RGB per page
args = [a for a in sys.argv[1:] if not a.startswith("--")]
PAGES = int(args[0]) if args else 1081
OUT = args[1] if len(args) > 1 else "big.pdf"
OUTLINE = "--outline" in sys.argv
out = open(OUT, "wb")
offsets = {}
def obj(n, body):
    offsets[n] = out.tell()
    out.write(f"{n} 0 obj\n".encode()); out.write(body); out.write(b"\nendobj\n")
out.write(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
# 1 catalog, 2 pages, 3 font; per page i: page=4+3i, content=5+3i, image=6+3i
kids = " ".join(f"{4+3*i} 0 R" for i in range(PAGES))
OUTLINES = 4 + 3*PAGES  # first object number after the pages
obj(1, (f"<< /Type /Catalog /Pages 2 0 R /Outlines {OUTLINES} 0 R /PageMode /UseOutlines >>" if OUTLINE
        else "<< /Type /Catalog /Pages 2 0 R >>").encode())
obj(2, f"<< /Type /Pages /Count {PAGES} /Kids [{kids}] >>".encode())
obj(3, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
for i in range(PAGES):
    p, c, im = 4+3*i, 5+3*i, 6+3*i
    obj(p, f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 {im} 0 R >> >> /Contents {c} 0 R >>".encode())
    s = f"BT /F1 24 Tf 72 720 Td (Page {i+1}) Tj ET q 468 0 0 477 72 200 cm /Im0 Do Q".encode()
    obj(c, b"<< /Length %d >>\nstream\n" % len(s) + s + b"\nendstream")
    data = zlib.compress(os.urandom(W*H*3), 1)
    obj(im, f"<< /Type /XObject /Subtype /Image /Width {W} /Height {H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream")
n = 4 + 3*PAGES
if OUTLINE:
    # Chapters every 100 pages, sections every 25 pages within each chapter.
    chapters = [(f"Chapter {c+1}", c*100, [(f"{c+1}.{k+1} Section", c*100 + k*25) for k in range(4) if c*100 + k*25 < PAGES])
                for c in range((PAGES + 99) // 100)]
    nums = {}
    nxt = n + 1
    for ci, (_, _, secs) in enumerate(chapters):
        nums[ci] = nxt; nxt += 1
        for si in range(len(secs)):
            nums[(ci, si)] = nxt; nxt += 1
    def item(num, title, page, parent, prev, next_, kids=None):
        d = f"<< /Title ({title}) /Parent {parent} 0 R /Dest [{4+3*page} 0 R /Fit]"
        if prev: d += f" /Prev {prev} 0 R"
        if next_: d += f" /Next {next_} 0 R"
        if kids: d += f" /First {kids[0]} 0 R /Last {kids[-1]} 0 R /Count -{len(kids)}"
        obj(num, (d + " >>").encode())
    tops = [nums[ci] for ci in range(len(chapters))]
    obj(n, f"<< /Type /Outlines /First {tops[0]} 0 R /Last {tops[-1]} 0 R /Count {len(tops)} >>".encode())
    for ci, (title, page, secs) in enumerate(chapters):
        kids = [nums[(ci, si)] for si in range(len(secs))]
        item(nums[ci], title, page, n, tops[ci-1] if ci else None, tops[ci+1] if ci+1 < len(tops) else None, kids)
        for si, (stitle, spage) in enumerate(secs):
            item(kids[si], stitle, spage, nums[ci], kids[si-1] if si else None, kids[si+1] if si+1 < len(kids) else None)
    n = nxt
xref = out.tell()
out.write(f"xref\n0 {n}\n0000000000 65535 f \n".encode())
for k in range(1, n):
    out.write(f"{offsets[k]:010d} 00000 n \n".encode())
out.write(f"trailer\n<< /Size {n} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
out.close()
print(os.path.getsize(OUT)/1e6, "MB")
