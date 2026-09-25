import { test, expect } from '@playwright/test';
import {
  initApp,
  closeProjectPanel,
  dismissNotifications,
  windowPanel,
  expectDocumentNotScrollable,
  openTestWindow
} from './helpers.js';

const KEY = 'test.window';
const OTHER_KEY = 'test.other';

async function setup({ page }) {
  await initApp(page);
  await closeProjectPanel(page);
  await dismissNotifications(page);
}

/** Geometry as the window manager itself reports it. */
function geometryOf(page, key) {
  return page.evaluate((k) => window.__testWindows[k].getGeometry(), key);
}

function storedGeometry(page, key) {
  return page.evaluate((k) => {
    const stored = window.speleo.options.ui.windows[k];
    return stored === undefined ? null : JSON.parse(JSON.stringify(stored));
  }, key);
}

/** Drive a real pointer gesture from one point to another. */
async function dragBy(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several steps so the rAF throttled move handler actually runs.
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
}

async function centreOf(locator) {
  const box = await locator.boundingBox();
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

test.describe('window chrome', () => {
  test.beforeEach(setup);

  test('opens inside the window layer with dialog semantics', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, title: 'Hello window', variant: 'editor' });

    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/popup--editor/);
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(panel.locator('.popup-header')).toContainText('Hello window');

    const parentId = await panel.evaluate((el) => el.parentElement.id);
    expect(parentId).toBe('window-layer');
  });

  test('close and minimize are real buttons with accessible names', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, variant: 'editor' });

    const close = panel.locator('button.close');
    const minimize = panel.locator('button.minimize');
    await expect(close).toHaveAttribute('aria-label', /.+/);
    await expect(minimize).toHaveAttribute('aria-label', /.+/);

    // Reachable and operable from the keyboard.
    await close.focus();
    await expect(close).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel).toHaveCount(0);
  });

  test('the close button removes the window from the DOM', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, variant: 'editor' });
    await panel.locator('button.close').click();
    await expect(panel).toHaveCount(0);
  });

  test('Ctrl+W closes the active window', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, variant: 'editor' });
    await page.keyboard.press('Control+w');
    await expect(panel).toHaveCount(0);
  });
});

test.describe('dragging and resizing', () => {
  test.beforeEach(setup);

  test('dragging the title bar moves the window', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, variant: 'editor', defaultSize: { width: 500, height: 320 } });
    const before = await geometryOf(page, KEY);

    await dragBy(page, await centreOf(panel.locator('.popup-header')), -80, 60);

    const after = await geometryOf(page, KEY);
    expect(after.x).toBe(before.x - 80);
    expect(after.y).toBe(before.y + 60);
    expect(after.w).toBe(before.w);
    expect(after.h).toBe(before.h);
  });

  test('the south-east handle resizes without moving the origin', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, variant: 'editor', defaultSize: { width: 500, height: 320 } });
    const before = await geometryOf(page, KEY);

    await dragBy(page, await centreOf(panel.locator('.popup-resizer--se')), 90, 50);

    const after = await geometryOf(page, KEY);
    expect(after.w).toBe(before.w + 90);
    expect(after.h).toBe(before.h + 50);
    expect(after.x).toBe(before.x);
  });

  test('the north-west handle keeps the opposite corner pinned', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, variant: 'editor', defaultSize: { width: 500, height: 320 } });
    const before = await geometryOf(page, KEY);

    await dragBy(page, await centreOf(panel.locator('.popup-resizer--nw')), 40, 30);

    const after = await geometryOf(page, KEY);
    expect(after.x + after.w).toBe(before.x + before.w);
    expect(after.y + after.h).toBe(before.y + before.h);
    expect(after.w).toBe(before.w - 40);
    expect(after.h).toBe(before.h - 30);
  });

  // The regression this subsystem was rewritten for: the old manager persisted the running
  // totals of its resize loop, which were still zero when a handle was pressed and released
  // without moving, and wrote that 0/0 straight into the config.
  test('pressing a resize handle without moving changes nothing', async ({ page }) => {
    const panel = await openTestWindow(page, {
      key             : KEY,
      variant         : 'editor',
      defaultSize     : { width: 500, height: 320 },
      persistGeometry : true
    });
    const before = await geometryOf(page, KEY);

    const handle = await centreOf(panel.locator('.popup-resizer--se'));
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.up();

    expect(await geometryOf(page, KEY)).toEqual(before);

    const stored = await storedGeometry(page, KEY);
    expect(stored.w).toBe(before.w);
    expect(stored.h).toBe(before.h);
    expect(stored.w).toBeGreaterThan(0);
    expect(stored.h).toBeGreaterThan(0);
  });

  test('a window cannot be dragged over the navbar or under the footer', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, variant: 'editor', defaultSize: { width: 400, height: 260 } });
    const header = panel.locator('.popup-header');

    await dragBy(page, await centreOf(header), 0, -2000);
    const navbarBottom = await page.locator('.topnavbar').evaluate((el) => el.getBoundingClientRect().bottom);
    expect((await geometryOf(page, KEY)).y).toBeGreaterThanOrEqual(Math.round(navbarBottom));

    await dragBy(page, await centreOf(header), 0, 2000);
    const footerTop = await page.locator('#footer').evaluate((el) => el.getBoundingClientRect().top);
    expect((await geometryOf(page, KEY)).y).toBeLessThanOrEqual(Math.round(footerTop));

    await expectDocumentNotScrollable(page);
  });
});

test.describe('minimize', () => {
  test.beforeEach(setup);

  test('collapses onto the title bar and restores', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, variant: 'editor', defaultSize: { width: 500, height: 320 } });
    const minimize = panel.locator('button.minimize');
    const headerHeight = (await panel.locator('.popup-header').boundingBox()).height;

    await minimize.click();
    await expect(panel).toHaveClass(/minimized/);
    await expect(panel.locator('.popup-content-div')).toBeHidden();
    await expect(minimize).toHaveAttribute('aria-expanded', 'false');
    expect((await panel.boundingBox()).height).toBeLessThan(headerHeight + 16);

    await minimize.click();
    await expect(panel).not.toHaveClass(/minimized/);
    await expect(panel.locator('.popup-content-div')).toBeVisible();
    expect((await geometryOf(page, KEY)).h).toBe(320);
  });

  // The old manager kept the minimized flag in a map it never cleared on close, so a window
  // closed while minimized came back believing it still was and silently refused to resize.
  test('a window closed while minimized reopens resizable', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, variant: 'editor', defaultSize: { width: 500, height: 320 } });
    await panel.locator('button.minimize').click();
    await panel.locator('button.close').click();
    await expect(panel).toHaveCount(0);

    const reopened = await openTestWindow(page, {
      key         : KEY,
      variant     : 'editor',
      defaultSize : { width: 500, height: 320 }
    });
    await expect(reopened).not.toHaveClass(/minimized/);
    await expect(reopened.locator('.popup-resizer--se')).toBeVisible();

    const before = await geometryOf(page, KEY);
    await dragBy(page, await centreOf(reopened.locator('.popup-resizer--se')), 60, 40);
    const after = await geometryOf(page, KEY);
    expect(after.w).toBe(before.w + 60);
    expect(after.h).toBe(before.h + 40);
  });
});

test.describe('stacking', () => {
  test.beforeEach(setup);

  test('several windows stay open at once and clicking raises one', async ({ page }) => {
    const first = await openTestWindow(page, { key: KEY, variant: 'editor', defaultSize: { width: 400, height: 260 } });
    const second = await openTestWindow(page, {
      key         : OTHER_KEY,
      variant     : 'editor',
      defaultSize : { width: 400, height: 260 }
    });

    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    await expect(second).toHaveClass(/active/);

    // Move the second one aside so the first is clickable.
    await dragBy(page, await centreOf(second.locator('.popup-header')), 220, 120);

    await first.locator('.popup-header').click();
    await expect(first).toHaveClass(/active/);
    await expect(second).not.toHaveClass(/active/);

    const [firstZ, secondZ] = await Promise.all([
      first.evaluate((el) => Number(el.style.zIndex)),
      second.evaluate((el) => Number(el.style.zIndex))
    ]);
    expect(firstZ).toBeGreaterThan(secondZ);
  });

  test('two windows of the same kind coexist when given different instance ids', async ({ page }) => {
    await openTestWindow(page, { key: KEY, instanceId: 'one', title: 'One', variant: 'editor' });
    await openTestWindow(page, { key: KEY, instanceId: 'two', title: 'Two', variant: 'editor' });

    await expect(windowPanel(page, KEY)).toHaveCount(2);
  });
});

test.describe('geometry persistence', () => {
  test.beforeEach(setup);

  test('remembers size and position across a close and reopen', async ({ page }) => {
    const panel = await openTestWindow(page, {
      key             : KEY,
      variant         : 'editor',
      defaultSize     : { width: 450, height: 300 },
      persistGeometry : true
    });
    await dragBy(page, await centreOf(panel.locator('.popup-resizer--se')), 70, 50);
    await dragBy(page, await centreOf(panel.locator('.popup-header')), -40, 30);
    const before = await geometryOf(page, KEY);

    await panel.locator('button.close').click();
    await openTestWindow(page, {
      key             : KEY,
      variant         : 'editor',
      defaultSize     : { width: 450, height: 300 },
      persistGeometry : true
    });

    expect(await geometryOf(page, KEY)).toEqual(before);
  });

  test('refits an oversized remembered window into a smaller viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const panel = await openTestWindow(page, {
      key             : KEY,
      variant         : 'editor',
      defaultSize     : { width: 900, height: 600 },
      persistGeometry : true
    });
    await panel.locator('button.close').click();

    await page.setViewportSize({ width: 800, height: 600 });
    await openTestWindow(page, {
      key             : KEY,
      variant         : 'editor',
      defaultSize     : { width: 900, height: 600 },
      persistGeometry : true
    });

    const bounds = await page.evaluate(async () => {
      const { getUsableBounds } = await import('/src/ui/window/viewport-bounds.js');
      return getUsableBounds();
    });
    const geometry = await geometryOf(page, KEY);

    expect(geometry.w).toBeLessThanOrEqual(bounds.right - bounds.left);
    expect(geometry.h).toBeLessThanOrEqual(bounds.bottom - bounds.top);
    expect(geometry.y).toBeGreaterThanOrEqual(bounds.top);
    await expectDocumentNotScrollable(page);
  });

  test('resizing the viewport pulls an open window back inside it', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openTestWindow(page, { key: KEY, variant: 'editor', defaultSize: { width: 900, height: 600 } });

    await page.setViewportSize({ width: 700, height: 520 });
    await page.waitForFunction(
      () => window.__testWindows['test.window'].getGeometry().w <= window.innerWidth,
      undefined,
      { timeout: 5000 }
    );

    await expectDocumentNotScrollable(page);
  });
});

test.describe('viewport safety', () => {
  test.beforeEach(setup);

  // A window asking for far more room than exists, holding content far larger than itself: the
  // exact shape that used to enlarge the document and push the application out of sight.
  test('an absurdly oversized window cannot make the document scrollable', async ({ page }) => {
    await openTestWindow(page, {
      key         : KEY,
      variant     : 'editor',
      defaultSize : { width: 99999, height: 99999 },
      contentHtml : '<div style="width:5000px;height:5000px">very large content</div>'
    });

    const bounds = await page.evaluate(async () => {
      const { getUsableBounds } = await import('/src/ui/window/viewport-bounds.js');
      return getUsableBounds();
    });
    const geometry = await geometryOf(page, KEY);
    expect(geometry.w).toBe(bounds.right - bounds.left);
    expect(geometry.h).toBe(bounds.bottom - bounds.top);

    await expectDocumentNotScrollable(page);
  });

  test('a window is positioned relative to the viewport, not the document', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, variant: 'editor' });
    await expect(panel).toHaveCSS('position', 'fixed');
  });
});

test.describe('lifecycle', () => {
  test.beforeEach(setup);

  test('opening and closing repeatedly leaves no document listeners behind', async ({ page }) => {
    const counts = await page.evaluate(async () => {
      const { Window } = await import('/src/ui/window/window.js');
      const tally = { added: 0, removed: 0 };
      const add = document.addEventListener.bind(document);
      const remove = document.removeEventListener.bind(document);
      document.addEventListener = (...args) => {
        tally.added++;
        return add(...args);
      };
      document.removeEventListener = (...args) => {
        tally.removed++;
        return remove(...args);
      };

      for (let i = 0; i < 10; i++) {
        const win = new Window({ key: 'test.leak', title: () => `Leak ${i}`, variant: 'editor' });
        win.open((content) => {
          content.innerHTML = '<p>content</p>';
        });
        win.close();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }

      document.addEventListener = add;
      document.removeEventListener = remove;
      return tally;
    });

    expect(counts.added).toBeGreaterThan(0);
    expect(counts.removed).toBe(counts.added);
    await expect(page.locator('.popup[data-window-key="test.leak"]')).toHaveCount(0);
  });

  test('closing twice is harmless', async ({ page }) => {
    await openTestWindow(page, { key: KEY, variant: 'editor' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.evaluate(() => {
      window.__testWindows['test.window'].close();
      window.__testWindows['test.window'].close();
    });

    expect(errors).toEqual([]);
    await expect(windowPanel(page, KEY)).toHaveCount(0);
  });
});

test.describe('window menu', () => {
  test.beforeEach(setup);

  const windowMenu = (page) => page.locator('.mydropdown').filter({ has: page.locator('button.dropbtn', { hasText: 'Window' }) });

  async function openWindowMenu(page) {
    const menu = windowMenu(page);
    await menu.locator('button.dropbtn').click();
    return menu.locator('.mydropdown-content');
  }

  test('says so when nothing is open', async ({ page }) => {
    const content = await openWindowMenu(page);
    await expect(content.locator('a').first()).toHaveAttribute('disabled', '');
    await expect(content.locator('a', { hasText: 'Close all windows' })).toHaveAttribute('disabled', '');
  });

  test('lists the open windows and marks the active one', async ({ page }) => {
    await openTestWindow(page, { key: KEY, title: 'First window', variant: 'editor' });
    await openTestWindow(page, { key: OTHER_KEY, title: 'Second window', variant: 'editor' });

    const content = await openWindowMenu(page);
    await expect(content.locator('a', { hasText: 'First window' })).toHaveCount(1);
    const second = content.locator('a', { hasText: 'Second window' });
    await expect(second).toHaveCount(1);
    // The last one opened is on top, so it is the one shown as current.
    await expect(second).toHaveClass(/selected/);
  });

  test('picking a window raises it', async ({ page }) => {
    const first = await openTestWindow(page, { key: KEY, title: 'First window', variant: 'editor' });
    const second = await openTestWindow(page, { key: OTHER_KEY, title: 'Second window', variant: 'editor' });
    await expect(second).toHaveClass(/active/);

    const content = await openWindowMenu(page);
    await content.locator('a', { hasText: 'First window' }).click();

    await expect(first).toHaveClass(/active/);
    const [firstZ, secondZ] = await Promise.all([
      first.evaluate((el) => Number(el.style.zIndex)),
      second.evaluate((el) => Number(el.style.zIndex))
    ]);
    expect(firstZ).toBeGreaterThan(secondZ);
  });

  test('the list follows what is actually open', async ({ page }) => {
    await openTestWindow(page, { key: KEY, title: 'First window', variant: 'editor' });
    await openTestWindow(page, { key: OTHER_KEY, title: 'Second window', variant: 'editor' });

    await windowPanel(page, OTHER_KEY).locator('button.close').click();

    const content = await openWindowMenu(page);
    await expect(content.locator('a', { hasText: 'Second window' })).toHaveCount(0);
    await expect(content.locator('a', { hasText: 'First window' })).toHaveCount(1);
  });

  test('close all windows closes them all', async ({ page }) => {
    await openTestWindow(page, { key: KEY, title: 'First window', variant: 'editor' });
    await openTestWindow(page, { key: OTHER_KEY, title: 'Second window', variant: 'editor' });

    const content = await openWindowMenu(page);
    await content.locator('a', { hasText: 'Close all windows' }).click();

    await expect(page.locator('.popup[data-window-key]')).toHaveCount(0);
  });

  // The navbar is a flex item with a z-index of its own, so its dropdowns could not rise above
  // the window layer and open windows covered them.
  test('the menu opens in front of the windows', async ({ page }) => {
    const panel = await openTestWindow(page, { key: KEY, variant: 'editor', defaultSize: { width: 600, height: 400 } });
    // park the window right under the navbar so the dropdown lands on top of it
    await panel.evaluate((el) => {
      el.style.left = '60px';
      el.style.top = '50px';
    });

    const content = await openWindowMenu(page);
    const box = await content.boundingBox();
    const winner = await page.evaluate(
      ([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit.closest('.mydropdown-content') ? 'menu' : hit.closest('.popup') ? 'window' : 'other';
      },
      [Math.round(box.x + box.width / 2), Math.round(box.y + box.height - 5)]
    );
    expect(winner).toBe('menu');
  });
});
