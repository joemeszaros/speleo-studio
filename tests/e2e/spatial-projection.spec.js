import { test, expect } from '@playwright/test';
import path from 'path';
import { initApp, closeProjectPanel, setupWithProject, dismissNotifications } from './helpers.js';

const fixturesDir = path.resolve('tests/fixtures');

async function importModelSkipCoords(page, fixture) {
  await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, fixture));
  const skipBtn = page.locator('#model-coord-skip');
  await skipBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skipBtn.isVisible()) {
    await skipBtn.click();
  }
  await page.waitForTimeout(2000);
  await dismissNotifications(page);
}

/** Three view buttons (Plan, Profile, 3D) plus the standalone projection toggle. */
const VIEW_BUTTON = { plan: 0, profile: 1, spatial: 2 };

function viewButton(page, index) {
  return page.locator('a[selectGroup="view"]').nth(index);
}
function projectionToggle(page) {
  return page.locator('#projection-toggle');
}

const ORTHO_ICON = 'icons/camera_ortho.svg';
const PERSPECTIVE_ICON = 'icons/camera_perspective.svg';

/**
 * Flip projection through the navbar toggle (UI path). Waits for the button
 * to become enabled first — it's gated on the presence of a 3D model.
 */
async function clickProjectionToggle(page) {
  const toggle = projectionToggle(page);
  await expect(toggle).not.toHaveAttribute('disabled', '');
  await toggle.click();
  await page.waitForTimeout(150);
}

/** Drive projection through the config proxy — bypasses the disabled gate. */
async function setProjectionViaConfig(page, which) {
  await page.evaluate((value) => {
    window.speleo.options.scene.spatialView.projection = value;
  }, which);
  await page.waitForTimeout(150);
}

function readProjectionState(page) {
  return page.evaluate(() => {
    const sv = window.speleo.scene.views.get('spatial');
    return {
      projection           : sv.projection,
      isPerspectiveCamera  : sv.camera.isPerspectiveCamera === true,
      isOrthographicCamera : sv.camera.isOrthographicCamera === true,
      orthoEnabled         : sv.orthoControl.enabled,
      perspectiveEnabled   : sv.perspectiveControl.enabled,
      azimuth              : sv.control.azimuth,
      clino                : sv.control.clino,
      distance             : sv.control.distance,
      orthoZoom            : sv.orthoControl.zoom,
      orthoCameraHeight    : sv.orthoCamera.height,
      perspectiveFov       : sv.perspectiveCamera.fov,
      ratioIndicatorVisible: sv.ratioIndicator.visible,
      ratioTextVisible     : sv.ratioText.sprite.visible
    };
  });
}

async function setup(page) {
  await initApp(page);
  await closeProjectPanel(page);
}

test.describe('Navbar layout: 3 view buttons + projection toggle', () => {

  test('navbar shows 3 view buttons and the projection toggle', async ({ page }) => {
    await setup(page);
    await expect(page.locator('a[selectGroup="view"]')).toHaveCount(3);
    await expect(page.locator('#projection-toggle')).toHaveCount(1);
  });

  test('3D button uses 3d.svg, projection toggle uses the ortho camera icon at startup', async ({ page }) => {
    await setup(page);
    const spatialSrc = await viewButton(page, VIEW_BUTTON.spatial).locator('img.dropbtn').getAttribute('src');
    const projSrc = await projectionToggle(page).locator('img.dropbtn').getAttribute('src');
    expect(spatialSrc).toBe('icons/3d.svg');
    expect(projSrc).toBe(ORTHO_ICON);
  });

  test('projection toggle never carries the selected (green background) class', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.ply');
    const toggle = projectionToggle(page);

    await expect(toggle).not.toHaveClass(/selected/);
    await clickProjectionToggle(page);
    await expect(toggle).not.toHaveClass(/selected/);
    await clickProjectionToggle(page);
    await expect(toggle).not.toHaveClass(/selected/);
  });

  test('clicking the 3D button switches to spatial view and does not touch projection', async ({ page }) => {
    await setup(page);
    // Start on plan view, then hit 3D.
    await viewButton(page, VIEW_BUTTON.plan).click();
    await expect(viewButton(page, VIEW_BUTTON.plan)).toHaveClass(/selected/);

    await viewButton(page, VIEW_BUTTON.spatial).click();
    const state = await readProjectionState(page);
    expect(await page.evaluate(() => window.speleo.scene.view.name)).toBe('spatialView');
    expect(state.projection).toBe('ortho'); // default, unchanged
    await expect(viewButton(page, VIEW_BUTTON.spatial)).toHaveClass(/selected/);
  });

  test('Ctrl+Shift+3 switches to spatial view (preserves projection)', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.ply');
    // Put the scene into perspective, then switch away, then use the shortcut.
    await clickProjectionToggle(page);
    const before = await readProjectionState(page);
    expect(before.projection).toBe('perspective');

    await viewButton(page, VIEW_BUTTON.plan).click();
    await page.keyboard.press('Control+Shift+3');

    const after = await readProjectionState(page);
    expect(await page.evaluate(() => window.speleo.scene.view.name)).toBe('spatialView');
    expect(after.projection).toBe('perspective'); // preserved
    await expect(viewButton(page, VIEW_BUTTON.spatial)).toHaveClass(/selected/);
  });
});

test.describe('Projection toggle button', () => {

  test('is disabled at startup when no 3D model is present', async ({ page }) => {
    await setup(page);
    const toggle = projectionToggle(page);
    await expect(toggle).toHaveAttribute('disabled', '');
    await expect(toggle).toHaveClass(/disabled/);
  });

  test('projection toggle has no keyboard shortcut registered', async ({ page }) => {
    await setup(page);
    const before = await readProjectionState(page);
    const iconBefore = await projectionToggle(page).locator('img.dropbtn').getAttribute('src');
    // Ctrl+Shift+4 is intentionally unbound — pressing it must not affect the toggle.
    await page.keyboard.press('Control+Shift+4');
    await page.waitForTimeout(150);
    const after = await readProjectionState(page);
    const iconAfter = await projectionToggle(page).locator('img.dropbtn').getAttribute('src');
    expect(after.projection).toBe(before.projection);
    expect(iconAfter).toBe(iconBefore);
  });

  test('enables once a 3D model is imported', async ({ page }) => {
    await setupWithProject(page);
    const toggle = projectionToggle(page);
    await expect(toggle).toHaveAttribute('disabled', '');

    await importModelSkipCoords(page, 'sample-model.ply');

    await expect(toggle).not.toHaveAttribute('disabled', '');
    await expect(toggle).not.toHaveClass(/disabled/);
  });

  test('click flips projection and swaps the icon (ortho ↔ perspective)', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.ply');
    const toggle = projectionToggle(page);
    const icon = toggle.locator('img.dropbtn');

    await expect(icon).toHaveAttribute('src', ORTHO_ICON);
    expect((await readProjectionState(page)).projection).toBe('ortho');

    await clickProjectionToggle(page);
    await expect(icon).toHaveAttribute('src', PERSPECTIVE_ICON);
    expect((await readProjectionState(page)).projection).toBe('perspective');

    await clickProjectionToggle(page);
    await expect(icon).toHaveAttribute('src', ORTHO_ICON);
    expect((await readProjectionState(page)).projection).toBe('ortho');
  });

  test('icon reflects saved projection on reload', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.ply');
    await clickProjectionToggle(page); // flip to perspective

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#navbarcontainer .dropbtn')).not.toHaveCount(0);

    const state = await readProjectionState(page);
    expect(state.projection).toBe('perspective');
    // After reload there are no models again, so the toggle is disabled, but
    // the icon still reflects the saved projection mode.
    await expect(projectionToggle(page).locator('img.dropbtn')).toHaveAttribute('src', PERSPECTIVE_ICON);
  });
});

test.describe('Spatial View Projection mechanics', () => {

  test('default projection is orthographic', async ({ page }) => {
    await setup(page);
    const state = await readProjectionState(page);
    expect(state.projection).toBe('ortho');
    expect(state.isOrthographicCamera).toBe(true);
    expect(state.orthoEnabled).toBe(true);
    expect(state.perspectiveEnabled).toBe(false);
  });

  test('setting perspective via config swaps in the perspective camera', async ({ page }) => {
    await setup(page);
    await setProjectionViaConfig(page, 'perspective');

    const state = await readProjectionState(page);
    expect(state.projection).toBe('perspective');
    expect(state.isPerspectiveCamera).toBe(true);
    expect(state.orthoEnabled).toBe(false);
    expect(state.perspectiveEnabled).toBe(true);
  });

  test('camera orientation (azimuth, clino) is preserved across projection swap', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      const sv = window.speleo.scene.views.get('spatial');
      sv.control.setCameraOrientation(sv.control.distance, Math.PI / 3, Math.PI / 6);
    });
    const before = await readProjectionState(page);

    await setProjectionViaConfig(page, 'perspective');
    const afterToPersp = await readProjectionState(page);
    expect(afterToPersp.azimuth).toBeCloseTo(before.azimuth, 5);
    expect(afterToPersp.clino).toBeCloseTo(before.clino, 5);

    await setProjectionViaConfig(page, 'ortho');
    const afterRoundTrip = await readProjectionState(page);
    expect(afterRoundTrip.azimuth).toBeCloseTo(before.azimuth, 5);
    expect(afterRoundTrip.clino).toBeCloseTo(before.clino, 5);
  });

  test('visual scale is preserved when switching ortho → perspective', async ({ page }) => {
    await setup(page);
    const before = await readProjectionState(page);
    const orthoVisibleHeight = before.orthoCameraHeight / before.orthoZoom;

    await setProjectionViaConfig(page, 'perspective');
    const after = await readProjectionState(page);
    const fovRad = (after.perspectiveFov * Math.PI) / 180;
    const perspVisibleHeight = 2 * Math.tan(fovRad / 2) * Math.abs(after.distance);
    expect(perspVisibleHeight).toBeCloseTo(orthoVisibleHeight, 1);
  });

  test('round trip ortho → perspective → ortho restores the zoom level', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      window.speleo.scene.views.get('spatial').orthoControl.setZoomLevel(5);
    });
    const before = await readProjectionState(page);

    await setProjectionViaConfig(page, 'perspective');
    await setProjectionViaConfig(page, 'ortho');
    const after = await readProjectionState(page);
    expect(after.orthoZoom).toBeCloseTo(before.orthoZoom, 1);
  });

  test('ratio bar is hidden in perspective and restored in ortho', async ({ page }) => {
    await setup(page);
    const beforeOrtho = await readProjectionState(page);
    expect(beforeOrtho.ratioIndicatorVisible).toBe(true);
    expect(beforeOrtho.ratioTextVisible).toBe(true);

    await setProjectionViaConfig(page, 'perspective');
    const persp = await readProjectionState(page);
    expect(persp.ratioIndicatorVisible).toBe(false);
    expect(persp.ratioTextVisible).toBe(false);

    await setProjectionViaConfig(page, 'ortho');
    const afterOrtho = await readProjectionState(page);
    expect(afterOrtho.ratioIndicatorVisible).toBe(true);
    expect(afterOrtho.ratioTextVisible).toBe(true);
  });

  test('projection preference persists across page reload', async ({ page }) => {
    await setup(page);
    await setProjectionViaConfig(page, 'perspective');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#navbarcontainer .dropbtn')).not.toHaveCount(0);

    const state = await readProjectionState(page);
    expect(state.projection).toBe('perspective');
  });

  test('wheel dolly in perspective keeps flying forward past the pivot', async ({ page }) => {
    await setup(page);
    await setProjectionViaConfig(page, 'perspective');

    const result = await page.evaluate(() => {
      const sv = window.speleo.scene.views.get('spatial');
      const ctrl = sv.control;
      ctrl.target.set(0, 0, 0);
      ctrl.azimuth = 0;
      ctrl.clino = 0;
      ctrl.distance = 1;
      ctrl.updateCameraPosition();

      const snapshotForward = () => {
        const tmp = sv.camera.position.clone(); // reuse a Vector3; value is overwritten
        sv.camera.getWorldDirection(tmp);
        return { x: tmp.x, y: tmp.y, z: tmp.z };
      };

      const forward0 = snapshotForward();
      const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

      const camPositions = [sv.camera.position.clone()];
      for (let i = 0; i < 60; i++) {
        ctrl.onWheel({ deltaY: -100 });
        camPositions.push(sv.camera.position.clone());
      }

      const forwardFinal = snapshotForward();

      // Accumulated signed displacement along the initial forward axis —
      // must be monotonically non-decreasing (no reversal) and significantly positive.
      let totalForward = 0;
      let minIncrement = Infinity;
      for (let i = 1; i < camPositions.length; i++) {
        const delta = {
          x : camPositions[i].x - camPositions[i - 1].x,
          y : camPositions[i].y - camPositions[i - 1].y,
          z : camPositions[i].z - camPositions[i - 1].z
        };
        const d = dot(delta, forward0);
        totalForward += d;
        if (d < minIncrement) minIncrement = d;
      }

      return {
        finalDistance       : ctrl.distance,
        totalForward,
        minIncrement,
        forwardDirPreserved : dot(forward0, forwardFinal) // ~1 if camera never flipped
      };
    });

    expect(result.finalDistance).toBeGreaterThan(0);
    expect(result.totalForward).toBeGreaterThan(1);
    expect(result.minIncrement).toBeGreaterThanOrEqual(-1e-6); // never reverses
    expect(result.forwardDirPreserved).toBeGreaterThan(0.999); // camera never flipped
  });

  test('external orbit listeners migrate to the new active control', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      const sv = window.speleo.scene.views.get('spatial');
      sv.control.addEventListener('orbitChange', () => {});
    });

    const countExternalListeners = () =>
      page.evaluate(() => {
        const sv = window.speleo.scene.views.get('spatial');
        const count = (ctrl) =>
          (ctrl.listeners?.get('orbitChange') ?? []).filter((l) => l._svInternal !== true).length;
        return { ortho: count(sv.orthoControl), persp: count(sv.perspectiveControl) };
      });

    const before = await countExternalListeners();
    expect(before.ortho).toBeGreaterThanOrEqual(1);
    expect(before.persp).toBe(0);

    await setProjectionViaConfig(page, 'perspective');
    const afterToPersp = await countExternalListeners();
    expect(afterToPersp.persp).toBeGreaterThanOrEqual(1);
    expect(afterToPersp.ortho).toBe(0);

    await setProjectionViaConfig(page, 'ortho');
    const afterRoundTrip = await countExternalListeners();
    expect(afterRoundTrip.ortho).toBeGreaterThanOrEqual(1);
    expect(afterRoundTrip.persp).toBe(0);
  });

  test('fitScreen in perspective leaves a finite positive distance', async ({ page }) => {
    await setup(page);
    await setProjectionViaConfig(page, 'perspective');

    const distance = await page.evaluate(() => {
      const app = window.speleo;
      const sv = app.scene.views.get('spatial');
      const bbox = app.scene.computeBoundingBox?.() ?? null;
      if (!bbox) {
        sv.fitScreen();
        return sv.control.distance;
      }
      sv.fitScreen(bbox);
      return sv.control.distance;
    });

    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeGreaterThan(0);
  });
});
