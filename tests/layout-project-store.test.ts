import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  activeFloor, addFurniture, createDefaultProject, currentProject, loadProject,
  moveFurniture, removeFurniture, setActiveLayout, undo, updateFurniture,
} from '$lib/stores/project';

const furniture = (id: string, catalogId: string) => ({ id, catalogId, position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } });

function projectWithLayouts() {
  const project = createDefaultProject();
  const floorId = project.floors[0].id;
  project.layouts = [
    { id: 'a', name: 'A', furnitureByFloor: { [floorId]: [furniture('sofa-a', 'sofa')] } },
    { id: 'b', name: 'B', furnitureByFloor: { [floorId]: [furniture('table-b', 'table')] } },
  ];
  project.activeLayoutId = 'a';
  return project;
}

describe('project store Layout authority', () => {
  it('switches composed reads without copying furniture or structure', () => {
    const project = projectWithLayouts(), floorId = project.floors[0].id;
    project.floors[0].walls = [{ id: 'wall', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 10, height: 250 }];
    loadProject(project);
    expect(get(activeFloor)!.furniture.map(item => item.id)).toEqual(['sofa-a']);
    setActiveLayout('b');
    expect(get(activeFloor)!.furniture.map(item => item.id)).toEqual(['table-b']);
    expect(get(currentProject)!.floors[0].id).toBe(floorId);
    expect(get(currentProject)!.layouts[0].furnitureByFloor[floorId]).toHaveLength(1);
  });

  it('routes furniture writers to only the active Layout', () => {
    const project = projectWithLayouts(), floorId = project.floors[0].id;
    loadProject(project);
    moveFurniture('sofa-a', { x: 20, y: 30 });
    updateFurniture('sofa-a', { rotation: 45 });
    const added = addFurniture('chair', { x: 5, y: 5 });
    removeFurniture(added);
    const current = get(currentProject)!;
    expect(current.floors[0]).not.toHaveProperty('furniture');
    expect(current.layouts[0].furnitureByFloor[floorId][0]).toMatchObject({ id: 'sofa-a', position: { x: 20, y: 30 }, rotation: 45 });
    expect(current.layouts[1].furnitureByFloor[floorId]).toEqual([furniture('table-b', 'table')]);
  });

  it('undoes canonical furniture while preserving the current valid Layout', () => {
    const project = projectWithLayouts(), floorId = project.floors[0].id;
    loadProject(project);
    updateFurniture('sofa-a', { rotation: 90 });
    setActiveLayout('b');
    undo();
    const current = get(currentProject)!;
    expect(current.activeLayoutId).toBe('b');
    expect(current.layouts[0].furnitureByFloor[floorId][0].rotation).toBe(0);
    expect(current.layouts[1].furnitureByFloor[floorId][0].id).toBe('table-b');
    expect(JSON.stringify(current.floors)).not.toContain('furniture');
  });
});
