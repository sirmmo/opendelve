# Minimal GLB reader: node transforms applied, returns world-space triangles. Used by ports.py.
import json, struct, sys, os, math
def read(path):
    d=open(path,'rb').read()
    assert d[:4]==b'glTF'
    off=12; js=None; binc=b''
    while off<len(d):
        n,t=struct.unpack('<I4s',d[off:off+8]); c=d[off+8:off+8+n]; off+=8+n
        if t==b'JSON': js=json.loads(c)
        elif t[:3]==b'BIN': binc=c
    return js,binc
def mat4(n):
    import itertools
    if 'matrix' in n: m=n['matrix']; return [[m[c*4+r] for c in range(4)] for r in range(4)]
    t=n.get('translation',[0,0,0]); q=n.get('rotation',[0,0,0,1]); s=n.get('scale',[1,1,1])
    x,y,z,w=q
    R=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
    return [[R[r][0]*s[0],R[r][1]*s[1],R[r][2]*s[2],t[r]] for r in range(3)]+[[0,0,0,1]]
def mul(a,b): return [[sum(a[r][k]*b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]
def verts(path):
    g,b=read(path); out=[]
    def acc(i):
        a=g['accessors'][i]; bv=g['bufferViews'][a['bufferView']]; o=bv.get('byteOffset',0)+a.get('byteOffset',0)
        n={'VEC3':3,'VEC2':2,'SCALAR':1}[a['type']]; f={5126:'f',5123:'H',5125:'I',5121:'B'}[a['componentType']]
        sz=struct.calcsize(f); st=bv.get('byteStride',sz*n)
        return [struct.unpack_from('<'+f*n,b,o+k*st) for k in range(a['count'])]
    def walk(ni,M):
        n=g['nodes'][ni]; M=mul(M,mat4(n))
        if 'mesh' in n:
            for p in g['meshes'][n['mesh']]['primitives']:
                P=acc(p['attributes']['POSITION']); I=[x[0] for x in acc(p['indices'])] if 'indices' in p else list(range(len(P)))
                W=[tuple(sum(M[r][k]*v[k] for k in range(3))+M[r][3] for r in range(3)) for v in P]
                for t in range(0,len(I),3): out.append((W[I[t]],W[I[t+1]],W[I[t+2]]))
        for c in n.get('children',[]): walk(c,M)
    I4=[[1 if r==c else 0 for c in range(4)] for r in range(4)]
    for ni in g['scenes'][g.get('scene',0)]['nodes']: walk(ni,I4)
    return g,out
if __name__=='__main__':
    for p in sys.argv[1:]:
        g,tris=verts(p); xs=[v[0] for t in tris for v in t]; ys=[v[1] for t in tris for v in t]; zs=[v[2] for t in tris for v in t]
        imgs=[i.get('uri','embedded') for i in g.get('images',[])]
        print(os.path.basename(p)[:-4].ljust(28),'x %.2f..%.2f y %.2f..%.2f z %.2f..%.2f'%(min(xs),max(xs),min(ys),max(ys),min(zs),max(zs)), imgs)
