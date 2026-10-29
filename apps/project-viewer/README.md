# Project-selected browser applications

Build an installed, trusted local project without importing the all-sector
catalog or the SmartTwin workspace:

```
node tooling/build/project.mjs --project projects/agricultura/project.json
node tooling/build/project.mjs --project projects/turismo/project.json
```

The command resolves JSON manifests with discovery, calls
`writeProjectComposition`, and compiles the resulting explicit loader table
with the shared core and BrowserHost. It checks the actual webpack module graph:
a function cannot silently pull an unselected sector/function, editor, legacy
world or API into this app. Unsupported platform capabilities fail explicitly.
The existing public/core/workspace builds and package scripts are unchanged.

Each build prints a new immutable directory under `artifacts/projects/`, its
bundle hash, selected functions, source graph and file hashes. `publication.json`
lists the exact static files and selected local media allowlist. Build stats and
composition receipts stay under `data/build/compositions/`; they are not copied
to the publication. Files, code URLs, server files and other sectors named in
arbitrary project data do not become publication inputs. Declared media stays
inside a selected function package; linked paths and executable files are
rejected. No deployment is performed.

This browser is a **reference scene and declarative module interface**. It shows
a neutral floor/cube, selected UI models and project components. Agriculture
provides harvest records backed by the shared logical inventory; Tourism
provides ordered route progress. It does not provide a complete agricultural
simulation, physical warehouse or museum assets. State lives in this session.

Panels render through DOM `textContent`. An operator supplies JSON and explicitly
chooses an installed action; commands from project JSON are never autoexecuted.
Only actions registered by the panel's owning function can be dispatched.
Schemas and permissions remain responsibilities of the selected function and
its authoritative server adapter, when one is installed. This standalone app
has no network persistence or authentication backend.

For Agriculture, use `transaction` on Almacenamiento with
`{"operations":[{"type":"add-location","location":{"id":"field","capacityKg":100,"maxLoads":5}}]}`,
then `record` with
`{"id":"lot-1","crop":"mango","lot":"A","harvestDate":"2026-10-29","locationId":"field","quantity":12,"massKg":20}`.
Use `snapshot` with `null` to inspect that same inventory. For Tourism, the
declared route is prefilled for `configure`; `visit` accepts
`{"routeId":"museum","visitorId":"guest","position":[0,0,0]}`.

Verification: `node --test tests/framework/project-build.test.mjs` builds both
real browser graphs, verifies selected dependency closures and publication
hashes, and checks unsafe assets and foreign command models.
