# Configurable practices: source and native contracts

The active index is `modules/logistica-industrial/practices/configurable/index.cjs`.
It contains exactly five CEDI and five Smart Factory practices. A practice has
six internal stages; cases, difficulties and M/S/A modes are selectors, not
additional cards. The previous 64-practice source and readers remain available
to existing documents. Their coordinates and IDs must not be reused for these
new sources.

## Source records

The complete UTF-8 prompt and complete OOXML guide were read without modifying
either original. The reproducible extractor is
`tooling/content/build-configurable-practices.py`. Its original file hashes are:

- TXT: `8663d4203c0b1b5cb6fa8e7b0c291d24d06b435f2006925dce995a9f1fc0ad5f`.
- DOCX: `476c91fcf6a080a23741805c4841458b96907e967e8267087b73e9b053de15f8`.

The source contains ten practices, sixty stages, thirty mode inventories,
255 equipment aliases, 1,968 guide paragraphs, 36 tables and forty original PNG
diagrams. The bounded image manifest stores original byte hashes. Embedded
instructions are inert source text, never executable commands.

The table position is the **centre** of the hypothetical footprint. Conversion
to the centred native room is `X = tableX - width/2`,
`Z = tableY - depth/2`. No equipment mesh is stretched to fill an illustrated
zone. `LayoutBindings.cjs` records the table centre, native centre, selected
catalogue identity, required interfaces and component resources independently.

## Mounting and readiness

`Recipes.plan(id, settings)` validates the source identity and all selectors
before any native actor is allocated. Native M/S/A choices replace one actor
per alias. Manual modes do not hide active robots, AGV fleets, automatic sealers
or automatic wrappers behind manually labelled controls. Manual film application
uses a floor support and a human operation, rather than an automatically driven
wrapper.

There is an explicit distinction between `canConfigure` and `ready`. A finite,
recognisable native montage does not prove a completed material workflow. The
non-receiving practices retain their actual source BOM, layouts and six stages,
but their specialized material/quality/BOM adapters are not certified by a
generic Source → Processor pipeline. Their `materialFixture.status` is
`source-recipe-only`, and evaluated execution rejects before creating stock.

Readiness is restricted to the prepared CEDI-01/manual/base combination. Custom
equipment or positions stay in configuration mode until that alternative has
its own contact, route and material proof. A saved alias or port reference is
not presented as a completed physical connection.

## CEDI-01 material model

The isolated receiving order is six original loaded pallets, eight boxes per
pallet, five kilograms per box and twenty kilograms of pallet tare: 48 boxes
and 60 kg per loaded pallet. Each authored pallet has one persistent object ID,
one original store and eight stable box identities in the manifest. No source
generator recreates a pallet in inspection or receiving.

The illustrative eight-metre vehicle cannot be treated as six universally
reachable loads. The prepared adaptation uses a twelve-metre parked side-access
platform and a separate patio. All six pallets fit on its actual bed in one
accessible row. The floor-mounted driven forklift never drives or teleports up
onto the truck. The adaptation and measured poses are stored in
`manifest.layoutAdjustments`.

The source inspection table remains beside the floor/load area. It is not a
support for a complete pallet. Actual auxiliary resources include the restraint,
RF reader and scale. The teaching interlock enables the driven truck only after
the order and dock checklist have been completed. It is a local procedural
exercise, not a physical safety PLC or a certified restraint sensor.

E07 keeps its two source output positions. Four additional physical seats are
reserved in the explicitly marked continuation to CEDI-02. All six identities
remain present; stock is not deleted, regenerated or stacked merely to clear a
two-position buffer. Each receiving seat is a single 1.2 × 0.8 m pallet location,
not an inherited catalogue grid with an offset first slot.

## Runtime and evaluation

`ConfigurablePracticeRuntime` observes the existing native records and custody.
Its API is `snapshot()`, `actions()`, `command(type, payload)` and `dispose()`.
It does not assign object poses, call a synthetic deposit, create products or
set the session's passed flag.

The order/checklist is followed by physical unloading. Each pallet must reach
E04 and be stopped at low height before inspection. Counting, lot and mass are
contrasted with that actual identity. The quality decision must match its real
metadata. Reception registration is idempotent. Closing requires all six
registered loads in actual released/retained destination queues and conservation
of all 48 boxes. Remote forms cannot approve a pallet that remains on the truck.
Later stage evidence retains the earlier live material prerequisites.

The nine canonical settings are `mode`, `caseId`, `difficulty`, `executionMode`,
`equipmentSelections`, `layout`, `helps`, `evaluation` and `device`. Difficulty
three does not force an injected case-C fault. `workflowRequirements(plan)` is
pure and shared by scene manifests and server receipt validation.

## Geometry and VR evidence

All thirty montages are checked for source mapping, finite native geometry,
unit scale, valid actors, exterior vehicle floor support and bounded quantities.
This is not a claim that every proposed layout has certified static or swept
clearance. Operational readiness requires its separate material proof.

The budget helper counts visible ancestry, skips replaced/hidden catalogue
bodies, and treats geometry groups as separate draws only with material arrays,
matching the renderer convention. Resident hidden geometry/materials/textures
are reported separately. There are no additional dynamic lights or shadow maps
per actor. Several montages exceed the target of 250 visible draw calls before
frustum culling; actual Quest frame rate and headset memory remain to be measured.

Tests and evidence are in `tests/framework/configurable-*.test.mjs` and
`data/qa-studio/configurable-practices/`. The manual driving helper sends actual
bounded pedals, steering, lift and G/K pickup/release commands; it never changes
the vehicle or cargo transforms, joint pose or inventory ownership directly.

The complete prepared receiving regression passed with all six original pallets
in six actual released queues: source 0 boxes, released 48, total 48, no missing,
foreign or duplicated custody, all six stages accepted and score 100. It used
168,948 native input ticks over 2,815.9 simulated seconds and 578.8 driven metres,
with zero contacts. This is a manual operator proof, not a claim of autonomous
truck unloading, certified travel time or headset FPS. The native result receipt
is `data/qa-studio/configurable-practices/receiving-six-pallets.json`.
The ten-minute physical integration test lives separately at
`tests/native/configurable-practice-receiving-native.test.mjs`; ordinary framework
unit checks do not repeat that drive.
