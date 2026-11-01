---
name: industrial-webxr-modeling
description: Improve existing SmartTwin/WebXR industrial machine models, native articulated parts, PBR surfaces and Blender-to-GLB assets while preserving operational rigs, study components and web/Quest budgets. Use for equipment realism and mechanism modeling, not separate illustrative replacement templates.
---

Work on the selected machine's actual native geometry. Inspect its prefab, rig,
materials, physical contact envelopes and persisted descendant IDs before edits.
Use the equipment study viewer/export to inspect the same model in assembled,
isolated and exploded views. An illustration is never a functional replacement.

Establish dimensional reference and provenance. Photos support a generic visual
approximation; claim an exact replica only with verified manufacturer drawings,
dimensions and joint frames. Prefer official manufacturer/URDF documentation and
licensed meshes. Keep visual meshes, contact geometry, joint limits and machine
logic separate. Preserve TCP, fork openings, seat and lever interaction frames.

Fix intersecting shells, face winding, cap topology, hard-edge normals and moving
part clearance before adding detail or dirt. Use real profiles, bearing gaps,
bolts and hoses with coherent attachments. Name meaningful components with
`equipmentComponentId`; add `robotJointId` for articulated links. A joint's bearing
contact is not a collision fault; separate it from non-adjacent link penetration.
Test supported trajectories and report the sampled coverage explicitly.

Keep manufactured paint dielectric, steel metallic and rubber/seat surfaces
distinct. Apply wear according to surface/contact location. Do not blanket a
painted machine with random chipped texture, duplicated opaque surfaces, or large
unclipped decals. Preserve authored material choices and resource cleanup.

Blender is an offline authoring tool. Use a separate factory-startup process,
never replace an open user scene. Export the existing selected equipment GLB,
then run `node tooling/modeling/build.cjs --input machine.glb --output machine-web.glb
--profile quest`. Output must be new. The runner inspects glTF, bounds resource
cost, preserves hierarchy/pivots, embeds resources, sizes textures and writes an
audit receipt. LOD is explicit via `--lod-ratio`; contact-critical parts remain
protected. Do not flatten articulated hierarchy or insert a static substitute.

For an editable Blender source, add `--save-blend` to the build command. If a
browser is unavailable, export the actual factory with
`node --openssl-legacy-provider tooling/modeling/export-native.cjs --kind robot
--variant articulated-general --output robot.json`, then pass that JSON as the
build input. This packet retains meshes, local matrices, names and PBR factors;
it omits image maps. Use the browser's GLB export when texture transfer matters.
Neither format by itself contains the operational runtime or a controller program.

Use `tooling/modeling/profiles.json` as the per-machine budget, then test the
whole target scene. Static GLB validation does not establish runtime collision,
mechanical correctness or headset FPS. Run native machine, custody and trajectory
regressions, compiled browser QA, and visual comparison before publishing. Keep
changes in one reviewed commit per user activity.

Technical references: [Blender glTF](https://docs.blender.org/manual/fr/5.2/addons/scene_gltf2.html),
[glTF PBR](https://www.khronos.org/gltf/pbr),
[UR visual/kinematic configuration](https://docs.universal-robots.com/Universal_Robots_ROS2_Documentation/doc/ur_description/doc/index.html).
