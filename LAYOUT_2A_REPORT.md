# Phase 4A-2A Report

## Scope

Only Phase 4A-2A was repaired. The frozen authority remains `Project.layouts[].furnitureByFloor[floorId]`; `Floor.furniture` is migration input only.

Runtime used: Node `v20.13.1`, npm `10.5.2`.

## Failure classification and repair

The initial directly affected regression run reported 17 failures. Every failure was Category A: a stale test expectation or setup that treated `Floor.furniture` as canonical/runtime-owned. No Category B production regression was found.

`tests/project-validation.test.ts` — 14 stale failures:

1. `round trips complete geometry, mirrored objects, zero heights/sills, attachments and extension metadata without mutation` — compared migrated legacy Floor furniture with the old input shape.
2. `accepts the shipped Studio Apartment template unchanged` — compared legacy Floor furniture with migrated output.
3. `accepts the shipped 1-Bedroom Apartment template unchanged` — same stale authority assumption.
4. `accepts the shipped 2-Bedroom House template unchanged` — same stale authority assumption.
5. `accepts the shipped Open Concept Home template unchanged` — same stale authority assumption.
6. `accepts the shipped L-Shaped House template unchanged` — same stale authority assumption.
7. `accepts generated iPhone handoff geometry and preserves every floor` — compared legacy Floor furniture with migrated output.
8. `migrates only missing legacy fields and keeps input bytes unchanged` — expected `floor.furniture: []` in canonical output.
9. `allows floor-local repeated IDs, obsolete metadata memberships and legacy active-floor fallback` — compared canonical floors including legacy furniture.
10. `rejects NaN coordinate before changing the input` — mutated/read `floors[0].furniture` instead of the Layout map.
11. `rejects object array before changing the input` — same stale path.
12. `rejects null scale before changing the input` — same stale path.
13. `rejects invalid scale before changing the input` — same stale path.
14. `rejects invalid dimension override before changing the input` — same stale path.

`tests/furniture-interactions.test.ts` — 3 stale failures:

15. `furniture scaling preserves mirror signs and ignores invalid or unchanged values` — setup/read used `Floor.furniture`.
16. `furniture stacking preserves data and treats the existing end position as a history no-op` — setup/assertions used `Floor.furniture`.
17. `a multi-frame mirrored resize is one undo step and keeps its exact final footprint` — setup/assertions used `Floor.furniture`.

Repair was test-only: fixtures now populate `layouts[0].furnitureByFloor[floor.id]`, assertions use canonical Layout-backed data or migrated idempotent output, and undo checks compare whole Project snapshots. No production compatibility write was added.

## Final test results

Command:

```text
npm test -- --run tests/layout-migration.test.ts tests/layout-project-store.test.ts tests/project-validation.test.ts tests/undo-groups.test.ts tests/undo-history-jump.test.ts tests/furniture-interactions.test.ts
```

| File | Passed | Failed |
|---|---:|---:|
| `tests/layout-migration.test.ts` | 3 | 0 |
| `tests/layout-project-store.test.ts` | 3 | 0 |
| `tests/project-validation.test.ts` | 53 | 0 |
| `tests/undo-groups.test.ts` | 3 | 0 |
| `tests/undo-history-jump.test.ts` | 3 | 0 |
| `tests/furniture-interactions.test.ts` | 52 | 0 |
| **Overall** | **117** | **0** |

## Authority audit

- `project.ts` writes furniture only through `Layout.furnitureByFloor`.
- `project.ts` has no runtime write to `Project.floors[*].furniture`.
- `projectValidation.ts` consumes legacy `floor.furniture` only during v0 migration, then removes it.
- `activeFloor.furniture` remains derived compatibility data and is not persisted.
- Layout switching remains non-content history state; undo/redo remains whole-Project snapshot based.

## Artifacts and status

`LAYOUT_2A_DIFF.txt` records the final Phase 4A-2A working-diff scope. `LAYOUT_CHANGE_MAP.md` and `docs/adr-layout-model.md` remain unchanged.

**GO for Phase 4A-2A only. Do not enter Phase 4A-2B.**
