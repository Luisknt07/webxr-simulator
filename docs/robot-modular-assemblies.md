# Native modular robot assemblies

The articulated handling pilot has four complete, selectable structures. They
are the operational robot, not separate illustrative templates. Each uses the
same six native bearing frames, joint limits, runtime, semantic parts and tool
contact contracts.

| Structure | Constructive differences | Balanced triangles, gripper without side console |
| --- | --- | ---: |
| Compact training | Bench pedestal, compact yoke, slim cast links and compact wrist | 7,390 |
| Industrial six axis | Licensed adapted industrial castings, wider anchored base and inline transmission | 25,922 |
| Long reach | Wide footing, closed rectangular link sections, service covers and compact wrist | 15,138 |
| Heavy handling | Wide footing with gussets, reinforced yoke, wide cast links, conforming ribs and reinforced wrist | 13,550 |

These names describe generic appearance and assembly interfaces. They do not
grant an OEM payload rating. The broad industrial/compact distinctions were
checked against the primary [KUKA IONTEC product description](https://www.kuka.com/en-gb/products/robotics-system/industrial-robots/kr-iontec)
and [WLKATA Mirobot documentation](https://document.wlkata.com/?doc=%2Fwlkata-mirobot-user-manual-platinum%2F11-introduction-of-wlkata-mirobot%2F).
The industrial cast skins retain the existing Apache-2.0 source provenance.
The other constructive parts are native generic geometry, not copied OEM CAD.

`assemblyProfile` selects a structure. `baseAssembly`, `shoulderAssembly`,
`upperArmAssembly`, `forearmAssembly` and `wristAssembly` select compatible parts;
`auto` follows the structure's default part. `robotSchema.assemblies` exports
the profiles, part choices and a validated resolver with effective part names.
Explicit incompatible choices are rejected with a diagnostic. On a structure
change, the editor resets incompatible prior choices to `auto` atomically.
There are 60 curated combinations. These fields affect the handling pilot
(`articulated-general`, visual model `auto`/`reference-pilot`). Other variants
and explicit `legacy` retain their own geometry.

The replacement base plate contains the shoulder's horizontal footprint. Its
drum/crown meet the J1 column; the plate has real fasteners. Native covers and
reinforcement ribs conform to the measured casting section instead of floating
alongside it. Hose attachment rays account for the local position and rotation
of each replacement part. Shoulder/codo loops retain their actual gland ends.

## Tool mounting and the TCP

Top gripping and process tools retain the saved 200 mm axial TCP exactly.
The old fork/platform pilot models had detached supports: their contact plane
was at the TCP, but there was no structure connecting it to the wrist. Adding
a centred bar would have put the wrist inside a supported pallet's cargo.

For **pilot fork/platform only**, `robotKinematics.getDimensions(config)` now
returns `toolOffset = [0.20, supportDepth / 2 + 0.12, 0]` in the flange frame.
`toolSupport` declares the configured support footprint, bounded to width
0.40–1.40 m and depth 0.40–1.60 m. The positive offset puts the flange behind
the load in tool-local Y. FK, inverse kinematics and the visible tool assembly
use this same vector. The six bearing frames remain unchanged. The axial
`toolLength` remains 0.20 m; it is not the magnitude of this offset vector.

The fork adapter meets the flange and rear carriage. The platform has a rear
adapter and under-tray crossmember. Their real contact faces stay on the
mathematical support plane. The nominal supported load volume is clear of
the wrist and structural parts in the verified transport pose. This is not a
stability, deflection or pallet-load-restraint calculation. The runtime's load
policy still has to admit the actual load, tooling mass, size and capacity.
Vacuum/case grippers do not become pallet-support devices by choosing a shape.
Legacy models keep their previous tool offset. An old loaded checkpoint using
pilot fork/platform must validate its saved grasp against the new physical
tool transform rather than silently dropping its load or bypassing clearance.

## Verification boundary

The regression constructs all 60 compatible combinations with connected
service endpoints and a clear structural guard in the nominal carrying pose.
Four complete structures and five tools cover 340 FK/IK comparisons, unchanged
six-axis frames and a 350 mm high supported load volume. The curved harness
sweep checks 1,144 centre-to-structural-surface distances over thirteen poses
per structure (minimum 13.44 mm). Existing 45 variant/detail, source CAD, tool
contact, native document refresh and runtime regressions remain required.
The sampled coverage does not certify arbitrary joint configurations, physical
machine safety or Quest frame rate. High detail and large authored cells need
their own whole-scene budget checks.
