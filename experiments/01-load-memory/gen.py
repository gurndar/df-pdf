# Generate a ~800MB, 1081-page PDF: text + one unique incompressible RGB image per page.
import os, zlib, sys
PAGES = int(sys.argv[1]) if len(sys.argv) > 1 else 1081
W, H = 490, 500  # ~735KB raw RGB per page
OUT = sys.argv[2] if len(sys.argv) > 2 else "big.pdf"
out = open(OUT, "wb")
offsets = {}
def obj(n, body):
    offsets[n] = out.tell()
    out.write(f"{n} 0 obj\n".encode()); out.write(body); out.write(b"\nendobj\n")
out.write(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
# 1 catalog, 2 pages, 3 font; per page i: page=4+3i, content=5+3i, image=6+3i
kids = " ".join(f"{4+3*i} 0 R" for i in range(PAGES))
obj(1, b"<< /Type /Catalog /Pages 2 0 R >>")
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
xref = out.tell()
out.write(f"xref\n0 {n}\n0000000000 65535 f \n".encode())
for k in range(1, n):
    out.write(f"{offsets[k]:010d} 00000 n \n".encode())
out.write(f"trailer\n<< /Size {n} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
out.close()
print(os.path.getsize(OUT)/1e6, "MB")
