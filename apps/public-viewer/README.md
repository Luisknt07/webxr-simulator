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

## Contained failures in the public demo

Optional monitors, equipment-study prompts, lighting, visual indicators and the
inspection camera have separate error guards. A failing display waits one
second before retrying and disables itself after three consecutive failures;
physics and the remaining controls continue. Equipment selection also skips
its hidden desktop raycast while the operator is in the cab, in XR or using a
dialog.

A critical simulation error first neutralizes input and pauses material flow.
After 500 ms the disposable demonstration restarts from its authored inventory;
it never retries a partially executed physics step. An occupied cab is mounted
again with neutral controls and its authored parking brake. This discards the
current demo progress. A second critical error within 30 seconds stays paused
with **Menú → Reiniciar** available, avoiding a continuous restart loop.

`smartTwinViewer.getStats()` retains `lastFailure`, recovery attempt counts and
optional `displayErrors`, even after automatic recovery. Browser QA in
`tooling/qa/public-frame-recovery.cjs` injects optional and critical errors into
the exact compiled artifact under native RAF, verifies automatic recovery,
bounded retries, real menu recovery and subsequent carton/pallet custody.
`--hardware` selects the Windows D3D11 backend. These injected failures are
regression coverage, not a reproduction of a user-reported exception.

The reported `Función de objeto no compatible: pallet` was traced to a runtime
cargo specification overwriting the product behavior discriminator. Native
product meshes now keep `type: product` and retain their cargo kind in
`productType`. Study selection ignores meshes outside the authored document
before reading their behaviors, including runtime pallet ancestry. The native
regression and compiled browser QA exercise this read without moving cargo or
silently weakening authored behavior validation.

## VR entry and hydraulic controls

The top navigation always shows **Realidad virtual** while a scene is open.
A compatible browser requests `immersive-vr` directly from that user action.
Without a detected headset, the same action opens instructions and a support
recheck; it does not fake a session. HTTPS, browser support, permissions and a
connected visor are required for actual immersive entry. Retry, end-session,
optional hands and local-floor fallback continue through the shared VRButton.

The generic hydraulic bank follows the user's forklift photographs, rather
than verified OEM drawings. In the existing metre-scale cab, the operator
faces +Z and right is -X. The pivots sit on the forward right console; inclined
stems bring rounded handles rearward beside the rim. Narrow variants use an
additional row to retain spacing. Each visible knob and its XR grip share
the same pivot. Feature-specific channels, neutral return, steering/seat
frames, forks, load contact envelopes and TCP remain functional. Compact
pictograms are placed separately under the corresponding lever.

`tooling/qa/public-xr-cab.cjs` verifies exact artifact hashes, desktop/mobile
header visibility, compatibility help/input cleanup, an emulated permission
rejection, and assembled/isolated/exploded views of the same native machine.
`--baseline` captures the preceding public model before deployment. Native
cab tests exercise actual hydraulic movement from adapted controller/hand
poses. A physical headset run is still separate from these checks.

Physical controls also accept native mouse and multi-touch events against
the visible meshes. Pointer capture keeps a drag active outside the knob;
release, cancellation, blur, menus, tracking loss and unmount neutralize it.
Camera look is suspended only while that contact owns a cab control. A second
touch can operate a different lever; ownership cannot be stolen. Keyboard,
calibrated gamepad/wheel inputs, XR grips and measured hand pinches retain the
same runtime paths. Lever and pedal presentation follows actual input from
all these sources.

The photo-guided grips use small rounded lathe profiles, 11 mm steel stems
and inclined ribbed bellows. The standard electric cab identifies elevation,
tilt and side shift as 1/2/3. A rim spinner and actual horn, ignition/start,
lights, parking, emergency and separate reset controls are connected to
existing runtime commands. Ignition cannot bypass an emergency; reset never
starts the vehicle. Two existing pedals accept held input, with keyboard or
stick reverse retained. This electric variant has no simulated clutch/manual
gearbox or turn-signal circuit, so those controls from the reference are not
added as decorative buttons. No source contact geometry or fork TCP changes.

`tests/framework/vehicle-physical-controls.test.mjs` covers native picking,
mouse/touch cancellation, simultaneous touches, keyboard/external visual
feedback, pedal input, and controller/hand commands while stopped, including
emergency/reset/start sequencing. Cab labels share one atlas capped at
1024×512 for the expanded controls. Headset tracking and physical headset FPS
remain outside the claims of software-adapter tests.
