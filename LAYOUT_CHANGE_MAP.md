# Phase 4A-0 — Layout Change Map

## 1. Executive Summary

Baseline is valid and clean. The current authoritative project document is the `currentProject` Svelte writable store; furniture is persisted inside `Project.floors[].furniture[]`. There is no `Layout` type, `layouts[]`, or `activeLayoutId` today.

The main furniture mutation path is `src/lib/stores/project.ts` (`mutate()` plus `addFurniture`, `updateFurniture`, `removeFurniture`, drag/transform, duplicate, reorder, and selection operations). It is not the only path: `customModels.ts`, `alignment.ts`, `roomplanImport.ts`, package bridge code, and `ThreeViewer.svelte` also construct or mutate furniture-related state.

The safest future boundary is one writable furniture source under Layout, with a derived/composed active floor supplied to existing consumers. Canvas requires a medium-sized adapter because it both reads furniture arrays and owns many interaction paths. ThreeViewer is mostly a renderer, but its 3D placement button is a real writer and must be routed through the active Layout.

The most dangerous double-write risk is retaining `Floor.furniture` as writable state while introducing `Layout.furniture`, especially through `project.ts` drag/mutation APIs, `importFloorIntoCurrentProject`, custom-model placement, RoomPlan/package import, and undo snapshots.

## 2. Baseline / Git State

- Working directory: `D:\01-Projects\10-soft-furnishing\soft-furnishing-app`
- Branch: `feature/layout-spike`
- HEAD: `d68cadf703578f2cd3a7c77f820e18d342580c32`
- HEAD subject: `d68cadf Merge pull request #100 from laanlabs/fix/mcp-tool-annotations`
- Remote: `upstream https://github.com/laanlabs/openPlan3D.git`
- Initial working tree: clean
- This pass: source inspection only; no install, build, test, format, commit, checkout, reset, stash, fetch, or pull was run.

## 3. Current Furniture Source of Truth

`src/lib/models/types.ts:39-64` defines `FurnitureItem`, and `Floor: furniture: FurnitureItem[]` at `types.ts:178-196`. `Project` has `floors[]` and `activeFloorId`, but no schema version or layout collection.

`src/lib/stores/project.ts:38` exports `currentProject = writable<Project | null>(null)`. This is the authoritative in-memory document. `activeFloor` at `project.ts:40-43` is a derived store selecting `floors.find(activeFloorId)`; it is not a writable furniture store.

Concrete authoritative write mechanisms:

| Path | Symbol | Current behavior | Layout consequence | Risk |
|---|---|---|---|---|
| Normal mutations | `project.ts:245 mutate` | Finds `p.activeFloorId`, mutates a `Floor`, then publishes `{ ...p }` | Central adapter point for Layout furniture writers | HIGH |
| Add/update/delete/reorder | `addFurniture`, `updateFurniture`, `removeFurniture`, `reorderFurniture` | Writes `floor.furniture` | Must target active Layout only | HIGH |
| Drag/transform | `moveFurniture`, `transformFurnitureDuringDrag`, `beginDrag`, `endUndoGroup` callers | Mutates item in place and republishes project | Must preserve one snapshot and active-layout routing | HIGH |
| Custom model placement | `src/lib/services/customModels.ts:24-33` + `CustomModelPanel.svelte:66-74` | Builds a validated project clone, pushes into `floor.furniture`, commits via `commitItemDetails` | Must place into active Layout, not a floor shadow | HIGH |
| RoomPlan | `src/lib/utils/roomplanImport.ts:561-765, 839-889` | Creates furniture in an imported `Floor`, then assigns it to project floors | Must seed the default Layout | HIGH |
| Package bridge | `projectPackageBridge.ts:123-164, 229-301` | Converts native furniture to/from each floor's `furniture` | Must define package mapping for Layout furniture | HIGH |
| 3D placement | `ThreeViewer.svelte:859-869` | Calls `addFurniture()` after a 3D click | Must route through the same active-layout writer | HIGH |

Therefore the exact answer is: `currentProject` is the document authority; `Floor.furniture` is the current persisted furniture authority; `project.ts` is the main writer hub, but not an exclusive writer hub.

## 4. Floor.furniture Read/Write Map

### READ_ONLY_RENDER

| Location | Symbol/region | Current behavior | Future handling | Risk |
|---|---|---|---|---|
| `src/lib/components/editor/FloorPlanCanvas.svelte:546, 1228-1278, 3667` | Canvas draw, selection, hit-related reads | Reads active floor furniture for drawing, labels, selection and bounds | Consume composed active floor or a furniture accessor | HIGH |
| `src/lib/utils/canvasRenderer.ts:910, 1629+` | `drawFurnitureItem`, floor rendering | Renders passed `Floor` and iterates furniture | Should remain generic; feed composed floor | MEDIUM |
| `src/lib/components/viewer3d/ThreeViewer.svelte:1501-1505` | 3D build | Iterates `floor.furniture` and creates placed models | Should consume composed active floor | MEDIUM |
| `src/lib/utils/export.ts:181-333, 649-925` | PNG/SVG/PDF export | Selects active floor and iterates furniture | Export active Layout through composed view | HIGH |
| `src/lib/utils/cadExport.ts:42-208` | DXF/DWG | Selects active floor and draws furniture | Same active-layout adapter | MEDIUM |
| `src/lib/utils/printLayout.ts`, `scaledPrint.ts` | Print/render helpers | Read furniture from selected floor | Same adapter or normalized export input | MEDIUM |
| `src/lib/utils/planContentBounds.ts`, `selectionContentBounds.ts`, `multiSelectionBounds.ts` | Bounds | Treat furniture as floor content | Must see active Layout furniture | MEDIUM |
| `src/lib/utils/sceneSignature.ts:14+` | Render invalidation | Includes floor furniture in scene signature | Include active Layout state without duplicating it | MEDIUM |
| `src/lib/components/sidebar/LayersPanel.svelte:72+`, `ContextToolbar.svelte:43+`, properties panels | UI reads | Lists and edits selected floor furniture | Use active-layout view and writer | HIGH |

### MUTATION

| Location | Symbol | Current behavior | Future handling | Risk |
|---|---|---|---|---|
| `project.ts:313-321` | `addFurniture` | `f.furniture.push(...)` inside `mutate` | Write active Layout furniture | HIGH |
| `project.ts:331-359` | drag functions | Directly mutates item position/transform and republishes | Write active Layout; retain drag grouping | HIGH |
| `project.ts:383-420` | rotate/scale/reorder/remove | Mutates or replaces floor furniture array | Write active Layout | HIGH |
| `project.ts:766-781` | `updateFurniture` | `Object.assign` into matching item via `mutate` | Central property writer | HIGH |
| `project.ts:601-617` | `removeElement` | Filters furniture when deleting selected element | Must delete from active Layout | HIGH |
| `project.ts:1031-1043` | `duplicateFurniture` | Copies item with new ID and offset | Duplicate within active Layout | HIGH |
| `project.ts:1011-1028` + `duplicateSelection.ts` | selection duplicate/paste | Clones floor and appends copied furniture with new IDs | Must not copy structure into another authority | MEDIUM |
| `src/lib/utils/alignment.ts:83-108` | `alignElements` | Directly mutates selected furniture positions, then `currentProject.set` | Must use active-layout mutation transaction | HIGH |
| `src/lib/services/customModels.ts:24-33` | `placeCustomModel` | Pushes a furniture item into a project clone | Must target Layout | HIGH |
| `ThreeViewer.svelte:859-869` | 3D placement | Calls `addFurniture` | Writer is shared, so adapter can contain the change | HIGH |

### UNDO_HISTORY

`project.ts:68-243` stores whole-project JSON snapshots in `undoStack`/`redoStack`. Furniture drag snapshots begin at `beginDrag()` or `beginUndoGroup()` and close at Canvas gesture end. Property edits use `snapshot()` and coalescing keys. Version history in `src/lib/stores/versionHistory.ts` stores whole `Project` JSON in IndexedDB `history`.

### PERSISTENCE

`src/lib/services/datastore.ts:72-86` saves `JSON.stringify(project)` to the IndexedDB `projects` store. `load()` at `datastore.ts:108-117` parses and validates through `readProject`. `saveCopy()` at `datastore.ts:88-105` validates/clones the complete document and changes only project ID. `src/lib/services/localDatabase.ts` has object stores `projects`, `thumbnails`, `history`, `meta`; the database schema is storage-level, not furniture-level.

### IMPORT

`src/lib/services/projectOpening.ts:12-59` validates any candidate through `readProject`, saves the current project, loads the candidate, and auto-saves it. `roomplanImport.ts` and package bridge create floor furniture before this load path. Custom model placement constructs a project clone and commits it through the store.

### EXPORT

JSON export is direct `JSON.stringify(project)` in `src/lib/utils/projectBackup.ts:4-11`. Image/CAD/PDF/SVG exports select the active floor and consume `floor.furniture`. Project ZIP export uses `projectPackage.ts` and its native/web bridge, which serializes both `plan.json` and `web.json`.

### VALIDATION

`src/lib/utils/projectValidation.ts:7-183` structured-clones input, defaults missing arrays, validates each floor furniture item, custom model references, dimensions and scale, refreshes legacy furniture categories, and returns a normalized clone. It does not currently migrate Layouts or reject unknown project schema versions.

### DUPLICATION

Full project copy is `localStore.saveCopy()` / `duplicate()`; it changes project ID but retains floor and element IDs. Canvas selection duplication generates new element IDs in `duplicateSelection.ts`. Neither path knows about layouts today.

### TEST_FIXTURE

Relevant fixtures include `tests/fixtures/furniture-fidelity.openplan.json`, `legacy-furniture-previews.openplan.json`, `handoff-roomplan.json`, `native-project-package.zip`, `web-project-package.zip`, and custom-model package fixtures. Exact coverage is listed in section 16.

## 5. Furniture Mutation Map

| Operation | UI / caller | Writer function | Current target | Undo entry | Future Layout impact |
|---|---|---|---|---|---|
| add/place | Canvas `FloorPlanCanvas.svelte:2418-2430`; ThreeViewer `859-869` | `addFurniture`, optional `rotateFurniture` | `activeFloor.furniture` | Grouped `Placed furniture` | All callers must converge on active Layout |
| move/drag | Canvas `2862-2868, 2961-2991` | `moveFurniture` or `transformFurnitureDuringDrag` | Existing item in active floor | `beginUndoGroup` / `Moved furniture` | Highest adapter surface |
| rotate | Canvas handles and context menu | `rotateFurniture`, `setFurnitureRotation`, `rotateSelection` | Active floor furniture | Grouped or snapshot | Must not update other Layouts |
| resize/scale | Canvas `2898-2927` and property panel | `scaleFurniture`, `updateFurniture` | Active floor furniture | Grouped `Resized furniture` or coalesced | Keep transform semantics identical |
| mirror | Canvas context action | `scaleFurniture` with negative axis | Active floor furniture | Normal mutation | Must preserve sign/validation |
| delete | Canvas/context/keyboard | `removeFurniture` or `removeElement` | Active floor furniture | `Deleted furniture` | Delete active Layout only |
| duplicate | Context/keyboard | `duplicateFurniture`, `duplicateSelection` | Active floor furniture | Normal/grouped snapshot | New ID remains within active Layout |
| lock/unlock | Selection/property actions | `toggleFurnitureLock` / `toggleSelectionLock` | Active floor item(s) | Normal mutation | Must stay Layout-scoped |
| property update | `PropertiesPanel.svelte` | `updateFurniture` | Active floor item | Coalesced `snapshot` | Must not write a floor mirror |
| custom GLB place | `CustomModelPanel.svelte:66-74` | `placeCustomModel` then `commitItemDetails` | Clone of active floor furniture | Whole-project snapshot via commit | Must place into active Layout and preserve `customModelId` |
| align/distribute | `alignment.ts:83-108` | Direct item mutation + `currentProject.set` | Active floor furniture | Undo group | Must be brought under the same active-layout transaction |

Direct object mutation exists in drag, alignment, selection rotation, and some custom-model paths. Direct array `push`, `splice`, and replacement exist in `project.ts`, custom model service, RoomPlan import, and package bridge. The current design is document mutation plus reactive publish, not immutable updates at every leaf.

## 6. activeFloor Data Flow

`Project` → `currentProject` → derived `activeFloor` (`project.ts:40-43`) → Canvas/ThreeViewer subscriptions.

- Canvas subscribes to `activeFloor` around `FloorPlanCanvas.svelte:1792-1810`, stores it in local `currentFloor`, reads its furniture for draw/hit/drag, and calls store writers.
- ThreeViewer imports `activeFloor`, subscribes at `ThreeViewer.svelte:2010-2017`, stores `currentFloor`, rebuilds the scene, and iterates its furniture at `1501-1505`.
- Property and layer panels read `activeFloor`/`currentProject` and call store writers.
- Export functions receive a full `Project`, choose `activeFloorId`, and read the selected floor.
- `setActiveFloor` at `project.ts:892-900` changes `activeFloorId` without a history snapshot; it clears floor-local UI context.

A `composedActiveFloor` is theoretically viable: copy/derive shared structure from the selected Floor and expose active Layout furniture as `furniture[]`. It must be a render/input adapter only, never persisted or passed into a writer as a second document. The main concern is that many helpers accept a `Floor` and some writers locate the real floor by `activeFloorId`; the adapter must be used only for reads while writers resolve the authoritative Project/Layout.

## 7. Canvas Impact

Classification: **MEDIUM_CHANGE**.

The Canvas is not only a renderer. `FloorPlanCanvas.svelte` reads `currentFloor.furniture` for selection, hit testing, snapping, bounds and gesture state, and routes add/move/rotate/resize/delete/duplicate/lock/property operations to store functions. It already has a clean central store import list (`line 12`) and the render implementation is extracted into `canvasRenderer.ts`.

Likely minimum change: make `activeFloor` or a compatible derived view expose composed `furniture[]`, then ensure every writer in `project.ts`, `alignment.ts`, and custom-model placement resolves the active Layout. If the existing `FloorPlanCanvas.svelte` consumer shape is preserved, drawing code and most hit-testing code can remain unchanged. The gesture code still needs active-layout-aware writer guarantees and tests.

## 8. ThreeViewer Impact

Classification: **SMALL_ADAPTER**.

ThreeViewer renders `floor.furniture` at `1501-1505` and otherwise subscribes to the derived active floor. It has no transform/edit path for existing furniture, but it does place new furniture through `addFurniture` at `859-869`.

If a composed active floor continues to expose `furniture[]`, the existing render loop can theoretically remain unchanged. The 3D placement action must still write through the active Layout. This is a small writer/adapter concern, not a renderer rewrite. Multi-floor stacked rendering also calls `buildFloorIntoGroup`; future semantics must explicitly decide whether non-active floors use their active/default Layout or remain structure-only.

## 9. Undo / Redo Impact

The current model is whole-Project JSON snapshot history, not command pattern or partial state (`project.ts:68-243`). `mutate()` snapshots before changing the active floor; drag uses one pre-drag snapshot and Canvas closes one grouped entry; `versionHistory.ts` stores complete project JSON separately.

Furniture add, move, resize, rotation and delete naturally enter history if they route through existing snapshot/group helpers. Layout switch currently does not enter history because `setActiveFloor` does not snapshot. Adding `activeLayoutId` creates a choice: if switching is not snapshotted, undo restores content edits but not the selected layout; if it is snapshotted, users may expect switch undo. This is a product decision, not a reason to duplicate furniture.

Risks after Layout introduction:

- HIGH: snapshots containing both a stale `Floor.furniture` mirror and `Layout.furniture` can restore one but not the other.
- HIGH: drag started in Layout A and completed after a switch could commit against the wrong active Layout unless switch cancels/invalidates the gesture.
- HIGH: `restoreHistoryProject()` restores whole documents and will restore `activeLayoutId` if present; partial compatibility code must not rehydrate a different Layout's furniture.
- MEDIUM: version-history restore uses `readProject(JSON.parse(snapshot.data))`, so migration must happen before validation consistently.
- LOW/MEDIUM: Layout switch history behavior is currently undefined and should be decided before implementation.

## 10. IndexedDB / Datastore Impact

IndexedDB stores complete project JSON strings in one `projects` object store. `localDatabase.ts:17-35` opens database version 1 and creates `projects`, `thumbnails`, `history`, and `meta`. There is no furniture table, per-floor record, or object mapping. `datastore.ts:72-117` performs JSON save/load and `readProject` validation.

Classification: **SMALL_CHANGE** at the IndexedDB layer. No database schema migration is required just to add JSON fields. The validation/normalization path must understand `layouts[]`, `activeLayoutId`, and legacy conversion. Existing localStorage-to-IndexedDB migration stores raw project JSON and calls `readProject` only while recovering changed legacy records (`localDatabase.ts:122-145`), so the unified project migration hook must cover that path too.

Persistence risks are logical, not database-schema risks: raw JSON save, version-history JSON, library backup, recovery copies, and thumbnails all need to retain the same single authoritative Layout furniture source.

## 11. JSON Import / Export Impact

JSON export is direct whole-project serialization (`projectBackup.ts:4-11`). Import/open goes through `projectOpening.ts` and `readProject`. There is no transform layer for JSON backup beyond validation/defaulting and `refreshLegacyFurnitureCategories`.

Best migration hook: a shared normalization/migration step at the start of `readProject` in `src/lib/utils/projectValidation.ts`, before field validation and before any caller-specific import logic. All datastore loads, JSON imports, version-history restores, library restores, and package `web.json` reads already converge on `readProject`.

Legacy `Floor.furniture[]` should be moved into one default Layout per project (or per floor only if the final schema explicitly makes Layouts floor-scoped; the proposed model says project-level layouts). The migration must remove the legacy furniture authority from the persisted schema or mark it read-only/compatibility-only; leaving both arrays populated and writable is unsafe.

No migration is implemented in this phase.

## 12. Project Package Impact

Project package is not a simple ZIP of one JSON. `projectPackage.ts:57-105` validates the web Project, converts it through `webToNative`, and writes `manifest.json`, `plan.json`, `web.json`, `baseline.json`, `mapping.json`, plus `assets/*`. `readProjectPackage()` reads and validates native plan data, optional web return data, applies native edits against baseline, reconstructs mapping, retains assets, and finally calls `readProject`.

`projectPackageBridge.ts:123-164` maps native `plan.furniture` into `floor.furniture`; `229-301` maps each floor's web furniture back to native furniture and mapping entries. Custom GLB references are carried through `customModels`, `projectPackage.assets`, and native asset names. Layouts therefore affect:

- web JSON round-trip;
- native `plan.json` projection, which has no current Layout concept;
- baseline and mapping identity, especially furniture `floorId`;
- native edit merge in `applyNativeEdits` (`bridge.ts:177-227`);
- custom GLB assets and attachment references;
- package import/export validation and native return behavior.

Classification: **MEDIUM_CHANGE** for the package subsystem. The ZIP mechanics stay unchanged, but the semantic bridge must decide whether a package represents the active Layout only, carries all Layouts in `web.json`, or has an explicit compatibility projection in `plan.json`. This is a real contract decision.

## 13. RoomPlan Impact

`src/lib/utils/roomplanImport.ts:561-765` separates walls, doors, windows, objects, and sections. Objects become `FurnitureItem[]` at `672-695`; walls/openings/rooms remain separate arrays. `importRoomPlanFloors()` creates one Floor per story, and `createProjectFromRoomPlan()` assigns each imported array into fresh project floors at `839-889`.

The natural future path is `RoomPlan import → shared Floor structure + default Layout furniture`. Current source separation is already favorable. The importer itself should not know about Layout selection beyond producing an imported furniture collection or seeding the default Layout. `project.ts:948-965` is another import path that merges imported furniture into the active floor and is a high-risk future writer.

## 14. Duplicate Project Impact

Real full-project duplication is `localStore.duplicate()` → `load()` → `saveCopy()` in `datastore.ts:153-159`. `saveCopy()` uses `readProject`, changes only `copy.id`, timestamps, name, and stores the serialized copy. Floor IDs, room IDs, wall/opening IDs, furniture IDs, `customModelId` references, custom model definitions, package asset names, and mapping web IDs are retained.

This is internally consistent because the copy is a complete independent document and element IDs need not be globally unique across projects. With `layouts[]`, the minimal change is to clone layouts and their furniture as part of the Project document while preserving internal references. Do not regenerate furniture IDs unless the future schema introduces cross-project global identity.

Canvas selection duplication is separate: `duplicateSelection.ts` generates new IDs for selected elements and remaps wall references. It must generate new furniture IDs within the active Layout and must not duplicate shared structural walls merely because a Layout furniture item is selected.

## 15. Schema Version / Migration Hook

`Project` has no `schemaVersion` or `version` field in `types.ts`. `ProjectPackageState.version` is only the retained package state version; package manifest version 1 is a separate ZIP contract.

Recommended minimum strategy:

1. Add one project-schema migration/normalization entry immediately before validation in `readProject`.
2. Convert legacy `floors[].furniture[]` into the default Layout representation there.
3. Validate the migrated current shape once.
4. Have every load/import/restore path continue using `readProject`.
5. Reject or protect against a future `schemaVersion` greater than the supported version at this shared boundary, before destructive normalization.

The likely alternatives (`project.ts` load, datastore load, JSON import, package import) are all too narrow and would create divergent migration behavior. Package manifest/native version checks remain separate for package transport, but web project schema migration should still converge through `readProject`.

## 16. Existing Test Coverage

Existing relevant tests were found by source inspection; none were executed.

- Furniture mutation: `tests/furniture-interactions.test.ts`, browser furniture/context/property/rotation/drag specs.
- Furniture model/custom model: `tests/furniture-models.test.ts`, `tests/custom-model-*.test.ts`, browser custom-model specs.
- Undo/Redo: `tests/undo-groups.test.ts`, `tests/undo-history-jump.test.ts`, `tests/undo-messages.test.ts`, `tests/version-history.test.ts`, browser `geometry-drag-undo.spec.ts`, `accessory-drag-undo.spec.ts`.
- Save/reload/IndexedDB: `tests/datastore.test.ts`, `tests/localDatabase.test.ts`, `tests/projectOpening.test.ts`, `tests/saveStatus.test.ts`, browser `indexeddb.spec.ts`, `project-opening.spec.ts`.
- JSON validation: `tests/project-validation.test.ts`, browser `project-validation.spec.ts`.
- Project package: `tests/projectPackage.test.ts`, `tests/project-service-messages.test.ts`, `tests/slab-package.test.ts`, browser `project-package.spec.ts`.
- RoomPlan: `tests/roomplan-import.test.ts`, browser RoomPlan localization/confirmation specs.
- Duplicate selection: `tests/duplicate-selection.test.ts`; full project duplicate is exercised indirectly in datastore/project-opening/library flows.
- Canvas: many browser interaction/export/selection specs; no single Layout abstraction test exists.
- ThreeViewer: browser viewer framing, invalidation, idle, resources, furniture localization/model specs.
- Custom model package/native return: `tests/custom-model-native-return.test.ts`, package fixtures and browser custom-model package workflows.

No existing test was found for Layout A/B isolation, `activeLayoutId`, legacy furniture-to-Layout migration, or preventing a stale floor furniture mirror from becoming writable.

## 17. Required New Regression Tests

Minimum formal spike coverage:

1. Legacy Project with `Floor.furniture[]` migrates losslessly into one default Layout.
2. Layout A/B furniture arrays remain independent through add, move, resize, rotate, delete, duplicate and lock.
3. Switching Layout does not copy or mutate walls, rooms, doors, windows, columns, background image, or floor geometry.
4. Layout switch renders the selected furniture in Canvas and ThreeViewer.
5. Every furniture writer updates only the active Layout.
6. Undo/Redo of furniture edits cannot change another Layout or restore the wrong Layout's furniture.
7. Save → reload preserves layouts, active layout, IDs, custom model references and furniture order.
8. JSON export → import round-trips all required Layout state and legacy migration.
9. Project package round-trip is tested separately from JSON, including active-layout/native projection rules and custom GLB assets.
10. RoomPlan imported objects enter the default Layout while walls/openings/rooms remain shared structure.
11. Full project duplication produces independent Layout arrays and valid custom model/asset references.
12. Canvas and ThreeViewer both show active Layout furniture; 3D placement writes only there.

## 18. Double-Write Risks

| Current path | Why dangerous | Required future rule | Risk |
|---|---|---|---|
| `project.ts:245 mutate` and all furniture writers | Existing APIs resolve `activeFloor.furniture`; a compatibility floor array could silently become a second writer | One active-layout writer resolver; no writable floor furniture mirror | HIGH |
| Canvas drag/resize/rotate plus `alignment.ts` direct mutation | These paths mutate objects directly and publish the project, bypassing any new Layout-specific API | All mutation paths must resolve the active Layout before touching an item | HIGH |
| `project.ts:948-965 importFloorIntoCurrentProject` | Explicitly merges imported furniture into `existing.furniture` | Import structure and furniture separately; furniture goes to default/active Layout | HIGH |
| RoomPlan `createProjectFromRoomPlan` and `roomplanImport.ts` | Creates and assigns floor furniture before project load | Seed one Layout and never persist a second floor furniture authority | HIGH |
| Package `nativeToWeb`, `applyNativeEdits`, `webToNative` | `plan.furniture`, `web.json` furniture and mapping can diverge from Layout furniture | Define one active-layout/native projection rule and validate mapping against it | HIGH |
| `ThreeViewer.svelte:866 addFurniture` | 3D placement is a second UI writer | Reuse the active-layout writer; renderer may consume composed floor | HIGH |
| Undo restore and version history | Whole-document JSON can restore stale legacy and new arrays together | Migrate/normalize before validation and snapshot only canonical state | HIGH |
| `datastore.ts`, JSON export/reload, library restore | Raw JSON persistence preserves any accidental duplicate authority | Canonicalize before save and reject/strip conflicting legacy state | HIGH |
| `customModels.ts:30` | Direct push into a cloned floor can bypass a new mutation resolver | Return/commit a canonical project with Layout target | MEDIUM/HIGH |
| Full project duplicate | Copies every field, including any stale mirror | Duplicate canonical Layout state only; do not create a second writable copy | MEDIUM |

## 19. Proposed Minimal Implementation Sequence

1. **Canonical schema and migration** — core files: `types.ts`, `projectValidation.ts`; exit when old projects normalize to one canonical Layout source and higher unsupported schema versions are rejected.
2. **Project store active-layout resolver** — core file: `stores/project.ts`; exit when all furniture writers (including direct drag, alignment, custom model placement, and 3D placement) target only the active Layout.
3. **Persistence/import/export normalization** — core files: `datastore.ts`, `localDatabase.ts` only if needed, `projectOpening.ts`, `projectBackup.ts`, package bridge/service, RoomPlan importer; exit when JSON, IndexedDB, RoomPlan, and package paths converge on canonical state.
4. **Derived active-floor adapter** — core files: `project.ts` plus small consumer adapters; exit when Canvas and ThreeViewer can consume active Layout furniture through a non-persisted composed view.
5. **Mutation and history regression coverage** — core files: store tests and focused Canvas/Viewer browser tests; exit when Layout isolation, undo/redo, and switch behavior are proven.
6. **Package/native compatibility decision** — core files: `projectPackageBridge.ts`, `projectPackage.ts`; exit when package round-trip behavior for multiple Layouts is explicitly tested and documented by tests.

## 20. Estimated Change Size

**VERY_LARGE**.

This is not because renderer algorithms need replacement. The mature render loops are adaptable. The size is driven by a cross-cutting change to the persisted document authority, every furniture mutation path, whole-project snapshot history, validation/normalization, JSON and package bridge semantics, RoomPlan and custom-model import, duplicate behavior, and a broad regression matrix. The package bridge adds a second native/web representation and cannot be safely changed by a single renderer adapter.

## 21. Files Likely To Change

Actual spike implementation will likely need at least:

- `src/lib/models/types.ts` — Layout schema/types.
- `src/lib/utils/projectValidation.ts` — one migration/normalization boundary.
- `src/lib/stores/project.ts` — active-layout resolver, writers, history/load behavior.
- `src/lib/utils/alignment.ts` — direct mutation path.
- `src/lib/services/customModels.ts` and `src/lib/components/sidebar/CustomModelPanel.svelte` — custom furniture placement target.
- `src/lib/utils/roomplanImport.ts` — imported furniture seeding.
- `src/lib/stores/versionHistory.ts` — only if migration/history handling requires an explicit canonical boundary; snapshots should otherwise remain whole-project.
- `src/lib/services/projectOpening.ts` / `src/lib/services/datastore.ts` — only where load/save integration needs the canonical migration contract.
- `src/lib/utils/projectBackup.ts` and export helpers — active-layout serialization/render input.
- `src/lib/services/projectPackage.ts` and `src/lib/utils/projectPackageBridge.ts` — package projection and mapping.
- `src/lib/components/editor/FloorPlanCanvas.svelte` — consumer/writer wiring and tests-driven adapter points.
- `src/lib/components/viewer3d/ThreeViewer.svelte` — likely only 3D placement wiring or explicit active-layout selection behavior.
- Relevant existing/new tests under `tests/` and `tests/browser/`.

## 22. Files That Should Stay Untouched

- `src/lib/utils/canvasRenderer.ts` — generic renderer already consumes a `Floor`; preserve it if composed floor keeps the interface.
- `src/lib/utils/hitTesting.ts`, `furnitureGeometry.ts`, `furniturePlanBounds.ts` — geometry helpers should remain data-shape agnostic.
- `src/lib/utils/furnitureModelLoader.ts`, `furnitureModelResources.ts`, GLB parsing/resource files — model loading is not the authority problem.
- Three.js scene construction internals in `ThreeViewer.svelte` — avoid rewriting mature rendering when a composed `furniture[]` view suffices.
- ZIP byte mechanics in `projectPackageZip.ts` — Layout semantics belong in the bridge/service, not the archive codec.
- IndexedDB object-store schema in `localDatabase.ts` — no new table is justified for a JSON document field.
- Unrelated AI, localization, render-lab, and native handoff code.

`FloorPlanCanvas.svelte` and `ThreeViewer.svelte` should be minimized, not treated as untouched by definition: Canvas has real writer/read coupling; ThreeViewer has a real add-furniture writer.

## 23. Open Questions

- Is a Layout project-wide, as proposed, or does each Floor own its Layout variants? Current code is floor-scoped, while the proposed model is project-level.
- Does a native project package carry only the active Layout, all Layouts in `web.json`, or an explicit compatibility projection in `plan.json`?
- Should Layout switching enter undo history? Current floor switching does not.
- Should non-active floors in ThreeViewer stacked mode show a selected/default Layout or structure only?
- Are `stairs`, `columns`, `entourage`, annotations and background image shared structure or Layout-specific in the final product model?
- What is the required behavior for old package files that contain only floor furniture and no Layout metadata?
- Can a composed floor be passed to export APIs, or should exports receive an explicit canonical project plus active-layout selector?

## 24. Recommendation For Next Model / Reasoning Level

Recommended minimum: **Terra Medium**.

The next round is formal cross-cutting implementation, not a local UI edit: schema migration, mutation routing, snapshot semantics, JSON/IndexedDB, RoomPlan, package bridge and regression coverage all interact. A lower tier would be risky for this dependency surface; a higher tier is not required if the implementation remains narrowly scoped.

## 25. Final Answers A–H

### A. Floor.furniture 当前真正的权威写入点是什么？

The current authority is `currentProject`, with the furniture data stored at `Project.floors[].furniture[]`. The main concrete writer is `src/lib/stores/project.ts:245 mutate()`, used by `addFurniture`, `updateFurniture`, `rotateFurniture`, `removeFurniture`, duplicate/reorder and related operations. Direct mutation writers also exist in `moveFurniture`, `transformFurnitureDuringDrag`, `alignment.ts`, custom model placement, RoomPlan construction, package bridge conversion, and ThreeViewer's `addFurniture` caller. So there is one current document authority, but not one exclusive function.

### B. 未来 Layout 是否可以成为唯一 furniture authority？

**YES_WITH_CONDITIONS** — only if all current floor furniture writers are routed to Layout furniture, legacy `Floor.furniture` is migrated/removed from canonical persistence or exposed only as a read-only derived compatibility view, and no composed floor is saved back as a second source.

### C. 是否可以通过 derived/composed activeFloor 尽量避免重写 Canvas / ThreeViewer？

**PARTIALLY**.

- **Canvas:** a composed `activeFloor` can preserve drawing and much hit-testing code, but Canvas has extensive gesture and property writer coupling. Its writers and any direct `currentFloor.furniture` assumptions need a medium-sized adapter.
- **ThreeViewer:** **YES, mostly**. The render loop can continue consuming `furniture[]` from a composed floor. The 3D placement action at `859-869` must route to the active Layout, and stacked-floor semantics need an explicit decision.

### D. 最危险的双写点在哪里？

1. `project.ts` mutation/drag APIs versus any new `Layout.furniture` writer.
2. `importFloorIntoCurrentProject`, RoomPlan import, and package bridge conversions.
3. Canvas direct drag/resize/rotate/alignment mutations.
4. ThreeViewer furniture placement.
5. Whole-project undo/version-history restore and raw JSON/package persistence.

### E. 哪几个文件一定要改？

Minimum true core set:

- `src/lib/models/types.ts`
- `src/lib/utils/projectValidation.ts`
- `src/lib/stores/project.ts`
- `src/lib/utils/roomplanImport.ts`
- `src/lib/utils/projectPackageBridge.ts`
- `src/lib/services/projectPackage.ts`
- `src/lib/services/customModels.ts`

`FloorPlanCanvas.svelte`, `ThreeViewer.svelte`, export helpers, datastore/opening paths, and tests are conditional on preserving the composed-floor interface and the chosen package contract, but must be audited/covered.

### F. 哪几个成熟核心文件应该尽量不改？

Keep `src/lib/utils/canvasRenderer.ts`, geometry/hit-testing/model-loader helpers, `src/lib/utils/projectPackageZip.ts`, and IndexedDB object-store mechanics untouched. Keep the internal rendering portions of `FloorPlanCanvas.svelte` and `ThreeViewer.svelte` unchanged where a composed `Floor` preserves `furniture[]`; only change their unavoidable writer/adapter seams.

### G. Layout spike 预计属于：

**VERY_LARGE** — it changes persisted furniture authority and crosses store mutation, history, validation, persistence, JSON, package/native bridge, RoomPlan, custom models, duplicate behavior, render adapters, and tests. Mature rendering algorithms need not be rewritten, but the data contract is cross-cutting.

### H. 正式编码下一轮最低建议模型 / reasoning level

**Terra Medium** — the lowest recommended reliable tier for the cross-cutting implementation described above.

