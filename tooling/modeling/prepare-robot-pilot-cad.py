"""Adapt pinned, Apache-2.0 KUKA visual meshes to an existing native rig.

Modified by SmartTwin: coordinate rebasing, axis-offset removal, native-scale
mapping in RobotPrefabs, explicit offline LOD and quantized delivery buffers.
This is a visual derivative, NOT the source robot's kinematic/safety model.
Run in a separate Blender --background --factory-startup --disable-autoexec.
"""
import argparse,base64,json,math,sys,struct,hashlib
import xml.etree.ElementTree as E
from pathlib import Path
import bpy
from mathutils import Matrix,Vector,Euler

p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--output',required=True)
args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=Path(args.source);output=Path(args.output)
manifest=Path(__file__).resolve().parents[2]/'modules/logistica-industrial/functions/robots/assets/reference-pilot/provenance.json'
provenance=json.loads(manifest.read_text(encoding='utf8'))
for filename,row in provenance['files'].items():
    if hashlib.sha256((source/filename).read_bytes()).hexdigest()!=row['sha256']:
        raise ValueError('Source does not match the pinned licensed revision: '+filename)
ns={'c':'http://www.collada.org/2005/11/COLLADASchema'};xacro=E.parse(source/'kr10_r900_2_macro.xacro').getroot()
def transform(element):
    return Matrix.Translation([float(v) for v in element.get('xyz','0 0 0').split()])@Euler([float(v) for v in element.get('rpy','0 0 0').split()],'XYZ').to_matrix().to_4x4()
frames={'base_link':Matrix.Identity(4)}
for i in range(1,7):
    joint=xacro.find(".//joint[@name='${prefix}joint_%d']"%i)
    frames['link_'+str(i)]=frames['base_link' if i==1 else 'link_'+str(i-1)]@transform(joint.find('origin'))
C=Matrix.Diagonal((1,-1,-1,1));upper=C@frames['link_2'].inverted();elbow=C@frames['link_3'].inverted()
groups=[];hashes={}
for name in ['base_link']+['link_'+str(i) for i in range(1,7)]:
    path=source/(name+'.dae');hashes[path.name]=hashlib.sha256(path.read_bytes()).hexdigest();tree=E.parse(path)
    origin=transform(xacro.find(".//link[@name='${prefix}%s']/visual/origin"%name))
    effects={effect.get('id'):[float(v) for v in effect.find('.//c:diffuse/c:color',ns).text.split()[:3]] for effect in tree.findall('.//c:effect',ns)}
    materials={material.get('id'):effects[material.find('c:instance_effect',ns).get('url')[1:]] for material in tree.findall('.//c:material',ns)}
    for geometry in tree.findall('.//c:geometry',ns):
        mesh=geometry.find('c:mesh',ns);arrays={}
        for data in mesh.findall('c:source',ns):
            values=[float(v) for v in data.find('c:float_array',ns).text.split()];access=data.find('.//c:accessor',ns);stride=int(access.get('stride','1'))
            arrays[data.get('id')]=[values[i:i+stride] for i in range(0,len(values),stride)]
        vertices={v.get('id'):v.find('c:input',ns).get('source')[1:] for v in mesh.findall('c:vertices',ns)}
        for triangles in mesh.findall('c:triangles',ns):
            inputs={v.get('semantic'):(int(v.get('offset')),v.get('source')[1:]) for v in triangles.findall('c:input',ns)};stride=max(v[0] for v in inputs.values())+1
            index=[int(v) for v in triangles.find('c:p',ns).text.split()];points=[];normals=[]
            global_matrix=frames[name]@origin
            # CAD links are re-expressed at the native bearing centres. J4's
            # long forearm rotates around the same X axis even though its
            # mathematical origin is at the native wrist centre.
            target=upper if name in ['base_link','link_1','link_2'] else elbow
            matrix=target@global_matrix;normal_matrix=matrix.to_3x3().inverted().transposed()
            for i in range(0,len(index),stride):
                offset,key=inputs['VERTEX'];v=matrix@(Vector(arrays[vertices[key]][index[i+offset]])*.001)
                if name=='link_1':
                    f=max(0,min(1,-v.y/.192));v.x+=.025*f;v.z-=.0907*f
                elif name=='link_2':v.z-=.0042*v.x/.455
                elif name=='link_3':
                    f=max(0,min(1,v.x/.196));v.y-=.025*f;v.z-=.0865*f
                elif name=='link_4':
                    v.y-=.025;v.z-=.0865
                    v.z+=.0505*max(0,min(1,(v.x-.35)/.07))
                elif name=='link_5':
                    v.y-=.025;v.z-=.036+.0505*max(0,min(1,(v.x-.42)/.0615));v.x-=.42
                elif name=='link_6':v.x-=.4815;v.y-=.025;v.z-=.0865
                points.append(tuple(v));offset,key=inputs.get('NORMAL',(None,None));n=normal_matrix@Vector(arrays[key][index[i+offset]]) if key else Vector((0,0,1));normals.append(tuple(n.normalized()))
            color=materials[triangles.get('material')]
            # Small red source markings are branding, not machine structure.
            # Do not redistribute an OEM logo on the generic adapted machine.
            if color[0]>color[1]*1.5:
                # Replace recessed/raised source lettering with a neutral
                # fitted service cover, so the negative logo cavity also
                # disappears. No OEM word/image geometry is delivered.
                for axis in range(3):
                    for sign in [-1,1]:
                        selected=[]
                        for point,n in zip(points,normals):
                            if abs(n[axis])!=max(abs(v) for v in n) or n[axis]*sign<=.75:continue
                            raw=Vector(point)
                            if name=='link_2':raw.z+=.0042*raw.x/.455
                            if name=='link_4':raw.y+=.025;raw.z+=.0865-.0505*max(0,min(1,(raw.x-.35)/.07))
                            selected.append((raw,Vector(n)))
                        if len(selected)<3:continue
                        normal=sum((n for p,n in selected),Vector()).normalized();other=[a for a in range(3) if a!=axis]
                        lo=[min(p[a] for p,n in selected)-.006 for a in other];hi=[max(p[a] for p,n in selected)+.006 for a in other]
                        if min(hi[i]-lo[i] for i in range(2))<.001:continue
                        plane=sum(normal.dot(p) for p,n in selected)/len(selected)
                        # Preserve the exact piecewise axis-offset adaptation:
                        # a flat cover must bend with its host skin, not cut it.
                        cuts=[lo[0],hi[0]]
                        if name=='link_4' and other[0]==0:cuts=sorted(set(cuts+[v for v in [.35,.42] if lo[0]<v<hi[0]]))
                        for left,right in zip(cuts,cuts[1:]):
                            corners=[]
                            for a,b in [(left,lo[1]),(right,lo[1]),(right,hi[1]),(left,hi[1])]:
                                point=Vector();point[other[0]]=a;point[other[1]]=b;point[axis]=(plane-normal[other[0]]*a-normal[other[1]]*b)/normal[axis];point+=normal*.0012
                                if name=='link_2':point.z-=.0042*point.x/.455
                                if name=='link_4':point.y-=.025;point.z-=.0865-.0505*max(0,min(1,(point.x-.35)/.07))
                                corners.append(point)
                            adapted=(corners[1]-corners[0]).cross(corners[2]-corners[0]).normalized();order=[0,1,2,0,2,3]
                            if adapted.dot(normal)<0:order=[0,2,1,0,3,2];adapted.negate()
                            groups.append({'link':name,'role':'frame','points':[tuple(corners[i]) for i in order],'normals':[tuple(adapted)]*6,'name':name+' / neutral fitted service cover'})
                continue
            role=('metal' if name=='link_6' else 'frame') if name!='base_link' else 'accent' if max(color)<.22 else 'metal'
            groups.append({'link':name,'role':role,'points':points,'normals':normals,'name':name+' / '+geometry.get('name','casting')})

def packed(values,kind):return base64.b64encode(struct.pack('<'+kind*len(values),*values)).decode('ascii')
result={'version':1,'source':'https://github.com/kuka-ros/kuka_robot_descriptions','revision':'5ddbc41ce8726fd680bcc19562d78bcabfbdf96d','license':'Apache-2.0',
        'copyright':'Copyright 2025 KUKA Hungaria Kft.','modifiedBy':'SmartTwin native visual pilot',
        'modifications':'Visual derivative: native joint rebasing and axis-offset adaptation, neutral service covers in place of branding, manufactured crease/weighted normals, offline LOD and quantized indexed buffers. Native motion and tooling are not the OEM controller.',
        'sourceHashes':hashes,'lods':{}}
for lod,ratio in [('low',.32),('balanced',.64),('high',.90)]:
    records=[]
    for group in groups:
        # Weld position first, then classify real manufacturing creases.
        # Tessellation facets on a cast radius are not sharp mechanical edges.
        vertices=[];normals=[];faces=[];seen={}
        for at,(point,normal) in enumerate(zip(group['points'],group['normals'])):
            key=tuple(round(n,7) for n in point)
            if key not in seen:seen[key]=len(vertices);vertices.append(point);normals.append(normal)
            if at%3==0:faces.append([])
            faces[-1].append(seen[key])
        mesh=bpy.data.meshes.new(group['name']);mesh.from_pydata(vertices,[],faces);mesh.validate(clean_customdata=True);mesh.update()
        for poly in mesh.polygons:poly.use_smooth=True
        obj=bpy.data.objects.new(group['name'],mesh);bpy.context.collection.objects.link(obj);bpy.context.view_layer.objects.active=obj;obj.select_set(True)
        if len(mesh.polygons)>3:
            modifier=obj.modifiers.new('Offline bounded silhouette LOD','DECIMATE');modifier.ratio=ratio;modifier.use_collapse_triangulate=True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        mesh=obj.data
        mesh=obj.data;mesh.calc_loop_triangles()
        points=[];normals=[];index=[];seen={}
        for triangle in mesh.loop_triangles:
            if triangle.area<1e-12:continue
            for loop_index in triangle.loops:
                loop=mesh.loops[loop_index];point=mesh.vertices[loop.vertex_index].co;normal=mesh.corner_normals[loop_index].vector
                if normal.length<.5:normal=triangle.normal
                normal=normal.normalized()
                key=tuple(round(n,7) for n in tuple(point)+tuple(normal))
                if key not in seen:seen[key]=len(points);points.append(tuple(point));normals.append(tuple(normal))
                index.append(seen[key])
        low=[min(p[i] for p in points) for i in range(3)];high=[max(p[i] for p in points) for i in range(3)];center=[(a+b)/2 for a,b in zip(low,high)];scale=[max(1e-9,(b-a)/65534) for a,b in zip(low,high)]
        q=[max(-32767,min(32767,round((p[i]-center[i])/scale[i]))) for p in points for i in range(3)];n=[max(-127,min(127,round(v*127))) for normal in normals for v in normal]
        kind='H' if len(points)<65536 else 'I'
        records.append({'name':group['name'],'link':group['link'],'role':group['role'],'center':center,'scale':scale,'position':packed(q,'h'),'normal':packed(n,'b'),'index':packed(index,kind),'indexType':kind,'vertices':len(points),'triangles':len(index)//3})
        bpy.data.objects.remove(obj,do_unlink=True)
    result['lods'][lod]=records
sys.path.insert(0,str(Path(__file__).resolve().parent))
from pilot_normals import refine
result=refine(result)
output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,separators=(',',':')),encoding='utf8')
print(json.dumps({'output':str(output),'bytes':output.stat().st_size,'triangles':{lod:sum(row['triangles'] for row in rows) for lod,rows in result['lods'].items()}}))
