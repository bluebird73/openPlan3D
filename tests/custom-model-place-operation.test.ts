import { it, expect } from 'vitest';
import { roomProject } from './fixtures/project';
import { placeCustomModel, removeCustomModel } from '$lib/services/customModels';
import { getFurnitureForFloor } from '$lib/stores/project';

it('places an independently editable model reference and prevents definition removal while in use', () => {
  const project = roomProject();
  project.customModels = [{ id: 'box', name: 'Box', assetName: 'box.glb', sourceFilename: 'Box.glb',
    sha256: 'a'.repeat(64), byteLength: 20, width: 123.5, depth: 67, height: 89 }];
  const before = structuredClone(project);
  const next = placeCustomModel(project, 'box', { x: 20, y: -30 });
  const floorId = next.activeFloorId;
  const item = getFurnitureForFloor(next, floorId).at(-1)!;
  expect(item).toMatchObject({ catalogId: 'custom-model', customModelId: 'box', width: 123.5, depth: 67, height: 89,
    position: { x: 20, y: -30 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } });
  expect(project).toEqual(before);
  expect(() => removeCustomModel(next, 'box')).toThrow('placed furniture');
  const second = placeCustomModel(next, 'box', { x: 0, y: 0 });
  expect(getFurnitureForFloor(second, floorId).at(-1)!.id).not.toBe(item.id);
  expect(next.floors[0]).not.toHaveProperty('furniture');
  expect(() => placeCustomModel(project, 'box', { x: Infinity, y: 0 })).toThrow('supported plan area');
  expect(() => placeCustomModel(project, 'missing', { x: 0, y: 0 })).toThrow('no longer available');
});

it('places and undoes a custom model only in the active Layout', async () => {
  const { createDefaultProject, loadProject, currentProject, commitItemDetails, undo, redo } = await import('$lib/stores/project');
  const { get } = await import('svelte/store');
  const project = createDefaultProject();
  project.layouts.push({ id: 'alt', name: 'Alternate', furnitureByFloor: { [project.activeFloorId]: [] } });
  project.activeLayoutId = 'alt';
  project.customModels = [{ id: 'box', name: 'Box', assetName: 'box.glb', sourceFilename: 'Box.glb', sha256: 'a'.repeat(64), byteLength: 20, width: 10, depth: 20, height: 30 }];
  loadProject(project);
  const expected = get(currentProject)!;
  const placed = placeCustomModel(expected, 'box', { x: 5, y: 6 });
  commitItemDetails(expected, placed, 'Placed custom model');
  expect(get(currentProject)!.layouts[0].furnitureByFloor[project.activeFloorId]).toBeUndefined();
  expect(getFurnitureForFloor(get(currentProject), project.activeFloorId)).toHaveLength(1);
  undo();
  expect(get(currentProject)!.layouts[0].furnitureByFloor[project.activeFloorId]).toBeUndefined();
  expect(get(currentProject)!.layouts[1].furnitureByFloor[project.activeFloorId]).toEqual([]);
  redo();
  expect(get(currentProject)!.layouts[1].furnitureByFloor[project.activeFloorId]).toHaveLength(1);
});
