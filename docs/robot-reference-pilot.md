# Native six-axis visual pilot

`articulated-general` uses the reference pilot when `visualModel` is `auto`.
Choose `legacy` to compare the previous model. All other variants retain their
previous visual. Explicit `reference-pilot` is restricted to this variant.

The visible housings derive from the seven licensed visual links in the pinned
[KUKA robot-description repository](https://github.com/kuka-ros/kuka_robot_descriptions/tree/5ddbc41ce8726fd680bcc19562d78bcabfbdf96d/kuka_agilus_support/meshes/kr10_r900_2/visual).
The exact revision, source hashes, modifications, copyright and Apache 2.0 license
are retained in the robot module's `assets/reference-pilot` directory. This replaces
the first pilot's generic loft skins with the actual asymmetric shoulder casting,
elbow gearbox, motor casing, hollow forearm and wrist forms.

These are visual derivatives adapted to the existing native rig. Source offsets
are removed, link proportions follow the authored dimensions, and the source
branding is replaced by neutral fitted covers. This does not turn SmartTwin's
native robot into the manufacturer's calibrated product. Manufacturer joint
limits, torque, safety, payload and accuracy claims are not inherited. The public
[AGILUS description](https://www.kuka.com/en-us/products/robotics-systems/industrial-robots/kr-agilus)
and [ABB IRB1200 documentation](https://www.abb.com/global/en/areas/robotics/products/robots/articulated-robots/small-robots/irb-1200-next-generation)
also informed the distinction between internal service routing, structural
housings and the narrower wrist transmission.

The six native joint actors retain their original positions and rotation axes.
The forearm CAD skin belongs to J4 and extends backwards along its X rotation
axis; that coaxial visual arrangement does not move the mathematical wrist
centre. The native end effector and all its contact surfaces remain unchanged.
Study component IDs and actual joint IDs attach to the same operational model.

The offline importer creates three explicit LODs and quantized buffers. It uses
Blender's isolated factory process, then welds positional tessellation, marks
manufacturing creases and simplifies surfaces. Browser decoding restores indexed
positions and normalized normals. It does not run Blender or remote downloads in
the viewer. The default balanced machine plus its panel remains within the
35,000-triangle Quest export profile. High detail is intended for desktop study;
its full machine exceeds that Quest triangle profile.

| Native mechanism, without side console | Low | Balanced | High |
| --- | ---: | ---: | ---: |
| Triangles, standard gripper | 12,702 | 25,067 | 35,667 |
| Native mesh draws | 32 | 32 | 32 |

The native authored dispatch mechanism (3.2 m reach, vacuum tooling), isolated
for study, exports at 26,371 triangles and 37 draws. Three LODs occupy about
1.58 MB of quantized source data. The editable Blender and GLB study exports
retain semantic components and joint IDs; the JSON packet route transfers PBR
factors and geometry, with browser GLB preferred for image maps.

The CAD casting's local fillets, holes and mechanical seams are baked source
features; legacy fillet/chamfer controls do not retopologize those CAD surfaces.
Select `legacy` for those parametric casting controls. Native reach, base height,
payload-based section scaling, color/finish/wear and end-effector configuration
continue to affect the operational pilot. No standalone duplicate design library
is needed to use or study it.

The final shading uses offline corner-angle-weighted normals with a 35° crease
threshold. Face-area averaging on the uneven CAD triangulation made curved
castings look dented under specular light. This refinement changes only normals
and required vertex splits: every quantized position and ordered triangle is
identical in all three LODs, with SHA-256 geometry receipts in the asset and its
provenance. Existing topological vertex identities are retained so tiny CAD faces
are not collapsed by a shading operation. The source CAD still has finite
tessellation and seams; this is not a claim of perfect manufacturer surfaces.

Collision and motion validation remain necessary. Source CAD contains intentional
bearing contacts and separately tessellated pieces; its visual presence is not a
certified self-collision envelope. Native structural guards and actual tool/load
checks remain enabled. A static GLB/export audit does not establish headset FPS,
arbitrary joint safety or full manufacturer kinematic equivalence.

The pilot upper-arm guard follows its offset cantilever casting rather than the
legacy zero-Z bearing line. Five sampled sections in each LOD are checked in
both directions on Y and Z. The measured narrow web admits a conservative
`0.24t` capsule radius; this is an inscribed structural teaching guard, not a
complete CAD swept volume. Base and tool/load obstruction checks remain active.
