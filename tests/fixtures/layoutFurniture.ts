import type { Project } from '../../src/lib/models/types';

export function furnitureForFloor(project: Project, floorIndex = 0) {
  const floor = project.floors[floorIndex];
  return project.layouts[0].furnitureByFloor[floor.id] ??= [];
}

export function composedFloor(project: Project, floorIndex = 0) {
  const floor = project.floors[floorIndex];
  return { ...floor, furniture: furnitureForFloor(project, floorIndex) };
}
