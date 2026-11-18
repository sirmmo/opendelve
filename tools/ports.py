# Measures each Kenney modular piece: footprint in 4-unit cells, and which cell sides along the
# edge are open (o), walled (W) or empty (. , e.g. outside a room's rounded corner).
#
#   python3 tools/ports.py "<kit>/Models/GLB format/"*.glb
#
# js/pieces.js holds the result.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb import verts
CELL=4.0
def height_at(tris, x, z):
    best=None
    for a,b,c in tris:
        det=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
        if abs(det)<1e-9: continue
        l1=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/det
        l2=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/det
        l3=1-l1-l2
        if min(l1,l2,l3)<-1e-6: continue
        y=l1*a[1]+l2*b[1]+l3*c[1]
        if best is None or y>best: best=y
    return best
def ports(path):
    g,tris=verts(path)
    xs=[v[0] for t in tris for v in t]; zs=[v[2] for t in tris for v in t]
    x0,x1,z0,z1=round(min(xs)/2)*2,round(max(xs)/2)*2,round(min(zs)/2)*2,round(max(zs)/2)*2
    w=int(round((x1-x0)/CELL)); h=int(round((z1-z0)/CELL))
    # sides: +x (east), +z (south), -x (west), -z (north); cells listed in increasing coordinate
    def probe(x,z):
        y=height_at(tris,x,z)
        return 'W' if y is not None and y>2 else ('o' if y is not None else '.')
    inset=0.35
    E=''.join(probe(x1-inset, z0+CELL*(i+.5)) for i in range(h))
    W=''.join(probe(x0+inset, z0+CELL*(i+.5)) for i in range(h))
    S=''.join(probe(x0+CELL*(i+.5), z1-inset) for i in range(w))
    N=''.join(probe(x0+CELL*(i+.5), z0+inset) for i in range(w))
    return (x0,z0,w,h),E,S,W,N
for p in sys.argv[1:]:
    (x0,z0,w,h),E,S,W,N=ports(p)
    print(os.path.basename(p)[:-4].ljust(28), f'{w}x{h} origin({x0},{z0})', 'E',E,'S',S,'W',W,'N',N)
