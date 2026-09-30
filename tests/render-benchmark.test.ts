import { expect, it } from 'vitest';
import { benchmarkProject, benchmarkSizes, type BenchmarkSize } from './fixtures/render-benchmark';
import { readProject } from '$lib/utils/projectValidation';
import { detectRooms } from '$lib/utils/roomDetection';
import { furnitureForFloor } from './fixtures/layoutFurniture';

for (const size of Object.keys(benchmarkSizes) as BenchmarkSize[]) it(`${size} benchmark has stable connected geometry and valid local imports`, () => {
  const project = benchmarkProject(size), { side, floors } = benchmarkSizes[size];
  expect(JSON.stringify(project)).toBe(JSON.stringify(benchmarkProject(size)));
  const imported = readProject(project);
  expect(imported.floors).toHaveLength(floors);
  for (const floor of imported.floors) {
    expect(detectRooms(floor.walls)).toHaveLength(side * side);
    expect(floor.walls).toHaveLength(2 * side * (side + 1));
    const furniture = furnitureForFloor(imported, imported.floors.indexOf(floor));
    expect(furniture).toHaveLength(side * side * 6);
    expect(new Set([...floor.walls, ...furniture, ...floor.rooms, ...floor.doors, ...floor.windows].map(item => item.id)).size).toBe(floor.walls.length + furniture.length + floor.rooms.length + floor.doors.length + floor.windows.length);
  }
});
