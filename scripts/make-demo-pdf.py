# Small textbook-like PDF (original text) with bookmarks and a vector figure,
# used for the README screenshots.   python3 scripts/make-demo-pdf.py demo.pdf
import sys, textwrap

OUT = sys.argv[1] if len(sys.argv) > 1 else "demo.pdf"
chapters = [
    ("1  Motion in One Dimension", ["1.1 Position and Displacement", "1.2 Velocity", "1.3 Acceleration"]),
    ("2  Vectors and Projectiles", ["2.1 Adding Vectors", "2.2 Projectile Motion"]),
    ("3  Newton's Laws", ["3.1 Force and Mass", "3.2 The Second Law", "3.3 Action and Reaction"]),
    ("4  Energy", ["4.1 Work", "4.2 Kinetic Energy", "4.3 Conservation of Energy"]),
]
para = ("An object moving along a straight line can be described by its position x at each instant of time. "
        "The change in position, x2 - x1, is called the displacement. Average velocity is the displacement divided by "
        "the elapsed time, and the instantaneous velocity is the limit of that ratio as the time interval shrinks to zero. "
        "In the language of calculus, velocity is the derivative of position with respect to time, v = dx/dt, and "
        "acceleration is the derivative of velocity, a = dv/dt. These two ideas let us predict where an object will be.")

def esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

pages = []  # (content stream, chapter index, section index)
for ci, (ctitle, secs) in enumerate(chapters):
    for si, stitle in enumerate(secs):
        ops, y = [], 740
        if si == 0:
            ops.append(f"0.15 0.39 0.92 rg BT /F2 22 Tf 60 {y} Td ({esc(ctitle)}) Tj ET 0 g"); y -= 40
        ops.append(f"BT /F2 15 Tf 60 {y} Td ({esc(stitle)}) Tj ET"); y -= 26
        for _ in range(3):
            for line in textwrap.wrap(para, 92):
                ops.append(f"BT /F1 11 Tf 60 {y} Td ({esc(line)}) Tj ET"); y -= 15
            y -= 10
        fy = y - 200  # figure: axes and a parabola
        ops.append(f"0.6 G 1 w 80 {fy} m 80 {fy+170} l S 80 {fy} m 520 {fy} l S")
        curve = " ".join(f"{80 + x * 4.4:.1f} {fy + 160 * (x / 100) ** 2:.1f} l" for x in range(1, 101))
        ops.append(f"0.15 0.39 0.92 RG 2 w 80 {fy} m {curve} S 0 G")
        ops.append(f"BT /F3 10 Tf 470 {fy-14} Td (time t) Tj ET BT /F3 10 Tf 86 {fy+160} Td (position x) Tj ET")
        ops.append(f"BT /F3 10 Tf 60 {fy-36} Td (Figure {ci+1}-{si+1}. Position of an object with constant acceleration.) Tj ET")
        ops.append(f"0.5 g BT /F1 9 Tf 300 40 Td ({len(pages) + 1}) Tj ET")
        pages.append(("\n".join(ops), ci, si))

P = len(pages)
page_obj = lambda i: 6 + 2 * i
OUTLINES = 6 + 2 * P
out = open(OUT, "wb")
offsets = {}
def obj(n, body):
    offsets[n] = out.tell()
    out.write(f"{n} 0 obj\n".encode() + body + b"\nendobj\n")

out.write(b"%PDF-1.7\n")
obj(1, f"<< /Type /Catalog /Pages 2 0 R /Outlines {OUTLINES} 0 R >>".encode())
obj(2, f"<< /Type /Pages /Count {P} /Kids [{' '.join(f'{page_obj(i)} 0 R' for i in range(P))}] >>".encode())
obj(3, b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>")
obj(4, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
obj(5, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>")
for i, (content, _, _) in enumerate(pages):
    data = content.encode()
    obj(page_obj(i), f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents {page_obj(i)+1} 0 R >>".encode())
    obj(page_obj(i) + 1, b"<< /Length %d >>\nstream\n" % len(data) + data + b"\nendstream")

first_page = {(ci, si): i for i, (_, ci, si) in enumerate(pages)}
nums, nxt = {}, OUTLINES + 1
for ci, (_, secs) in enumerate(chapters):
    nums[ci] = nxt; nxt += 1
    for si in range(len(secs)):
        nums[(ci, si)] = nxt; nxt += 1
tops = [nums[ci] for ci in range(len(chapters))]
obj(OUTLINES, f"<< /Type /Outlines /First {tops[0]} 0 R /Last {tops[-1]} 0 R /Count {len(tops)} >>".encode())
for ci, (ctitle, secs) in enumerate(chapters):
    kids = [nums[(ci, si)] for si in range(len(secs))]
    d = (f"<< /Title ({esc(ctitle)}) /Parent {OUTLINES} 0 R /Dest [{page_obj(first_page[(ci, 0)])} 0 R /Fit]"
         f" /First {kids[0]} 0 R /Last {kids[-1]} 0 R /Count {len(kids)}")
    if ci: d += f" /Prev {tops[ci-1]} 0 R"
    if ci + 1 < len(tops): d += f" /Next {tops[ci+1]} 0 R"
    obj(nums[ci], (d + " >>").encode())
    for si, stitle in enumerate(secs):
        d = f"<< /Title ({esc(stitle)}) /Parent {nums[ci]} 0 R /Dest [{page_obj(first_page[(ci, si)])} 0 R /Fit]"
        if si: d += f" /Prev {kids[si-1]} 0 R"
        if si + 1 < len(kids): d += f" /Next {kids[si+1]} 0 R"
        obj(kids[si], (d + " >>").encode())

n = nxt
xref = out.tell()
out.write(f"xref\n0 {n}\n0000000000 65535 f \n".encode())
out.write(b"".join(f"{offsets[k]:010d} 00000 n \n".encode() for k in range(1, n)))
out.write(f"trailer\n<< /Size {n} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
out.close()
print(f"{OUT}: {P} pages")
