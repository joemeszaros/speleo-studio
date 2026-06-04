// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// i18n is only used for the panel title — echo the key back.
vi.mock('../../src/i18n/i18n.js', () => ({
  i18n : { t: (key) => key }
}));

const { showErrorPanel, showWarningPanel, showInfoPanel, showSuccessPanel } = await import('../../src/ui/popups.js');

const panel = () => document.getElementById('cautionpanel');
const items = () => [...panel().querySelectorAll('.cautionpanel-item')];
const types = () =>
  items()
    .map((i) => i.dataset.type)
    .sort();

beforeEach(() => {
  vi.useFakeTimers();
  // Clear any panel state left over from a previous test, then start with a fresh container.
  if (window.closeCautionPanel) {
    window.closeCautionPanel();
    vi.runAllTimers();
  }
  document.body.innerHTML = '<div id="cautionpanel" class="cautionpanel" style="display:none"></div>';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('caution panels', () => {
  it('shows error and info notifications at the same time (one item per type)', () => {
    showErrorPanel('boom');
    showInfoPanel('fyi');

    expect(types()).toEqual(['error', 'info']);
    expect(panel().style.display).toBe('flex');
  });

  it('stacks all four notification types together', () => {
    showErrorPanel('e');
    showWarningPanel('w');
    showInfoPanel('i');
    showSuccessPanel('s');
    expect(types()).toEqual(['error', 'info', 'success', 'warning']);
  });

  it('puts the type class on the item (not the container)', () => {
    showSuccessPanel('done');
    const item = items()[0];
    expect(item.classList.contains('cautionpanel-success')).toBe(true);
    expect(panel().classList.contains('cautionpanel-success')).toBe(false);
  });

  it('merges messages of the same type into one item', () => {
    showErrorPanel('first');
    showErrorPanel('second');

    expect(items()).toHaveLength(1);
    const text = items()[0].textContent;
    expect(text).toContain('2 messages');
    expect(text).toContain('first');
    expect(text).toContain('second');
  });

  it('closeCautionPanelType closes one type and leaves the others', () => {
    showErrorPanel('e');
    showInfoPanel('i');

    window.closeCautionPanelType('error');
    vi.advanceTimersByTime(300); // exit animation delay

    expect(types()).toEqual(['info']);
    expect(panel().style.display).toBe('flex');
  });

  it('closeCautionPanel closes everything and hides the container', () => {
    showErrorPanel('e');
    showInfoPanel('i');

    window.closeCautionPanel();
    vi.advanceTimersByTime(300);

    expect(items()).toHaveLength(0);
    expect(panel().style.display).toBe('none');
  });

  it('auto-dismisses a notification after its timeout', () => {
    showSuccessPanel('ok', 5);
    expect(items()).toHaveLength(1);

    vi.advanceTimersByTime(5000); // timeout fires
    vi.advanceTimersByTime(300); // exit animation
    expect(items()).toHaveLength(0);
    expect(panel().style.display).toBe('none');
  });

  it('a new message of an existing type resets that type without touching others', () => {
    showErrorPanel('e', 5);
    showInfoPanel('i');
    // re-trigger error before its timeout — should still be one error item, info untouched
    showErrorPanel('e2');
    expect(types()).toEqual(['error', 'info']);
    const errorItem = items().find((x) => x.dataset.type === 'error');
    expect(errorItem.textContent).toContain('2 messages');
  });
});
