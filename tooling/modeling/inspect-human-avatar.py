import bpy, json, sys
from pathlib import Path
source=Path(sys.argv[sys.argv.index('--')+1])
bpy.ops.import_scene.fbx(filepath=str(source),use_anim=False)
report={'objects':[]}
for o in bpy.data.objects:
 row={'name':o.name,'type':o.type,'scale':list(o.scale),'location':list(o.location),'dimensions':list(o.dimensions)}
 if o.type=='MESH':row.update(vertices=len(o.data.vertices),polygons=len(o.data.polygons),materials=[m.name for m in o.data.materials],groups=[g.name for g in o.vertex_groups])
 if o.type=='ARMATURE':row['bones']=[{'name':b.name,'parent':b.parent.name if b.parent else None,'head':list(b.head_local),'tail':list(b.tail_local)} for b in o.data.bones]
 report['objects'].append(row)
print('AVATAR_INSPECTION '+json.dumps(report))
