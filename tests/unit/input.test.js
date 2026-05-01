// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setDecimalSeparator,
  getDecimalSeparator,
  formatFloat,
  formatFree,
  parseMyFloat,
  createFloatInput
} from '../../src/ui/component/input.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
const keydown = (el, key) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

function innerInput(wrapper) {
  return wrapper.querySelector('input');
}

function blur(wrapper) {
  fire(innerInput(wrapper), 'blur');
}

function arrowUp(wrapper, times = 1) {
  for (let i = 0; i < times; i++) keydown(innerInput(wrapper), 'ArrowUp');
}

function arrowDown(wrapper, times = 1) {
  for (let i = 0; i < times; i++) keydown(innerInput(wrapper), 'ArrowDown');
}

// Reset separator before each test so tests are independent.
beforeEach(() => setDecimalSeparator('.'));

// ── parseMyFloat ──────────────────────────────────────────────────────────────

describe('parseMyFloat', () => {
  it('parses a number passthrough', () => {
    expect(parseMyFloat(3.14)).toBe(3.14);
  });

  it('parses a dot-separated string', () => {
    expect(parseMyFloat('3.14')).toBe(3.14);
  });

  it('parses a comma-separated string', () => {
    expect(parseMyFloat('3,14')).toBe(3.14);
  });

  it('parses a negative dot string', () => {
    expect(parseMyFloat('-12.5')).toBe(-12.5);
  });

  it('parses a negative comma string', () => {
    expect(parseMyFloat('-12,5')).toBe(-12.5);
  });

  it('returns NaN for non-numeric strings', () => {
    expect(parseMyFloat('abc')).toBeNaN();
  });

  it('parses integer strings', () => {
    expect(parseMyFloat('42')).toBe(42);
  });

  it('handles null-ish by returning NaN', () => {
    expect(parseMyFloat(null)).toBeNaN();
  });
});

// ── setDecimalSeparator / getDecimalSeparator ─────────────────────────────────

describe('setDecimalSeparator / getDecimalSeparator', () => {
  it('defaults to dot', () => {
    expect(getDecimalSeparator()).toBe('.');
  });

  it('can be set to comma', () => {
    setDecimalSeparator(',');
    expect(getDecimalSeparator()).toBe(',');
  });

  it('falls back to dot when given null', () => {
    setDecimalSeparator(null);
    expect(getDecimalSeparator()).toBe('.');
  });

  it('falls back to dot when given undefined', () => {
    setDecimalSeparator(undefined);
    expect(getDecimalSeparator()).toBe('.');
  });
});

// ── formatFloat ───────────────────────────────────────────────────────────────

describe('formatFloat', () => {
  it('formats with dot separator by default', () => {
    expect(formatFloat(12.34, 2)).toBe('12.34');
  });

  it('formats with comma when separator is comma', () => {
    setDecimalSeparator(',');
    expect(formatFloat(12.34, 2)).toBe('12,34');
  });

  it('rounds to the specified decimal count', () => {
    expect(formatFloat(1.23456, 3)).toBe('1.235');
  });

  it('pads with trailing zeros', () => {
    expect(formatFloat(1.5, 3)).toBe('1.500');
  });

  it('formats zero decimals as integer', () => {
    expect(formatFloat(7.9, 0)).toBe('8');
  });

  it('handles negative values', () => {
    expect(formatFloat(-3.5, 1)).toBe('-3.5');
  });

  it('does not double-replace when value has no decimal', () => {
    setDecimalSeparator(',');
    expect(formatFloat(5, 0)).toBe('5');
  });
});

// ── formatFree ────────────────────────────────────────────────────────────────

describe('formatFree', () => {
  it('renders dot separator by default', () => {
    expect(formatFree(1.5)).toBe('1.5');
  });

  it('renders comma separator when set', () => {
    setDecimalSeparator(',');
    expect(formatFree(1.5)).toBe('1,5');
  });

  it('drops trailing zeros', () => {
    expect(formatFree(1.50)).toBe('1.5');
  });

  it('preserves meaningful decimals up to 10 significant digits', () => {
    expect(formatFree(47.1234567)).toBe('47.1234567');
  });

  it('formats integers without decimal point', () => {
    expect(formatFree(42)).toBe('42');
  });

  it('handles negative values', () => {
    setDecimalSeparator(',');
    expect(formatFree(-3.75)).toBe('-3,75');
  });

  it('avoids floating-point noise via toPrecision(10)', () => {
    // 0.1 + 0.2 = 0.30000000000000004 raw; toPrecision(10) → '0.3000000000' → '0.3'
    expect(formatFree(0.1 + 0.2)).toBe('0.3');
  });
});

// ── createFloatInput — structure ──────────────────────────────────────────────

describe('createFloatInput structure', () => {
  it('returns a span.fi-wrap', () => {
    const w = createFloatInput();
    expect(w.tagName).toBe('SPAN');
    expect(w.className).toBe('fi-wrap');
  });

  it('contains an inner input[type=text]', () => {
    const inp = innerInput(createFloatInput());
    expect(inp).not.toBeNull();
    expect(inp.type).toBe('text');
  });

  it('sets inputMode=decimal on the inner input', () => {
    expect(innerInput(createFloatInput()).inputMode).toBe('decimal');
  });

  it('exposes floatValue getter', () => {
    const w = createFloatInput({ value: 5 });
    expect(w.floatValue).toBe(5);
  });

  it('exposes reformat method', () => {
    expect(typeof createFloatInput().reformat).toBe('function');
  });

  it('includes spinner buttons when step > 0 and showSpinner is true', () => {
    const w = createFloatInput({ step: 1, showSpinner: true });
    expect(w.querySelector('.fi-spin')).not.toBeNull();
    expect(w.querySelectorAll('button').length).toBe(2);
  });

  it('omits spinner when showSpinner is false', () => {
    const w = createFloatInput({ step: 1, showSpinner: false });
    expect(w.querySelector('.fi-spin')).toBeNull();
  });

  it('omits spinner when step is 0', () => {
    const w = createFloatInput({ step: 0, showSpinner: true });
    expect(w.querySelector('.fi-spin')).toBeNull();
  });
});

// ── createFloatInput — initial display ───────────────────────────────────────

describe('createFloatInput initial display', () => {
  it('displays the initial value with fixed decimals', () => {
    const w = createFloatInput({ value: 12.34, decimals: 2 });
    expect(innerInput(w).value).toBe('12.34');
  });

  it('displays the initial value with comma when separator is set', () => {
    setDecimalSeparator(',');
    const w = createFloatInput({ value: 12.34, decimals: 2 });
    expect(innerInput(w).value).toBe('12,34');
  });

  it('displays the initial value in free mode', () => {
    const w = createFloatInput({ value: 47.123, decimals: null });
    expect(innerInput(w).value).toBe('47.123');
  });

  it('defaults to value 0 when not given', () => {
    expect(innerInput(createFloatInput({ decimals: 2 })).value).toBe('0.00');
  });
});

// ── createFloatInput — floatValue setter ─────────────────────────────────────

describe('createFloatInput floatValue setter', () => {
  it('updates the displayed value', () => {
    const w = createFloatInput({ value: 1, decimals: 2 });
    w.floatValue = 3.75;
    expect(innerInput(w).value).toBe('3.75');
    expect(w.floatValue).toBe(3.75);
  });

  it('clamps to max via setter', () => {
    const w = createFloatInput({ value: 0, max: 10, decimals: 1 });
    w.floatValue = 99;
    expect(w.floatValue).toBe(10);
  });

  it('clamps to min via setter', () => {
    const w = createFloatInput({ value: 0, min: -5, decimals: 1 });
    w.floatValue = -99;
    expect(w.floatValue).toBe(-5);
  });
});

// ── createFloatInput — reformat ───────────────────────────────────────────────

describe('createFloatInput reformat', () => {
  it('re-displays with comma after separator change', () => {
    const w = createFloatInput({ value: 1.5, decimals: 1 });
    expect(innerInput(w).value).toBe('1.5');
    setDecimalSeparator(',');
    w.reformat();
    expect(innerInput(w).value).toBe('1,5');
  });

  it('re-displays with dot after switching back', () => {
    setDecimalSeparator(',');
    const w = createFloatInput({ value: 3.14, decimals: 2 });
    setDecimalSeparator('.');
    w.reformat();
    expect(innerInput(w).value).toBe('3.14');
  });

  it('does not change floatValue during reformat', () => {
    const w = createFloatInput({ value: 7.5, decimals: 1 });
    setDecimalSeparator(',');
    w.reformat();
    expect(w.floatValue).toBe(7.5);
  });
});

// ── createFloatInput — blur behaviour ────────────────────────────────────────

describe('createFloatInput blur', () => {
  it('normalises a dot input when separator is comma', () => {
    setDecimalSeparator(',');
    const w = createFloatInput({ value: 0, step: 0.01, decimals: 2 });
    innerInput(w).value = '3.14';
    blur(w);
    expect(innerInput(w).value).toBe('3,14');
    expect(w.floatValue).toBe(3.14);
  });

  it('normalises a comma input when separator is dot', () => {
    const w = createFloatInput({ value: 0, step: 0.01, decimals: 2 });
    innerInput(w).value = '3,14';
    blur(w);
    expect(innerInput(w).value).toBe('3.14');
    expect(w.floatValue).toBe(3.14);
  });

  it('clamps to max on blur', () => {
    const w = createFloatInput({ value: 0, max: 10, decimals: 1 });
    innerInput(w).value = '999';
    blur(w);
    expect(w.floatValue).toBe(10);
  });

  it('clamps to min on blur', () => {
    const w = createFloatInput({ value: 0, min: -5, decimals: 1 });
    innerInput(w).value = '-999';
    blur(w);
    expect(w.floatValue).toBe(-5);
  });

  it('reverts to last valid value when input is empty', () => {
    const w = createFloatInput({ value: 3, decimals: 1 });
    innerInput(w).value = '';
    blur(w);
    expect(w.floatValue).toBe(3);
  });

  it('reverts to last valid value when input is non-numeric', () => {
    const w = createFloatInput({ value: 5, decimals: 1 });
    innerInput(w).value = 'abc';
    blur(w);
    expect(w.floatValue).toBe(5);
  });

  it('snaps to nearest step on blur', () => {
    const w = createFloatInput({ value: 0, step: 0.5, decimals: 1 });
    innerInput(w).value = '1.3';
    blur(w);
    expect(w.floatValue).toBe(1.5);
  });

  it('fires a change event on blur', () => {
    const w = createFloatInput({ value: 0, decimals: 1 });
    let fired = false;
    w.addEventListener('change', () => { fired = true; });
    blur(w);
    expect(fired).toBe(true);
  });
});

// ── createFloatInput — arrow keys ────────────────────────────────────────────

describe('createFloatInput arrow keys', () => {
  it('ArrowUp increments by step', () => {
    const w = createFloatInput({ value: 1, step: 0.5, decimals: 1 });
    arrowUp(w);
    expect(w.floatValue).toBe(1.5);
  });

  it('ArrowDown decrements by step', () => {
    const w = createFloatInput({ value: 2, step: 0.5, decimals: 1 });
    arrowDown(w);
    expect(w.floatValue).toBe(1.5);
  });

  it('ArrowUp clamps at max', () => {
    const w = createFloatInput({ value: 9.5, max: 10, step: 1, decimals: 1 });
    arrowUp(w, 5);
    expect(w.floatValue).toBe(10);
  });

  it('ArrowDown clamps at min', () => {
    const w = createFloatInput({ value: -4.5, min: -5, step: 1, decimals: 1 });
    arrowDown(w, 5);
    expect(w.floatValue).toBe(-5);
  });

  it('arrow keys eliminate floating-point noise', () => {
    const w = createFloatInput({ value: 12.36, step: 0.01, decimals: 2 });
    arrowUp(w);
    expect(w.floatValue).toBe(12.37);
    expect(innerInput(w).value).toBe('12.37');
  });

  it('arrow keys use comma separator in display', () => {
    setDecimalSeparator(',');
    const w = createFloatInput({ value: 1, step: 0.5, decimals: 1 });
    arrowUp(w);
    expect(innerInput(w).value).toBe('1,5');
  });

  it('ArrowUp fires input and change events', () => {
    const w = createFloatInput({ value: 0, step: 1, decimals: 0 });
    let inputCount = 0, changeCount = 0;
    w.addEventListener('input',  () => inputCount++);
    w.addEventListener('change', () => changeCount++);
    arrowUp(w);
    expect(inputCount).toBe(1);
    expect(changeCount).toBe(1);
  });

  it('ArrowDown fires input and change events', () => {
    const w = createFloatInput({ value: 0, step: 1, decimals: 0 });
    let count = 0;
    w.addEventListener('input', () => count++);
    arrowDown(w);
    expect(count).toBe(1);
  });

  it('uses step=1 for arrow when step is falsy', () => {
    const w = createFloatInput({ value: 5, step: 0, decimals: 0 });
    arrowUp(w);
    expect(w.floatValue).toBe(6);
  });
});

// ── createFloatInput — clamping / snapping ────────────────────────────────────

describe('createFloatInput clamp and snap', () => {
  it('snaps to nearest step on ArrowUp', () => {
    const w = createFloatInput({ value: 1.3, step: 0.5, decimals: 1 });
    // value 1.3 is not on the 0.5 grid; after snap: 1.5; after +0.5: 2.0
    // Actually snap happens first: snap(1.3 + 0.5) = snap(1.8) = 2.0
    arrowUp(w);
    expect(w.floatValue).toBe(2);
  });

  it('stepDecimals inferred from step string representation', () => {
    const w = createFloatInput({ value: 0, step: 0.001, decimals: 3 });
    arrowUp(w);
    expect(w.floatValue).toBe(0.001);
  });

  it('no snap when step is 0', () => {
    const w = createFloatInput({ value: 1.23456, step: 0 });
    w.floatValue = 1.23456;
    expect(w.floatValue).toBe(1.23456);
  });
});

// ── createFloatInput — free mode ─────────────────────────────────────────────

describe('createFloatInput free mode (decimals: null)', () => {
  it('displays value without trailing zeros', () => {
    const w = createFloatInput({ value: 1.5, decimals: null });
    expect(innerInput(w).value).toBe('1.5');
  });

  it('preserves user-entered precision through blur', () => {
    const w = createFloatInput({ value: 0, step: 0, decimals: null });
    innerInput(w).value = '47.123456';
    blur(w);
    expect(w.floatValue).toBeCloseTo(47.123456, 6);
  });

  it('formats integers without decimal point', () => {
    const w = createFloatInput({ value: 42, decimals: null });
    expect(innerInput(w).value).toBe('42');
  });

  it('uses comma in free mode when separator is comma', () => {
    setDecimalSeparator(',');
    const w = createFloatInput({ value: 3.14, decimals: null });
    expect(innerInput(w).value).toBe('3,14');
  });
});

// ── createFloatInput — restrictInput ─────────────────────────────────────────

describe('createFloatInput restrictInput', () => {
  it('allows digit keys', () => {
    const w = createFloatInput({ restrictInput: true });
    const inp = innerInput(w);
    const e = new KeyboardEvent('keydown', { key: '5', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('blocks letter keys', () => {
    const w = createFloatInput({ restrictInput: true });
    const inp = innerInput(w);
    const e = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('allows the configured separator once', () => {
    const w = createFloatInput({ restrictInput: true });
    const inp = innerInput(w);
    inp.value = '12';
    inp.selectionStart = inp.selectionEnd = 2;
    const e = new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('blocks a second separator', () => {
    const w = createFloatInput({ restrictInput: true });
    const inp = innerInput(w);
    inp.value = '12.3';
    inp.selectionStart = inp.selectionEnd = 4;
    const e = new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('blocks comma when separator is dot', () => {
    const w = createFloatInput({ restrictInput: true });
    const inp = innerInput(w);
    const e = new KeyboardEvent('keydown', { key: ',', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('allows comma when separator is comma', () => {
    setDecimalSeparator(',');
    const w = createFloatInput({ restrictInput: true });
    const inp = innerInput(w);
    inp.value = '12';
    inp.selectionStart = inp.selectionEnd = 2;
    const e = new KeyboardEvent('keydown', { key: ',', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('allows minus at position 0 when min is negative', () => {
    const w = createFloatInput({ min: -10, restrictInput: true });
    const inp = innerInput(w);
    inp.value = '';
    inp.selectionStart = inp.selectionEnd = 0;
    const e = new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('blocks minus when min is non-negative', () => {
    const w = createFloatInput({ min: 0, restrictInput: true });
    const inp = innerInput(w);
    inp.selectionStart = inp.selectionEnd = 0;
    const e = new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('blocks minus when not at position 0', () => {
    const w = createFloatInput({ min: -10, restrictInput: true });
    const inp = innerInput(w);
    inp.value = '5';
    inp.selectionStart = inp.selectionEnd = 1;
    const e = new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('allows Backspace through regardless of restrictInput', () => {
    const w = createFloatInput({ restrictInput: true });
    const inp = innerInput(w);
    const e = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('allows Ctrl+A through', () => {
    const w = createFloatInput({ restrictInput: true });
    const inp = innerInput(w);
    const e = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('does not restrict when restrictInput is false', () => {
    const w = createFloatInput({ restrictInput: false });
    const inp = innerInput(w);
    const e = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});

// ── createFloatInput — placeholder + nullable ───────────────────────────────

describe('createFloatInput placeholder', () => {
  it('sets the inner input placeholder', () => {
    const w = createFloatInput({ placeholder: 'enter value', value: undefined });
    expect(innerInput(w).placeholder).toBe('enter value');
  });

  it('renders empty when value is undefined and placeholder is set', () => {
    const w = createFloatInput({ placeholder: 'enter', value: undefined });
    expect(innerInput(w).value).toBe('');
    expect(w.floatValue).toBe(undefined);
  });

  it('keeps numeric value rendered when placeholder is set but value is given', () => {
    const w = createFloatInput({ placeholder: 'enter', value: 12.5, decimals: 2 });
    expect(innerInput(w).value).toBe('12.50');
    expect(w.floatValue).toBe(12.5);
  });

  it('clears the value on blur when input is empty', () => {
    const w = createFloatInput({ placeholder: 'enter', value: 5, step: 0, decimals: null });
    innerInput(w).value = '';
    blur(w);
    expect(w.floatValue).toBe(undefined);
    expect(innerInput(w).value).toBe('');
  });

  it('parses a typed number on blur when placeholder is set', () => {
    const w = createFloatInput({ placeholder: 'enter', value: undefined, step: 0, decimals: null });
    innerInput(w).value = '7.5';
    blur(w);
    expect(w.floatValue).toBe(7.5);
  });

  it('arrow up from empty starts at 0 and increments by step', () => {
    const w = createFloatInput({ placeholder: 'enter', value: undefined, step: 0.5, decimals: 1 });
    arrowUp(w);
    expect(w.floatValue).toBe(0.5);
  });

  it('floatValue setter accepts undefined when nullable', () => {
    const w = createFloatInput({ placeholder: 'enter', value: 3, decimals: 1 });
    w.floatValue = undefined;
    expect(w.floatValue).toBe(undefined);
    expect(innerInput(w).value).toBe('');
  });

  it('floatValue setter ignores undefined when not nullable (no placeholder)', () => {
    const w = createFloatInput({ value: 3, decimals: 1 });
    w.floatValue = undefined;
    // Without placeholder the widget keeps the previous value.
    expect(w.floatValue).toBe(3);
  });

  it('blur on empty without placeholder reverts to last value (existing contract)', () => {
    const w = createFloatInput({ value: 3, decimals: 1 });
    innerInput(w).value = '';
    blur(w);
    expect(w.floatValue).toBe(3);
  });
});

// ── utils.js display helpers honoring the separator ──────────────────────────

describe('utils.js display helpers', () => {
  // formatDistance and get3DCoordsStr live in utils.js but use formatFloat from
  // input.js — so changing the separator here should flow through them.
  it('formatDistance uses dot by default', async () => {
    const { formatDistance } = await import('../../src/utils/utils.js');
    expect(formatDistance(12.5)).toBe('12.5 m');
  });

  it('formatDistance uses comma when configured', async () => {
    const { formatDistance } = await import('../../src/utils/utils.js');
    setDecimalSeparator(',');
    expect(formatDistance(12.5)).toBe('12,5 m');
  });

  it('formatDistance produces km with the separator above 1000m', async () => {
    const { formatDistance } = await import('../../src/utils/utils.js');
    setDecimalSeparator(',');
    expect(formatDistance(2500)).toBe('2,50 km');
  });

  it('get3DCoordsStr uses configured separator on each component', async () => {
    const { get3DCoordsStr } = await import('../../src/utils/utils.js');
    setDecimalSeparator(',');
    expect(get3DCoordsStr({ x: 1.5, y: 2.5, z: 3.5 })).toBe('(1,500, 2,500, 3,500)');
  });

  it('get3DCoordsStr reverts to dot when separator is reset', async () => {
    const { get3DCoordsStr } = await import('../../src/utils/utils.js');
    setDecimalSeparator('.');
    expect(get3DCoordsStr({ x: 1.5, y: 2.5, z: 3.5 })).toBe('(1.500, 2.500, 3.500)');
  });
});
