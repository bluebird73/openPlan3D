import { describe, expect, it } from 'vitest';
import { readProject } from '$lib/utils/projectValidation';
import { createDefaultProject } from '$lib/stores/project';

const item = (id: string, catalogId: string) => ({ id, catalogId, position: { x: 1, y: 2 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, locked: true });

describe('layout schema migration', () => {
  it('migrates legacy floor furniture losslessly and idempotently', () => {
    const raw: any = {
      id: 'legacy', floors: [
        { id: 'floor-1', walls: [], furniture: [item('sofa', 'sofa')] },
        { id: 'floor-2', walls: [], furniture: [item('table', 'table')] },
      ], activeFloorId: 'floor-1',
    };
    const migrated = readProject(raw);
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.layouts).toHaveLength(1);
    expect(migrated.layouts[0]).toMatchObject({ id: 'layout-default', name: 'Default Layout' });
    expect(migrated.activeLayoutId).toBe('layout-default');
    expect(migrated.layouts[0].furnitureByFloor['floor-1'].map(item => item.id)).toEqual(['sofa']);
    expect(migrated.layouts[0].furnitureByFloor['floor-2'].map(item => item.id)).toEqual(['table']);
    expect(migrated.floors.every(floor => !('furniture' in floor))).toBe(true);
    const again = readProject(migrated);
    expect(again).toEqual(migrated);
  });

  it('rejects future schema versions and normalizes invalid active layout deterministically', () => {
    expect(() => readProject({ id: 'future', schemaVersion: 2, floors: [{ id: 'f', walls: [] }] })).toThrow(/newer than the supported version/);
    const project: any = { id: 'canonical', schemaVersion: 1, floors: [{ id: 'f', walls: [] }], layouts: [
      { id: 'a', name: 'A', furnitureByFloor: {} }, { id: 'b', name: 'B', furnitureByFloor: {} },
    ], activeLayoutId: 'missing' };
    expect(readProject(project).activeLayoutId).toBe('a');
  });

  it('creates a canonical default layout for new projects and keeps sparse maps sparse', () => {
    const project = createDefaultProject();
    expect(project).toMatchObject({ schemaVersion: 1, activeLayoutId: 'layout-default' });
    expect(project.layouts).toHaveLength(1);
    expect(project.layouts[0].id).toBe('layout-default');
    expect(project.layouts[0].furnitureByFloor).toEqual({});
    expect(project.floors[0]).not.toHaveProperty('furniture');
    const canonical: any = { ...project, layouts: [{ id: 'layout-default', name: 'Default Layout', furnitureByFloor: {} }] };
    const loaded = readProject(canonical);
    expect(loaded.layouts[0].furnitureByFloor).toEqual({});
  });
});
