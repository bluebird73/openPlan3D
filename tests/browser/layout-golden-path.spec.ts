import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { savedProjects } from './storage';

test.setTimeout(300_000);

test('staging Layouts remain isolated through 3D, save/reopen, and export', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door'])));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: /Use a Template/ }).click();
  await page.getByRole('button', { name: /Studio Apartment/ }).click();
  await expect(page.getByRole('application')).toContainText('rooms');

  const layoutPicker = page.getByRole('combobox', { name: 'Current Layout', exact: true });
  await expect(layoutPicker).toHaveValue('layout-default');
  const initialProject = Object.values(await savedProjects(page))[0] as any;
  expect(initialProject.floors[0].walls.length).toBeGreaterThan(0);
  const initialFurnitureCount = initialProject.layouts[0].furnitureByFloor[initialProject.activeFloorId]?.length ?? 0;
  const canvas = page.getByLabel('Floor plan editor canvas', { exact: true });
  const placeCatalogItem = async (name: RegExp, offset: number) => {
    await page.getByRole('button', { name: 'Objects', exact: true }).click();
    await page.getByRole('button', { name }).first().click();
    const bounds = (await canvas.boundingBox())!;
    await canvas.click({ position: { x: bounds.width * (0.45 + offset), y: bounds.height * 0.52 } });
    await page.keyboard.press('Escape');
  };
  await placeCatalogItem(/Sofa/, 0);
  await placeCatalogItem(/Armchair/, 0.08);
  await expect.poll(async () => {
    const project = Object.values(await savedProjects(page))[0] as any;
    return project?.layouts[0].furnitureByFloor[project.activeFloorId]?.length ?? 0;
  }).toBe(initialFurnitureCount + 2);

  await page.getByRole('button', { name: 'Create Layout', exact: true }).click();
  await expect(layoutPicker).toHaveValue(/.+/);
  const layoutB = await layoutPicker.inputValue();
  expect(layoutB).not.toBe('layout-default');
  await expect(page.getByRole('button', { name: 'Create Layout', exact: true })).toBeVisible();
  await placeCatalogItem(/Dining Chair/, 0.16);
  await expect.poll(async () => {
    const project = Object.values(await savedProjects(page))[0] as any;
    return project?.layouts.find((layout: any) => layout.id === layoutB)?.furnitureByFloor[project.activeFloorId]?.length ?? 0;
  }).toBe(1);

  await layoutPicker.selectOption('layout-default');
  await expect.poll(async () => {
    const project = Object.values(await savedProjects(page))[0] as any;
    return project?.activeLayoutId;
  }).toBe('layout-default');
  await layoutPicker.selectOption(layoutB);
  await expect.poll(async () => {
    const project = Object.values(await savedProjects(page))[0] as any;
    return project?.activeLayoutId;
  }).toBe(layoutB);

  const panel = page.getByRole('region', { name: 'My 3D models', exact: true });
  await panel.locator('input[type=file]').setInputFiles('tests/fixtures/local-model-textured-box.glb');
  const dialog = page.getByRole('dialog', { name: 'Import GLB model', exact: true });
  await expect(dialog.locator('canvas')).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Add to project', exact: true }).click();
  await panel.getByRole('button', { name: 'Place at view center', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => {
    const project = Object.values(await savedProjects(page))[0] as any;
    return project?.layouts.find((layout: any) => layout.id === layoutB)?.furnitureByFloor[project.activeFloorId]?.some((item: any) => item.customModelId);
  }).toBe(true);

  await page.getByRole('button', { name: '3D', exact: true }).click();

  const viewer = page.getByRole('region', { name: '3D floor plan viewer', exact: true });
  await expect(viewer.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  const sceneCanvas = viewer.locator('canvas[data-plan3d-canvas="true"]');
  await expect(sceneCanvas).toHaveAttribute('data-rendered', 'true');

  const settle3D = () => page.evaluate(() =>
    new Promise<void>(resolve =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve())
      )
    )
  );

  const exportProxyScene = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Blender Scene', exact: true }).click();

    const download = await pending;
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('Render scene download has no local path.');

    const scene = JSON.parse(await readFile(downloadPath, 'utf8'));

    return scene.meshes
      .filter((mesh: any) => mesh.material === 'proxy')
      .map((mesh: any) => ({
        vertices: mesh.vertices,
        faces: mesh.faces,
      }));
  };

  await settle3D();

  const proxyB = await exportProxyScene();
  expect(proxyB.length).toBeGreaterThan(0);

  await layoutPicker.selectOption('layout-default');
  await expect.poll(async () => {
    const project = Object.values(await savedProjects(page))[0] as any;
    return project?.activeLayoutId;
  }).toBe('layout-default');
  await settle3D();

  const proxyA = await exportProxyScene();
  expect(proxyA.length).toBeGreaterThan(0);
  expect(proxyA).not.toEqual(proxyB);

  await layoutPicker.selectOption(layoutB);
  await expect.poll(async () => {
    const project = Object.values(await savedProjects(page))[0] as any;
    return project?.activeLayoutId;
  }).toBe(layoutB);
  await settle3D();

  const proxyB2 = await exportProxyScene();
  expect(proxyB2.length).toBeGreaterThan(0);
  expect(proxyB2).not.toEqual(proxyA);
  await testInfo.attach('active-layout-viewer', { body: await viewer.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = Object.values(await savedProjects(page))[0] as any;
  const floorsBefore = JSON.stringify(saved.floors);
  await page.reload();
  await expect(layoutPicker).toHaveValue(layoutB);
  const reopened = Object.values(await savedProjects(page))[0] as any;
  expect(JSON.stringify(reopened.floors)).toBe(floorsBefore);
  expect(reopened.activeLayoutId).toBe(layoutB);
  expect(reopened.layouts.find((layout: any) => layout.id === 'layout-default').furnitureByFloor[reopened.activeFloorId]).toHaveLength(initialFurnitureCount + 2);
  const reopenedB = reopened.layouts.find((layout: any) => layout.id === layoutB).furnitureByFloor[reopened.activeFloorId];
  expect(reopenedB).toHaveLength(2);
  expect(reopenedB.some((item: any) => item.customModelId)).toBe(true);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pngPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export 3D as PNG', exact: true }).click();
  expect((await pngPending).suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pdfPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  expect((await pdfPending).suggestedFilename()).toMatch(/\.pdf$/);
  expect(errors).toEqual([]);
});
