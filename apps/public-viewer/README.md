# Public viewer

Independent anonymous application for **one** curated example: `vr-robot-dispatch`.
It loads the actual source → robot → pallet conveyor → manually driven forklift
→ stock-bay simulation. The finite batch is two pallets / eight boxes.

This entry does not construct SceneEditor, StudioExperience, rooms, stations,
accounts, galleries, AI, CAD or an asset-import library. `SelectedSceneDocument`
is a read-only format-1 adapter; shared equipment identities, node paths and
production runtime custody remain intact. It is deliberately not a general
project importer. Domain geometry and runtime imports are an explicit legacy
adapter at their canonical module paths.

## Build and deployment contributions

The application entry is `main.js`. The core host package has no renderer:
`packages/render-three/BrowserHost.js` owns one renderer and `setAnimationLoop`,
shared with `apps/core-empty/browser.js`; the app's selected module registers
the simulation system in the generic host. Primary render, locomotion, collision
frame boundaries and auxiliary vehicle cameras share that loop. Native XR head
poses are never written; locomotion changes the rig. The inherited camera feed
has one bounded auxiliary world pass per update, shared by front and rear.

Static allowlist:

* `index.html`, `viewer.js`, `viewer.css`, `config.js`;
* `projects/smarttwin/scenes/vr-robot-dispatch.json`;
* an optional generated catalog containing only that scene.

No external meshes, photographs, fonts, audio, textures or workers are requested
by this example. Prefabs, flooring, controller rays and labels are procedural.
CollisionWorld can use its synchronous geometry tree; this app does not invoke
the optional worker-preparation APIs. CAD/optimizer workers do not belong in its
artifact. Preserve the repository's Three r112 instancing compatibility loader
in the public compilation, with one Three realm shared across core adapters.

`config.js` contains public deployment addresses, never secrets. `apiOrigin`
or `workspaceURL` points the sign-in link to the authenticated service. Without
configuration the link explains how to obtain private access. The demo
makes no API requests and keeps no project or account state in browser storage.
Relative scene paths support a Pages subdirectory. The private workspace and
its examples are independent server/authenticated contributions.

## Verification

`node apps/public-viewer/tests/runtime.cjs` exercises the actual selected JSON,
geometry, collision world, robot cycle, stopped receiving belt and physical
fork pickup with the same pallet entry, four units and 33 kg. It verifies
snapshot immutability, restart and disposal. Browser QA must run against the
packaged artifact and its exact bundle hash, assert an empty API/telemetry/model
request list, check desktop/mobile and capture real WebGL screenshots. Emulated
XR inputs do not replace a physical Quest test.
