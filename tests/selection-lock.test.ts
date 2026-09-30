import { expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createDefaultProject, loadProject, currentProject, toggleSelectionLock, undo, redo, activeFloor } from '$lib/stores/project';

it('locks mixed furniture/entourage together and restores all flags with one undo', () => {
  const project=createDefaultProject(),floor=project.floors[0];
  project.layouts[0].furnitureByFloor[floor.id]=[{id:'f',catalogId:'sofa',position:{x:0,y:0},rotation:0,scale:{x:1,y:1,z:1},locked:true}];
  floor.entourage=[{id:'e',defId:'person',position:{x:100,y:0},rotation:0,width:50},
    {id:'unselected',defId:'person',position:{x:200,y:0},rotation:0,width:50}];
  loadProject(project); const before=structuredClone(get(currentProject)!.floors[0]);
  toggleSelectionLock(new Set(['f','e']));
  expect(get(activeFloor)!.furniture[0].locked).toBe(true);
  expect(get(currentProject)!.floors[0].entourage![0].locked).toBe(true);
  expect(get(currentProject)!.floors[0].entourage![1].locked).toBeUndefined();
  toggleSelectionLock(new Set(['missing']));
  undo();expect(get(currentProject)!.floors[0]).toEqual(before);
  redo();
  toggleSelectionLock(new Set(['f','e']));
  expect(get(activeFloor)!.furniture[0].locked).toBe(false);
  expect(get(currentProject)!.floors[0].entourage![0].locked).toBe(false);
  undo();expect(get(currentProject)!.floors[0].entourage![0].locked).toBe(true);
});
