"""Offline normal refinement; encoded positions and ordered triangles stay exact."""
import base64,struct,math,hashlib,json

def unpack(value,kind):
    raw=base64.b64decode(value);size=struct.calcsize(kind)
    return struct.unpack('<'+kind*(len(raw)//size),raw)
def pack(values,kind):return base64.b64encode(struct.pack('<'+kind*len(values),*values)).decode('ascii')
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def sub(a,b):return tuple(x-y for x,y in zip(a,b))
def cross(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def unit(v):
    length=math.sqrt(dot(v,v));return tuple(x/length for x in v) if length>1e-20 else (0,0,0)
def refine(data,crease_degrees=35):
    threshold=math.cos(math.radians(crease_degrees));audit={}
    for lod,rows in data['lods'].items():
        before=hashlib.sha256();after=hashlib.sha256();triangles=0
        for row in rows:
            q=unpack(row['position'],'h');old=unpack(row['normal'],'b');index=unpack(row['index'],row['indexType'])
            quantized=[q[i:i+3] for i in range(0,len(q),3)]
            points=[tuple(row['center'][a]+v[a]*row['scale'][a] for a in range(3)) for v in quantized]
            entries={};corners=[]
            for start in range(0,len(index),3):
                at=index[start:start+3];vs=[points[i] for i in at];normal=unit(cross(sub(vs[1],vs[0]),sub(vs[2],vs[0])))
                for corner,vertex in enumerate(at):
                    u=unit(sub(vs[(corner+1)%3],vs[corner]));v=unit(sub(vs[(corner+2)%3],vs[corner]));weight=math.acos(max(-1,min(1,dot(u,v))))
                    face=normal if dot(normal,normal)>.5 else unit(old[vertex*3:vertex*3+3]);key=quantized[vertex]
                    entry=(face,weight);entries.setdefault(key,[]).append(entry);corners.append((vertex,key,face))
                    before.update(struct.pack('<hhh',*key))
            positions=[];normals=[];reindex=[];unique={}
            for vertex,key,face in corners:
                summed=[0.,0.,0.]
                for other,weight in entries[key]:
                    if dot(face,other)>=threshold:
                        for axis in range(3):summed[axis]+=other[axis]*weight
                normal=unit(summed)
                if dot(normal,normal)<.5:normal=face
                # Keep source topological identities. Coincident coordinates
                # can belong to distinct CAD pieces, or to a sub-pixel face
                # after quantization; welding those IDs can collapse a face.
                # Only split an existing vertex when its crease normal differs.
                encoded=tuple(max(-127,min(127,round(v*127))) for v in normal);identity=(vertex,)+encoded
                if identity not in unique:
                    unique[identity]=len(unique);positions.extend(key);normals.extend(encoded)
                reindex.append(unique[identity]);after.update(struct.pack('<hhh',*key))
            row.update(position=pack(positions,'h'),normal=pack(normals,'b'),index=pack(reindex,'H' if len(unique)<65536 else 'I'),indexType='H' if len(unique)<65536 else 'I',vertices=len(unique))
            triangles+=len(index)//3
        assert before.digest()==after.digest(),'Normal refinement changed triangle coordinates.'
        audit[lod]={'triangles':triangles,'orderedQuantizedTriangleSHA256':before.hexdigest(),'positionsAndTriangleOrderUnchanged':True}
    data['normalModel']={'method':'corner-angle-weighted','creaseDegrees':crease_degrees,'geometryAudit':audit}
    data['modifications']=data.get('modifications','')+' Offline corner-angle-weighted normals replace face-area averaging; quantized positions and ordered triangles are unchanged.'
    return data

if __name__=='__main__':
    import sys
    from pathlib import Path
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    source=Path(args[0]);output=Path(args[1]);assert source.resolve()!=output.resolve(),'Use a new audit output.'
    result=refine(json.loads(source.read_text(encoding='utf8')))
    output.write_text(json.dumps(result,separators=(',',':')),encoding='utf8');print(json.dumps(result['normalModel']))
