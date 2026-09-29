# ADR: Project-Level Multi-Layout Furniture Model

## Status

Accepted for Phase 4A implementation.

This ADR freezes the data, persistence, runtime, history, import/export, and
package compatibility contracts for Phase 4A. It is an architecture contract,
not an implementation plan to be partially implemented in this phase.

## Context

The current openPlan3D document is a `Project` stored in the `currentProject`
Svelte store. The current persisted furniture authority is
`Project.floors[].furniture[]`. There is no `Layout`, `layouts[]`,
`activeLayoutId`, or project schema version today.

The main mutation hub is `src/lib/stores/project.ts`, but furniture-related
state is also created or changed by alignment, custom-model placement, RoomPlan
import, package conversion, Canvas gestures, and ThreeViewer placement. The
current undo/redo and version-history mechanisms store whole-project JSON.
IndexedDB also stores whole project JSON rather than furniture records.

Phase 4A moves only furniture authority. It does not move annotations,
entourage, or other floor data into Layouts.

## Source Findings

The following facts were verified against the current source and the completed
`LAYOUT_CHANGE_MAP.md`:

- `src/lib/models/types.ts` defines `FurnitureItem`, `Floor.furniture`, and
  `Project.floors`/`activeFloorId`, but no Layout model or schema version.
- `src/lib/utils/projectValidation.ts:readProject` is the shared untrusted
  project normalization and validation boundary. Datastore loads, version
  history restores, and package web data converge there.
- `src/lib/stores/project.ts` owns the whole-project snapshot undo/redo model,
  the `activeFloor` derived view, and most furniture writers. Drag paths can
  mutate furniture directly while preserving one grouped snapshot.
- `alignment.ts` directly changes selected item positions and publishes the
  project; it must be routed through the same Layout-aware write seam later.
- `customModels.ts` validates a project clone and currently appends a custom
  model instance to the active floor's furniture array.
- RoomPlan separates structural objects from furniture, but the current
  project builder assigns both to a `Floor`.
- The package currently writes `manifest.json`, `plan.json`, `web.json`,
  `baseline.json`, `mapping.json`, and assets. Native `plan.json` has no
  multi-Layout representation.
- `FloorPlanCanvas.svelte` reads furniture for drawing, hit testing, bounds,
  selection, and gestures. `ThreeViewer.svelte` reads furniture for scene
  building and calls the shared `addFurniture` writer for 3D placement.

The Change Map's open questions are resolved below by the product decisions in
this ADR. No source conflict was found that changes those decisions.

## Decision

### Project-level Layout

Layout lifecycle belongs to the Project, not to an individual Floor.

Conceptually:

```text
Project
├─ floors[]
├─ layouts[]
└─ activeLayoutId
```

One Layout is one complete, project-wide furnishing scheme. Layout A and
Layout B are whole-home alternatives. A Floor does not own its own A/B/C
variants; that would split one whole-home scheme across unrelated floor-local
collections.

### Layout-owned furniture grouped by Floor

Each Layout owns furniture instances grouped by shared Floor ID:

```text
Layout
└─ furnitureByFloor[floorId] = FurnitureItem[]
```

Furniture placement is floor-scoped inside a project-wide Layout. Building
structure is not copied into a Layout.

### Shared Floor structure

Floors remain the shared source for walls, rooms, doors, windows, columns,
stairs, background/floor geometry, and other existing non-furniture Floor
data. Phase 4A intentionally migrates only furniture authority.

### One furniture authority

Canonical persisted furniture exists only in `Layout.furnitureByFloor`.

There must be no canonical writable or persisted second copy in
`Floor.furniture`, and no dual write. A compatibility field may exist only at
the legacy-input or normalization boundary while old documents are converted.
It must not be exposed as a normal runtime furniture source or mutation target.

## Target Data Model

This is a minimal sketch of the target contract, not a replacement for
`types.ts`:

```ts
interface Project {
  id: string;
  name: string;
  schemaVersion: 1;
  floors: Floor[];                 // shared structure; no canonical furniture
  layouts: Layout[];
  activeLayoutId: string;
  customModels?: CustomModelDef[]; // Project-level definitions/assets
  // existing Project fields remain unchanged
}

interface Layout {
  id: string;
  name: string;
  furnitureByFloor: Record<string, FurnitureItem[]>;
}

interface Floor {
  id: string;
  name: string;
  walls: Wall[];
  rooms: Room[];
  doors: Door[];
  windows: Window[];
  columns: Column[];
  stairs: Stair[];
  backgroundImage?: BackgroundImage;
  // existing non-furniture fields remain here
}

interface FurnitureItem {
  id: string;
  catalogId: string;
  customModelId?: string;
  position: Point;
  rotation: number;
  scale: { x: number; y: number; z: number };
  // existing furniture properties remain unchanged
}
```

The legacy boundary may temporarily accept:

```ts
type LegacyFloorInput = Floor & { furniture?: FurnitureItem[] };
```

That type is input compatibility only. It is not the canonical runtime model.

## Furniture Authority

The only persisted and writable furniture state is:

```text
Project.layouts[layoutIndex].furnitureByFloor[floorId]
```

All furniture mutations—add, move, drag, rotate, resize, scale, mirror,
delete, duplicate, lock, property update, alignment, custom-model placement,
and 3D placement—must resolve the active Layout and current Floor before
reading or writing an item.

The implementation should create one small resolver/mutation seam in the
project store or canonical mutation layer. It must not introduce a large
framework or require each component to rediscover Layout selection.

## Shared Floor Structure

`Floor` is shared by every Layout in a Project. Switching Layout changes the
furniture selection only; it does not clone, replace, or mutate walls, rooms,
doors, windows, columns, stairs, background images, floor geometry, or other
shared structure.

## Active Layout Semantics

`Project.activeLayoutId` selects the whole-home furnishing scheme currently
shown and edited.

Changing it:

- does not copy furniture;
- does not copy Floors;
- does not create a Layout;
- does not create an undo entry for the content history;
- changes only which existing Layout supplies furniture to runtime reads and
  writes.

Every canonical Project has at least one Layout. The deterministic fallback
for a missing, invalid, or dangling `activeLayoutId` is:

1. choose the first Layout in array order;
2. if no Layout exists at the normalization boundary, create one Default
   Layout and select it.

Layout IDs should follow the project's existing ID style. They must be stable,
unique within the Project, repeatable through migration, and verifiable in
references; this ADR does not mandate a particular UUID implementation.

## Read Path / composedActiveFloor

Existing consumers may continue to receive a Floor-shaped read adapter:

```text
activeProject
  → activeFloorId
  → structuralFloor
  → activeLayoutId
  → layout.furnitureByFloor[activeFloorId]
  → composedActiveFloor
```

Conceptually:

```ts
const composedActiveFloor = {
  ...structuralFloor,
  furniture: activeLayout.furnitureByFloor[structuralFloor.id] ?? [],
};
```

`composedActiveFloor` is a derived compatibility view only. It is:

- not persisted;
- not authoritative;
- not independently writable;
- never saved back into the Project;
- never used as a second furniture store.

Canvas, ThreeViewer, bounds, scene-signature, print, PNG, SVG, PDF, CAD, and
other read-oriented helpers may consume this view or an equivalent shared read
adapter. Read consumers must not mutate it or pass it back as a canonical
Project update.

## Write Path

Writers resolve the canonical Project, active Layout, and current Floor. They
never write through `composedActiveFloor.furniture`.

Conceptual read/write examples:

```text
Read:
activeProject
  → activeFloorId
  → activeLayoutId
  → structuralFloor
  → layout.furnitureByFloor[activeFloorId]
  → composedActiveFloor       // read only
```

```text
Write moveFurniture(id, position):
currentProject
  → activeLayoutId
  → layout
  → layout.furnitureByFloor[activeFloorId]
  → item by id
  → update item
  → existing project mutation/history transaction
```

The existing snapshot/grouping behavior remains the transaction mechanism.
Direct mutation paths such as drag and alignment must still resolve the
canonical Layout before touching an item.

### Canvas

`FloorPlanCanvas.svelte` continues to use the Floor-shaped composed read view
for rendering, hit testing, selection, snapping, bounds, and gesture input as
far as the existing shape permits. It does not own Layout state.

Its calls continue to target project-store mutation APIs. Layout routing lives
in the store/canonical mutation layer, not in Canvas and not in
`canvasRenderer` or geometry helpers.

### ThreeViewer

`ThreeViewer.svelte` continues to consume composed Floor furniture for scene
building. Existing Three.js scene construction and GLB loading should remain
stable. Its 3D placement action must call the same active-Layout writer used by
Canvas.

In stacked or multi-floor view, one active Project-level Layout is used for
all displayed Floors. Each Floor reads
`activeLayout.furnitureByFloor[floor.id]`. Layout A therefore shows Layout A's
furniture on every displayed Floor, not furniture only on the currently active
Floor.

## Undo / Redo Semantics

The existing whole-Project snapshot model remains. Phase 4A does not introduce
command history, per-Layout history, or a separate Layout undo stack.

Once furniture is canonical under Layout, normal furniture edits naturally
enter the existing Project snapshot. Snapshots contain canonical furniture
once; they never contain a stale writable `Floor.furniture` mirror.

`setActiveLayout` is not an undoable content operation. During content
Undo/Redo or version-history restore:

- restore canonical Project content from the snapshot;
- preserve the user's current `activeLayoutId` when that ID still exists in the
  restored Project;
- if it no longer exists, apply the deterministic first-valid-Layout fallback.

This prevents an ordinary content undo from unexpectedly switching the user to
another Layout while still ensuring the selection is valid.

## Gesture Switching Rule

A Layout switch cannot occur in the middle of a drag, resize, rotate,
placement, or other grouped interaction transaction.

Before switching Layout, the interaction must be safely finished, cancelled, or
invalidated. The exact UI choice may be made during implementation, but this
sequence is forbidden:

```text
gesture starts on Layout A
→ user switches to Layout B
→ gesture commits into Layout B
```

The mutation seam must reject or invalidate a stale transaction if its source
Layout no longer matches the active Layout.

## Schema Versioning

`Project.schemaVersion` is the project-document schema version:

- absent `schemaVersion` means legacy version `0`;
- the first canonical Layout schema is `schemaVersion: 1`;
- a value greater than the supported version fails closed.

The canonical load sequence is:

```text
raw project
  → inspect schemaVersion
  → migrate if needed
  → validate canonical Project
  → runtime
```

An unknown future schema must never be destructively normalized. The loader
must not silently delete unknown fields, downgrade the document, or claim a
future document is canonical.

## Legacy Migration

Legacy `floors[].furniture[]` is migration input, not runtime authority.
Migration occurs once at the shared `readProject` /
project-validation-normalization boundary. It is not scattered across each
load or import entry point.

### Example

Before:

```text
Project
├─ floors
│  ├─ id: floor-1
│  │  └─ furniture: [chair-1]
│  └─ id: floor-2
│     └─ furniture: [table-1]
└─ activeFloorId: floor-1
```

After:

```text
Project
├─ schemaVersion: 1
├─ floors
│  ├─ id: floor-1              // walls/rooms/openings/etc. only
│  └─ id: floor-2              // walls/rooms/openings/etc. only
├─ layouts
│  └─ id: layout-default
│     └─ furnitureByFloor
│        ├─ floor-1: [chair-1]
│        └─ floor-2: [table-1]
└─ activeLayoutId: layout-default
```

Furniture is preserved, structural Floors are not copied, and the old
`Floor.furniture` authority is removed from the canonical result.

Migration must be lossless for supported legacy furniture and idempotent:
reading an already canonical version-1 Project must not create another Layout
or migrate furniture again.

Migration belongs at `readProject` because datastore load, JSON import, version
history restore, library restore, and package `web.json` handling already need
the same validation boundary. RoomPlan and package native conversion may
construct intermediate data, but their final Project must converge on this
boundary before runtime use.

## New Project Behavior

Every new Project creates one Default Layout, initializes an empty
`furnitureByFloor` array for every Floor (or treats missing entries as empty),
and sets `activeLayoutId` to that Layout.

## RoomPlan Behavior

RoomPlan structural data enters shared Floors: walls, rooms, doors, windows,
and other existing structural fields remain Floor-owned.

RoomPlan furniture enters a Layout:

- a new Project creates a Default Layout and places every imported object's
  furniture instance in `furnitureByFloor[floorId]`;
- importing a Floor into an existing Project adds its structure to the target
  Floor and adds its furniture to the current active Layout's
  `furnitureByFloor[targetFloorId]`, unless an explicitly documented existing
  product behavior requires another target;
- no RoomPlan path persists a second `Floor.furniture` authority.

## Custom Model Behavior

`CustomModelDef` remains a Project-level asset/definition. It is not copied per
Layout. A FurnitureItem may reference a `customModelId`.

Placing a custom GLB creates one FurnitureItem in the active Layout for the
current Floor. Switching Layout does not copy the GLB or its definition.
Different Layouts may contain separate FurnitureItems that reference the same
Project-level `CustomModelDef`.

## Project Duplication

Project duplication copies the complete canonical Project document—shared
structure, all Layouts, Layout furniture, custom model definitions, and
references—into a new Project identity.

The duplicate must be independent: Layout arrays, `furnitureByFloor` arrays,
and nested furniture objects must not share runtime object references with the
source. Existing duplicate semantics remain for Floor, wall, furniture, and
Layout internal IDs unless reference integrity requires otherwise. IDs do not
need to be regenerated merely because the document identity changes.

## IndexedDB / Persistence

Keep the existing whole-Project JSON IndexedDB design. Do not create Layout
object stores, furniture tables, or per-Floor furniture records.

The Project JSON gains `schemaVersion`, `layouts`, and `activeLayoutId` and is
stored by the existing document persistence. No IndexedDB storage-schema
upgrade is expected or justified by Phase 4A.

All saves, loads, copies, and history records must contain canonical furniture
only. The migration/normalization boundary is logical Project migration, not
an IndexedDB table migration.

## JSON Import / Export

JSON backup exports the complete canonical Project, including:

- `schemaVersion`;
- shared `floors`;
- all `layouts` and every `furnitureByFloor` collection;
- `activeLayoutId`;
- `customModels` and all other existing Project fields.

JSON export never reconstructs or writes a `Floor.furniture` mirror.

JSON import, including legacy JSON, enters through `readProject` so migration,
validation, and fail-closed future-version handling are identical to normal
document loading. A canonical round trip must not recreate legacy furniture
authority.

## Project Package Compatibility

Phase 4A does not expand native `plan.json` into a multi-Layout standard and
does not change ZIP byte mechanics.

The package contract is:

1. `web.json` contains the complete canonical Project: all Layouts,
   `activeLayoutId`, `schemaVersion`, shared Floors, custom models, and all
   existing web fields.
2. `plan.json` contains one native projection only: the Layout selected by
   `projectedLayoutId`.
3. `baseline.json` and `mapping.json` describe that same projected Layout and
   its native identities.
4. The package records the stable projection identity. The minimal placement
   is `manifest.json.projectedLayoutId`; when the package is retained in the
   loaded Project, the same value is retained in the existing
   `projectPackage` state. It is package metadata, not a new Project Layout
   authority.
5. Native edits are applied only to the Layout identified by the package's
   `projectedLayoutId`, never to whichever Layout happens to be active when
   the package is reopened.
6. Layouts not projected to native remain intact in `web.json`.

For a newly exported web package, `projectedLayoutId` defaults to the current
`activeLayoutId`. A canonical package with missing, invalid, or mismatched
projection metadata must fail closed rather than guess a different Layout.

Old packages without Layout metadata remain supported on a best-effort basis:
their native furniture is migrated into one Default Layout, and the package's
single native view is treated as that Layout. Compatibility must not reintroduce
dual writes or a persisted Floor furniture mirror.

## Native Projection Rule

At export time:

```text
projectedLayout = project.layouts[projectedLayoutId]
plan.json       = project structural data + projectedLayout furniture
baseline.json   = baseline of that same projection
mapping.json    = identities for that same projection
web.json        = full canonical Project with all Layouts
```

At native return/import time:

```text
read package metadata projectedLayoutId
→ read canonical web.json
→ apply native changes only to that Layout
→ preserve every other Layout unchanged
→ canonical read/validate boundary
```

The bridge may use the existing Floor-shaped native compatibility projection
internally, but that projection is temporary and cannot become persisted
`Floor.furniture` authority. Existing `floorId` mapping remains useful for
placing each native item into the correct `furnitureByFloor[floorId]` array.

## Export Behavior

PNG, SVG, PDF, CAD, print, bounds, scene signatures, and similar read-only
features use the active Layout's furniture for the selected Floor. They should
consume the shared composed Floor/read adapter rather than implement separate
Layout selection logic.

Phase 4A does not redesign the export subsystem.

## Invariants

The following are non-negotiable:

1. Only Layout owns persisted furniture.
2. Floor structure is shared across Layouts.
3. There is no `Floor.furniture` plus Layout furniture dual write.
4. A composed Floor is read-only and never persisted.
5. Every furniture mutation resolves the active Layout.
6. Legacy migration is lossless for supported furniture.
7. Migration is idempotent.
8. Unknown future `schemaVersion` fails closed.
9. Undo/version snapshots contain canonical furniture state only.
10. RoomPlan furniture enters a Layout.
11. Package `web.json` preserves all Layouts.
12. Native package projection cannot overwrite the wrong Layout.
13. Canvas and ThreeViewer do not own independent furniture state.

## Implementation Guardrails

Formal implementation should proceed in this order:

1. types and minimal target schema;
2. validation/normalization/migration;
3. project store resolver and writer seams;
4. consumer read adapters;
5. package bridge and package retained metadata;
6. focused tests.

Keep the following as stable as possible: `canvasRenderer`, geometry and hit
testing helpers, Three.js scene construction, GLB loader/resource code, ZIP
codec, and IndexedDB object-store mechanics.

If implementation appears to require any of the following, stop and treat it
as an architecture warning rather than continuing:

- a large `canvasRenderer` rewrite;
- a large Three.js scene architecture rewrite;
- a new independent Layout/furniture database;
- simultaneous persistence of `Floor.furniture` and Layout furniture.

## Files Expected To Change

The likely Phase 4A implementation surface is:

- `src/lib/models/types.ts`;
- `src/lib/utils/projectValidation.ts`;
- `src/lib/stores/project.ts`;
- `src/lib/utils/alignment.ts`;
- `src/lib/services/customModels.ts` and its placement caller;
- `src/lib/utils/roomplanImport.ts`;
- package bridge/service code for Layout projection and metadata;
- JSON/datastore/opening code only where canonical boundary integration is
  required;
- minimal Canvas/ThreeViewer adapter or writer wiring;
- focused tests under `tests/` and relevant browser coverage.

This list is a Phase 4A implementation forecast, not permission to modify
these files in this ADR phase.

## Files Expected To Stay Stable

Prefer not to change:

- `src/lib/utils/canvasRenderer.ts`;
- geometry, bounds, and hit-testing helpers;
- Three.js scene-building internals and GLB loading/resource code;
- ZIP byte/codec implementation;
- IndexedDB object-store definitions;
- unrelated AI, localization, Render Lab, Firebase, MCP, or native-handoff
  code.

`FloorPlanCanvas.svelte` and `ThreeViewer.svelte` are not absolutely untouched:
their unavoidable read/writer seams may change. Their mature rendering paths
should remain stable.

## Out of Scope

Phase 4A does not include collision detection, furniture-furniture or
furniture-wall collision, door-swing clearance, wall clearance, circulation,
inside-room validation, supplier catalog, pricing, brand, style engine,
Chinese UI, PNG furniture systems, AI, Firebase cleanup, MCP cleanup, Render
Lab cleanup, large renderer refactors, per-Layout permissions, collaborative
editing, cloud synchronization, Layout comparison UI, A/B visual comparison,
or business reports.

It also does not include a native multi-Layout standard, a command-history
redesign, a per-Layout undo stack, or an IndexedDB storage-schema redesign.

## Risks

- The migration is cross-cutting because existing source code directly reads
  and writes Floor furniture in several paths.
- Canvas has real gesture/write coupling even though its renderer can consume a
  composed Floor with little change.
- Package native projection is lossy by design; a missing projection identity
  could apply edits to the wrong Layout, so metadata validation is mandatory.
- Whole-project restore can accidentally restore `activeLayoutId`; the
  selection-preservation rule must be implemented deliberately.
- Legacy package input has less metadata than canonical web packages and needs
  a separate best-effort compatibility path.

## Acceptance Conditions

The next implementation round must be able to answer and implement these
without reopening architecture decisions:

1. Layout belongs to the Project.
2. Furniture authority is `Layout.furnitureByFloor`.
3. `Floor.furniture` is legacy migration input only, never runtime authority.
4. `activeLayoutId` is on Project.
5. `furnitureByFloor` is keyed by shared `floorId`.
6. Canvas reads the composed active Floor.
7. Canvas writes through the project-store active-Layout seam.
8. ThreeViewer reads the composed active Floor.
9. ThreeViewer placement writes through the same active-Layout seam.
10. Undo/Redo remains whole-Project snapshot history.
11. Layout switching is not an undoable content operation.
12. An in-progress gesture is finished, cancelled, or invalidated before a
    Layout switch and cannot commit across Layouts.
13. Legacy Projects migrate losslessly and idempotently at `readProject`.
14. RoomPlan structure enters Floors and RoomPlan furniture enters the Default
    or current active Layout according to the import context.
15. Custom GLB definitions remain Project-level and placements enter the active
    Layout.
16. JSON stores the full canonical Project.
17. IndexedDB keeps whole-Project JSON storage with no new furniture tables.
18. `web.json` stores all Layouts.
19. `plan.json` stores one Layout projection.
20. Native edits target the package's recorded `projectedLayoutId`.
21. Unknown future schema versions fail closed.
22. Canvas, ThreeViewer, geometry, scene-building, GLB loading, ZIP codec, and
    IndexedDB mechanics remain minimally changed.

## Consequences

This model makes whole-home furnishing alternatives explicit and prevents
Floor structure from being duplicated for each scheme. It also preserves the
existing renderer-facing Floor shape through a derived read adapter, limiting
consumer churn.

The cost is a cross-cutting migration of every furniture writer and every
boundary that can load or project a Project. The package remains intentionally
asymmetric: web JSON is complete, while native JSON is a single explicitly
identified projection.

## Rejected Alternatives

### A. Keep `Floor.furniture` as a second authority

Rejected because dual-write synchronization creates migration, persistence,
Undo/Redo, and stale-mirror risks.

### B. Give every Floor its own Layout A/B/C

Rejected because it breaks the meaning of one whole-home furnishing scheme.

### C. Let Canvas maintain Layout furniture state

Rejected because it creates UI-local authority and makes other consumers
diverge.

### D. Let ThreeViewer maintain a 3D furniture authority

Rejected because the 3D scene is a view, not a second document model.

### E. Add IndexedDB Layout tables

Rejected because current document persistence already stores complete Project
JSON and can carry the new fields without a storage-schema redesign.

### F. Put every Layout into native `plan.json`

Rejected because native plan format has no multi-Layout contract and expanding
it exceeds Phase 4A.

### G. Implement dual-write compatibility first and clean it up later

Rejected because the temporary architecture would become the most dangerous
part of the migration and could leak into snapshots and saved documents.

## Final Implementation Recommendation

Implement the smallest cross-cutting spike around one canonical migration
boundary and one active-Layout mutation seam. Preserve the existing
Floor-shaped read interface where it reduces renderer changes. Keep native
package projection explicitly single-Layout and identify it with
`projectedLayoutId`.

Recommended formal implementation model: **Luna Medium** for the architecture
and migration work, with Terra Medium as the minimum acceptable fallback if
the actual coding surface remains narrow and the package contract is covered
by focused tests.
