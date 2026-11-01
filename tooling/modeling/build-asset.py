"""Offline Blender pipeline for an exported EXISTING SmartTwin equipment model.
Runs in a separate factory-startup process; never opens a user's Blender file.
"""
import argparse
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Matrix


def import_packet(source):
    data = json.loads(source.read_text(encoding='utf-8-sig'))
    if data.get('format') != 'smarttwin.native-equipment' or data.get('version') != 1 or data.get('units') != 'm':
        raise ValueError('Only a version 1 native equipment packet is supported.')
    if len(data.get('nodes', [])) > 4000 or len(data.get('geometries', [])) > 2000:
        raise ValueError('Equipment packet exceeds the bounded component budget.')
    materials = {}
    for row in data['materials']:
        material = bpy.data.materials.new(row['name'])
        material.use_nodes = True
        shader = material.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = tuple(row['color']) + (row.get('opacity', 1),)
        shader.inputs['Metallic'].default_value = row['metalness']
        shader.inputs['Roughness'].default_value = row['roughness']
        materials[row['id']] = material
    geometries = {row['id']: row for row in data['geometries']}
    objects = {}
    # The packet is Y-up, while Blender is Z-up. A parent conversion preserves
    # every native local joint matrix; glTF Y-up export cancels this conversion.
    root = bpy.data.objects.new(data.get('name', 'SmartTwin equipment'), None)
    bpy.context.collection.objects.link(root)
    root.rotation_euler.x = math.pi / 2
    for row in data['nodes']:
        geometry = geometries.get(row.get('geometry'))
        mesh = None
        if geometry:
            positions = geometry['attributes']['position']['array']
            if len(positions) > 1800000 or len(positions) % 3 or any(not math.isfinite(x) for x in positions):
                raise ValueError('Invalid vertex buffer.')
            vertices = [positions[i:i+3] for i in range(0, len(positions), 3)]
            index = geometry.get('index') or list(range(len(vertices)))
            start = geometry.get('drawRange', {}).get('start', 0)
            count = geometry.get('drawRange', {}).get('count')
            if count is not None:
                index = index[start:start+count]
            if len(index) % 3 or any(not isinstance(i, int) or i < 0 or i >= len(vertices) for i in index):
                raise ValueError('Invalid triangle indices.')
            mesh = bpy.data.meshes.new(row['name'])
            mesh.from_pydata(vertices, [], [index[i:i+3] for i in range(0, len(index), 3)])
            mesh.update()
            uv = geometry['attributes'].get('uv', {}).get('array')
            if uv:
                layer = mesh.uv_layers.new(name='UVMap')
                for loop in mesh.loops:
                    layer.data[loop.index].uv = uv[loop.vertex_index*2:loop.vertex_index*2+2]
            for identity in row.get('materials', []):
                mesh.materials.append(materials[identity])
            for group in geometry.get('groups', []):
                for poly in mesh.polygons:
                    if group['start'] <= poly.index*3 < group['start'] + group['count']:
                        poly.material_index = group.get('materialIndex', 0)
            normals = geometry['attributes'].get('normal', {}).get('array')
            if normals and len(normals) == len(positions):
                mesh.normals_split_custom_set_from_vertices([normals[i:i+3] for i in range(0, len(normals), 3)])
                for poly in mesh.polygons:
                    poly.use_smooth = True
        obj = bpy.data.objects.new(row['name'], mesh)
        bpy.context.collection.objects.link(obj)
        for key, value in [('equipmentComponentId', row.get('componentId')), ('industrialMaterialRole', row.get('role')),
                           ('robotJointId', row.get('robotJointId') or row.get('jointId'))]:
            if value:
                obj[key] = value
        objects[row['id']] = obj
    for row in data['nodes']:
        obj = objects[row['id']]
        obj.parent = objects.get(row['parent'], root)
        matrix = row['matrix']
        if len(matrix) != 16 or any(not math.isfinite(x) for x in matrix):
            raise ValueError('Invalid local joint matrix.')
        obj.matrix_local = Matrix([[matrix[column*4+line] for column in range(4)] for line in range(4)])
    bpy.context.view_layer.update()


def consolidate_siblings():
    """Bake only rigid siblings into render batches, retaining named part pivots.

    glTF 2.0 core cannot preserve Three r112 GPU instances. Without this step
    one instanced tread becomes dozens of draws. Never merge across parents
    (wheel, lever, joint, mast stage) or across semantic component identities.
    """
    groups = {}
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH':
            continue
        key = (obj.parent, str(obj.get('equipmentComponentId', obj.get('componentId', ''))),
               str(obj.get('robotJointId', obj.get('robotJoint', ''))),
               tuple(slot.material.name if slot.material else '' for slot in obj.material_slots))
        groups.setdefault(key, []).append(obj)
    batches = 0
    for (parent, component, _joint, _), originals in groups.items():
        if len(originals) < 2:
            continue
        copies = []
        for original in originals:
            duplicate = original.copy()
            duplicate.data = original.data.copy()
            bpy.context.collection.objects.link(duplicate)
            duplicate.parent = parent
            duplicate.matrix_local = original.matrix_local.copy()
            copies.append(duplicate)
        bpy.ops.object.select_all(action='DESELECT')
        for duplicate in copies:
            duplicate.select_set(True)
        bpy.context.view_layer.objects.active = copies[0]
        bpy.ops.object.join()
        render = bpy.context.view_layer.objects.active
        render.name = 'Render batch - ' + (component or (parent.name if parent else 'body'))
        for original in originals:
            old_name, matrix = original.name, original.matrix_local.copy()
            pivot = bpy.data.objects.new(old_name + ' - pivot', None)
            bpy.context.collection.objects.link(pivot)
            pivot.parent = parent
            pivot.matrix_local = matrix
            for key, value in original.items():
                pivot[key] = value
            for child in list(original.children):
                local = child.matrix_local.copy()
                child.parent = pivot
                child.matrix_local = local
            bpy.data.objects.remove(original, do_unlink=True)
            pivot.name = old_name
        batches += 1
    bpy.context.view_layer.update()
    return batches


def compact_material_slots():
    # Native batches retain semantic triangle ranges, sometimes represented by
    # repeated material slots. glTF would turn those aliases into extra draws.
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        unique, remap = [], {}
        for index, material in enumerate(obj.data.materials):
            if material not in unique:
                unique.append(material)
            remap[index] = unique.index(material)
        assignments = [remap.get(poly.material_index, 0) for poly in obj.data.polygons]
        obj.data.materials.clear()
        for material in unique:
            obj.data.materials.append(material)
        for poly, index in zip(obj.data.polygons, assignments):
            poly.material_index = index


def resize_images(texture_edge):
    for image in bpy.data.images:
        if image.source != 'FILE':
            continue
        # glTF imports packed textures lazily. Reading has_data first skips
        # every unloaded image; size requests the bounded input pixels.
        width, height = image.size[:]
        if not width or not height or not image.has_data:
            continue
        scale = min(1, texture_edge / max(width, height))
        if scale < 1:
            image.scale(max(1, round(width * scale)), max(1, round(height * scale)))
            # Repack scaled pixels instead of retaining the original embedded
            # PNG/JPEG bytes when the exporter copies/reset its dirty image.
            image.pack()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--texture-edge', type=int, choices=[512, 1024], default=512)
    parser.add_argument('--lod-ratio', type=float, default=1.0)
    parser.add_argument('--save-blend', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    source, target = Path(args.input).resolve(), Path(args.output).resolve()
    if source == target or source.suffix.lower() not in ('.glb', '.json') or target.suffix.lower() != '.glb':
        raise ValueError('Use a GLB/native JSON input and a distinct GLB output.')
    if not .25 <= args.lod_ratio <= 1:
        raise ValueError('LOD ratio must be between 0.25 and 1.')
    # Inspect before mutation, even though this process owns an isolated scene.
    print('INITIAL_SCENE', json.dumps({'file': bpy.data.filepath, 'objects': [o.name for o in bpy.data.objects]}))
    if bpy.data.filepath:
        raise RuntimeError('Only an unsaved factory-startup scene may be changed.')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    if source.suffix.lower() == '.json':
        import_packet(source)
    else:
        bpy.ops.import_scene.gltf(filepath=str(source))
    before = {o.name: {'parent': o.parent.name if o.parent else None,
                      'matrix': [v for row in o.matrix_local for v in row]}
              for o in bpy.data.objects}
    protected = ('fork', 'horquilla', 'joint', 'articul', 'hinge', 'bearing', 'rodamiento', 'tool', 'pinza', 'pocket', 'shoulder', 'elbow', 'wrist', 'mast', 'hydraulic')
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for obj in meshes:
        if any(not math.isfinite(x) for vertex in obj.data.vertices for x in vertex.co):
            raise ValueError('Nonfinite vertex in ' + obj.name)
        # Imported normals/UV seams are authoritative. Recomputing every normal
        # destroys hard edges and custom analytic curvature on native machines.
        role = (str(obj.get('equipmentComponentId', obj.get('componentId', ''))) + ' ' + obj.name).lower()
        if args.lod_ratio < 1 and not any(word in role for word in protected):
            if len(obj.data.polygons) > 96:
                bpy.context.view_layer.objects.active = obj
                modifier = obj.modifiers.new('Web LOD - preserve component transform', 'DECIMATE')
                modifier.ratio = args.lod_ratio
                modifier.use_collapse_triangulate = True
                bpy.ops.object.modifier_apply(modifier=modifier.name)
    resize_images(args.texture_edge)
    batches = consolidate_siblings()
    compact_material_slots()
    for name, old in before.items():
        obj = bpy.data.objects.get(name)
        if obj is None or old['parent'] != (obj.parent.name if obj.parent else None):
            raise RuntimeError('Component hierarchy changed: ' + name)
        if any(abs(a-b) > 1e-6 for a, b in zip(old['matrix'], [v for row in obj.matrix_local for v in row])):
            raise RuntimeError('Component pivot changed: ' + name)
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB',
                             export_extras=True, export_yup=True,
                             export_normals=True, export_tangents=True,
                             export_apply=True, export_cameras=False,
                             export_lights=False, export_animations=False,
                             export_draco_mesh_compression_enable=False)
    if args.save_blend:
        blend = target.with_suffix('.blend')
        if blend.exists():
            raise ValueError('Choose a new .blend destination; existing source models are preserved.')
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    print('SMARTTWIN_ASSET', json.dumps({'input': str(source), 'output': str(target),
          'objects': len(before), 'meshes': len(meshes), 'textureEdge': args.texture_edge,
          'lodRatio': args.lod_ratio, 'pivotsPreserved': True, 'renderBatches': batches,
          'motionCollisionValidation': 'Required in the existing SmartTwin runtime, not inferred from a static GLB.'}))


if __name__ == '__main__':
    main()
