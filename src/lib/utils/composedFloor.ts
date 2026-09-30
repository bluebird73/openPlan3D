import type { ComposedFloor, Floor, Project } from '$lib/models/types';

export function composedFloor(project: Project, floor: Floor | undefined = project.floors.find(f => f.id === project.activeFloorId) ?? project.floors[0]): ComposedFloor | undefined {
  if (!floor) return;
  const layout = project.layouts?.find(item => item.id === project.activeLayoutId) ?? project.layouts?.[0];
  return { ...floor, furniture: layout?.furnitureByFloor[floor.id] ?? [] };
}
