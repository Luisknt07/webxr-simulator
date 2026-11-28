"""Offline Rocketbox FBX -> local skinned glTF. Run in a factory Blender process.
Preserves UVs, skin weights and the original 80-bone rig; no live scene changes.
"""
import bpy, bmesh, json, math, hashlib, sys
from pathlib import Path
from mathutils import Matrix, Vector

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'data/avatar-research/source'
OUT=ROOT/'packages/tools/collaboration/assets/humans'
MODELS={'human-f07':'Female_Adult_07','human-m04':'Male_Adult_04','human-f04':'Female_Adult_04','human-m06':'Male_Adult_06'}
OUT.mkdir(parents=True,exist_ok=True)

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def part_for(name):
    if any(x in name for x in ['Thigh','Calf','Foot','Toe']):return 'legs'
    for side,letter in [('left',' L '),('right',' R ')]:
        if letter in name and ('Hand' in name or 'Finger' in name):return side+'Hand'
        if letter in name and any(x in name for x in ['UpperArm','Forearm']):return side+'Arm'
    if any(x in name for x in ['Head','Neck','Eye','MJaw','Lip','Tongue','Mouth','Masseter','Caninus','Cheek','Eyebrow','Nose']):return 'head'
    return 'torso'

receipts=[]
for asset_id,name in MODELS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source=SOURCE/'Assets/Avatars/Adults'/name
    bpy.ops.import_scene.fbx(filepath=str(source/'Export'/(name+'.fbx')),use_anim=False)
    arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
    mesh=next(o for o in bpy.data.objects if o.type=='MESH' and 'hipoly' in o.name)
    # Inspect the imported rest frame before transforming it.
    world=lambda n:arm.matrix_world@arm.data.bones[n].head_local
    forward=world('Bip01 MNose')-world('Bip01 Head');forward.z=0;forward.normalize()
    yaw=math.atan2(forward.x,forward.y)
    frame=bpy.data.objects.new('HumanFrame',None);bpy.context.collection.objects.link(frame)
    arm_world=arm.matrix_world.copy();arm.parent=frame;arm.matrix_world=arm_world
    frame.rotation_euler.z=yaw
    bpy.context.view_layer.update()
    min_z=min((mesh.matrix_world@v.co).z for v in mesh.data.vertices)
    eye=(world('Bip01 LEye')+world('Bip01 REye'))*.5
    # GLB has origin at the headset/eyes and faces -Z, metres, Y up.
    frame.location-=Vector((eye.x,eye.y,eye.z))
    bpy.context.view_layer.update()
    eye_height=eye.z-min_z
    # Rebuild PBR materials. The FBX uses Max diffuse conventions that otherwise
    # multiply the face by dark legacy diffuse colours and lose hair cutouts.
    for material in mesh.data.materials:
        kind='head' if 'head' in material.name else 'opacity' if 'opacity' in material.name else 'body'
        texture=next((source/'Textures').glob('*_'+kind+'_color.tga'))
        image=bpy.data.images.load(str(texture),check_existing=True)
        image.scale(1024 if kind=='head' else 512,1024 if kind=='head' else 512)
        image.file_format='PNG';image.filepath_raw=str(OUT/(asset_id+'-'+kind+'.png'));image.save();image.pack()
        material.use_nodes=True;nodes=material.node_tree.nodes;nodes.clear()
        output=nodes.new('ShaderNodeOutputMaterial');shader=nodes.new('ShaderNodeBsdfPrincipled');tex=nodes.new('ShaderNodeTexImage');tex.image=image
        material.node_tree.links.new(tex.outputs['Color'],shader.inputs['Base Color']);material.node_tree.links.new(shader.outputs['BSDF'],output.inputs['Surface'])
        shader.inputs['Roughness'].default_value=.82
        shader.inputs['Specular IOR Level'].default_value=.22
        if kind=='opacity':
            material.node_tree.links.new(tex.outputs['Alpha'],shader.inputs['Alpha'])
            material.surface_render_method='DITHERED'
            # Explicit glTF MASK avoids transparent hair sorting over the face.
            material['gltf_alpha_mode']='MASK';material.alpha_threshold=.45
    # Split visibility regions without changing vertex positions, UVs or weights.
    # The bust / tracked-only modes never need to render invented legs.
    polygon_parts=[]
    for face in mesh.data.polygons:
        weights={}
        for index in face.vertices:
            for group in mesh.data.vertices[index].groups:
                part=part_for(mesh.vertex_groups[group.group].name)
                weights[part]=weights.get(part,0)+group.weight
        polygon_parts.append(max(weights,key=weights.get) if weights else 'torso')
    created=[]
    for part in sorted(set(polygon_parts)):
        obj=mesh.copy();obj.data=mesh.data.copy();obj.name=part;bpy.context.collection.objects.link(obj)
        bm=bmesh.new();bm.from_mesh(obj.data);bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if polygon_parts[f.index]!=part],context='FACES')
        bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
        bm.to_mesh(obj.data);bm.free();obj['avatarPart']=part;created.append(obj)
    bpy.data.objects.remove(mesh,do_unlink=True)
    # Remove unrelated imported empties and export only our reviewed hierarchy.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [frame,arm]+created:obj.select_set(True)
    bpy.context.view_layer.objects.active=arm
    file=OUT/(asset_id+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_all_influences=False,export_def_bones=False,export_extras=True,export_image_format='AUTO',export_yup=True)
    # PNGs are embedded. Do not ship duplicate standalone textures.
    for p in OUT.glob(asset_id+'-*.png'):p.unlink()
    triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in created)
    row={'id':asset_id,'source':name,'file':file.name,'sha256':digest(file),'bytes':file.stat().st_size,'triangles':triangles,'bones':len(arm.data.bones),'eyeHeight':round(eye_height,5),'textures':{'head':1024,'body':512,'opacity':512},'parts':sorted(set(polygon_parts))}
    if row['bytes']>4*1024*1024 or triangles>12000:raise RuntimeError('Avatar exceeds reviewed budget: '+str(row))
    receipts.append(row);print('BUILT_AVATAR '+json.dumps(row),flush=True)

(OUT/'LICENSE.md').write_bytes((SOURCE/'LICENSE.md').read_bytes())
sources=json.loads((SOURCE/'sources.json').read_text())
(OUT/'provenance.json').write_text(json.dumps({'repository':sources['repository'],'commit':sources['commit'],'license':'MIT','conversion':'tooling/modeling/build-human-avatars.py','sourceFiles':sources['files'],'avatars':receipts},indent=2)+'\n',encoding='utf8')
