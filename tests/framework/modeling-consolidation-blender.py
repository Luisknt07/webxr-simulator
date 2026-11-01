"""Bounded Blender CLI regression; never run against an open user scene.

blender --background --factory-startup --disable-autoexec --python-exit-code 1
  --python tests/framework/modeling-consolidation-blender.py
"""
from pathlib import Path
import runpy
import json
import struct
import tempfile
import bpy

assert not bpy.data.filepath, 'Use an unsaved --factory-startup process.'
assert len(bpy.data.objects) <= 3, 'This regression must own its isolated scene.'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
script = Path(__file__).resolve().parents[2] / 'tooling/modeling/build-asset.py'
pipeline = runpy.run_path(str(script))
consolidate = pipeline['consolidate_siblings']
parent = bpy.data.objects.new('Test actual parent', None)
bpy.context.collection.objects.link(parent)
material = bpy.data.materials.new('Test shared paint')


def surface(name, joint, x):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [], [(0, 1, 2)])
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location.x = x
    obj['equipmentComponentId'] = 'same.assembly'
    obj['robotJointId'] = joint
    return obj


first = surface('First actual link', 'J1', 0)
second = surface('Second actual link', 'J2', 3)
bpy.context.view_layer.update()
assert consolidate() == 0, 'Different actual joint IDs must not share a render batch.'
assert first.type == second.type == 'MESH'
before = first.matrix_local.copy()
third = surface('Rigid detail of first link', 'J1', 1)
bpy.context.view_layer.update()
assert consolidate() == 1, 'Rigid siblings of the same joint should still consolidate.'
meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH']
assert len(meshes) == 2
assert {obj['robotJointId'] for obj in meshes} == {'J1', 'J2'}
pivot = bpy.data.objects['First actual link']
assert pivot.type == 'EMPTY' and pivot.parent == parent
assert all(abs(a-b) < 1e-6 for row_a, row_b in zip(before, pivot.matrix_local) for a, b in zip(row_a, row_b))
assert bpy.data.objects['Second actual link'] is second
assert sum(len(obj.data.polygons) for obj in meshes) == 3
print('SMARTTWIN_CONSOLIDATION_OK: distinct actual joints separated; rigid detail merged; pivots/triangles retained.')

# Exercise the packed-image glTF path, not just Blender's in-memory size. A
# scaled image with old packed bytes can silently export at its original size.
image = bpy.data.images.new('Test packed pixels', width=8, height=4)
image.generated_color = (0.2, 0.4, 0.6, 1)
image.pixels[:] = [0.2, 0.4, 0.6, 1] * 32
image.pack()
material.use_nodes = True
texture = material.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = image
material.node_tree.links.new(texture.outputs['Color'], material.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
with tempfile.TemporaryDirectory(prefix='smarttwin-texture-regression-') as directory:
    source = Path(directory) / 'source.png'
    source.write_bytes(image.packed_file.data)
    lazy_image = bpy.data.images.load(str(source), check_existing=False)
    assert not lazy_image.has_data, 'Test must cover the lazy imported-image branch.'
    texture.image = lazy_image
    pipeline['resize_images'](4)
    assert list(lazy_image.size) == [4, 2]
    output = Path(directory) / 'resized-test.glb'
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_extras=True)
    binary = output.read_bytes()
    json_length = struct.unpack_from('<I', binary, 12)[0]
    document = json.loads(binary[20:20+json_length])
    embedded = binary[28+json_length:]
    assert document.get('images'), 'The actual exporter must include the test texture.'
    for row in document['images']:
        view = document['bufferViews'][row['bufferView']]
        png = embedded[view.get('byteOffset', 0):view.get('byteOffset', 0)+view['byteLength']]
        assert png[:8] == bytes([137, 80, 78, 71, 13, 10, 26, 10])
        assert struct.unpack_from('>II', png, 16) == (4, 2), 'GLB must contain resized packed bytes.'
print('SMARTTWIN_TEXTURE_OK: actual GLB contains resized 4x2 PNG, not the original 8x4 packed bytes.')
