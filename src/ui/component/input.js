/*
 * Copyright 2026 Joe Meszaros
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// ── Decimal separator state ────────────────────────────────────────────────────

let _decimalSeparator = '.';

export function setDecimalSeparator(sep) {
  _decimalSeparator = sep ?? '.';
}

export function getDecimalSeparator() {
  return _decimalSeparator;
}

// ── Number formatting ──────────────────────────────────────────────────────────

/** Format a number with a fixed number of decimal places, using the configured separator. */
export function formatFloat(value, decimals) {
  const str = value.toFixed(decimals);
  return _decimalSeparator === '.' ? str : str.replace('.', _decimalSeparator);
}

/** Format a number with natural precision (no trailing zeros), using the configured separator. */
export function formatFree(value) {
  const s = String(parseFloat(value.toPrecision(10)));
  return _decimalSeparator === '.' ? s : s.replace('.', _decimalSeparator);
}

// ── Parsing ────────────────────────────────────────────────────────────────────

/** Parse a float from a string or number, accepting both '.' and ',' as decimal separator. */
export function parseMyFloat(strOrNum) {
  if (typeof strOrNum === 'number') return parseFloat(strOrNum);
  if (typeof strOrNum === 'string') return parseFloat(strOrNum.replace(',', '.'));
  return parseFloat(strOrNum);
}

// ── createFloatInput ───────────────────────────────────────────────────────────

/**
 * Create a float input widget.
 *
 * Returns a wrapper <span class="fi-wrap"> containing a <input type="text"> and
 * an optional spinner column, behaving like <input type="number"> but using the
 * app's configured decimal separator (setDecimalSeparator / formatFloat above).
 *
 * Options:
 *   value        – initial numeric value (default 0)
 *   min          – minimum allowed value (default: none)
 *   max          – maximum allowed value (default: none)
 *   step         – arrow-key / spinner increment (default 1; 0 or falsy = no snapping)
 *   decimals     – fixed decimal places for display; null/undefined = free (user controls)
 *   restrictInput – true: block non-numeric keystrokes and filter paste (default false)
 *   showSpinner  – true (default): show up/down spinner on focus when step > 0
 *
 * Public API on the returned wrapper element:
 *   wrapper.floatValue          – get/set the current numeric value
 *   wrapper.reformat()          – re-display with current separator (call after setDecimalSeparator)
 *   wrapper.querySelector('input') – the inner <input> element
 *
 * Events bubble from the inner input through the wrapper:
 *   'change'  – on blur and on arrow-key / spinner step
 *   'input'   – on arrow-key / spinner step
 */
export function createFloatInput({
  value,
  min,
  max,
  step = 1,
  decimals = null,
  restrictInput = false,
  showSpinner = true,
  placeholder = '',
  nullable
} = {}) {

  // ── Inner input ──────────────────────────────────────────────────────────────
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  if (placeholder) input.placeholder = placeholder;

  // When "nullable", empty input is a valid state and floatValue can be undefined;
  // backspace / delete to clear the field works. Without it we keep the original
  // contract — an empty / invalid input reverts to the previous numeric value on
  // blur, and a missing initial value defaults to 0. Nullable defaults to true
  // whenever a placeholder is configured (since a placeholder implies "optional").
  if (nullable === undefined) nullable = !!placeholder;
  const isEmpty = (v) => v === undefined || v === null;

  const freeMode = decimals === null || decimals === undefined;
  let current = isEmpty(value) ? (nullable ? undefined : 0) : value;

  const clamp = (v) => {
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    return v;
  };

  // Infer decimal places from step to eliminate floating-point noise (e.g. 0.01 → 2).
  const stepDecimals = step > 0 ? (String(step).split('.')[1] ?? '').length : 0;
  const snap = step > 0 ? (v) => parseFloat((Math.round(v / step) * step).toFixed(stepDecimals)) : (v) => v;

  const fmt = (v) => (freeMode ? formatFree(v) : formatFloat(v, decimals));
  const apply = (v) => {
    current = v;
    input.value = v === undefined || v === null ? '' : fmt(v);
  };

  apply(current);

  // ── Arrow keys: increment / decrement ────────────────────────────────────────
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      // If the widget is empty (nullable + no current value), start stepping from 0.
      const base = current === undefined || current === null ? 0 : current;
      apply(clamp(snap(base + (e.key === 'ArrowUp' ? 1 : -1) * (step || 1))));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (!restrictInput) return;

    // Pass through control/navigation keys and modifier combos.
    if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) return;

    const sep = _decimalSeparator;
    if (/\d/.test(e.key)) return;

    if (e.key === sep) {
      const remaining = input.value.slice(0, input.selectionStart) + input.value.slice(input.selectionEnd);
      if (!remaining.includes(sep)) return; // won't create a duplicate
    }

    if (e.key === '-' && input.selectionStart === 0 && !input.value.startsWith('-') && (min === undefined || min < 0))
      return;

    e.preventDefault();
  });

  // ── Paste filter (restrictInput only) ─────────────────────────────────────────
  if (restrictInput) {
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const sep = _decimalSeparator;
      const other = sep === '.' ? ',' : '.';
      let clean = (e.clipboardData || window.clipboardData).getData('text').replace(other, sep);
      const neg = clean.startsWith('-') && (min === undefined || min < 0);
      clean = clean.replace(sep === '.' ? /[^0-9.]/g : /[^0-9,]/g, '');
      const parts = clean.split(sep);
      if (parts.length > 2) clean = parts[0] + sep + parts.slice(1).join('');
      if (neg) clean = '-' + clean;
      const s = input.selectionStart;
      const en = input.selectionEnd;
      input.value = input.value.slice(0, s) + clean + input.value.slice(en);
    });
  }

  // ── Blur: parse → clamp → snap → re-display ───────────────────────────────────
  input.addEventListener('blur', () => {
    if (nullable && input.value.trim() === '') {
      apply(undefined);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const parsed = parseMyFloat(input.value);
    apply(isNaN(parsed) ? current : clamp(snap(parsed)));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // ── Wrapper ──────────────────────────────────────────────────────────────────
  const wrapper = document.createElement('span');
  wrapper.className = 'fi-wrap';
  wrapper.appendChild(input);

  // ── Spinner (shown on :focus-within via CSS, only when step > 0 and showSpinner) ─
  if (step > 0 && showSpinner) {
    const spin = document.createElement('span');
    spin.className = 'fi-spin';

    const makeBtn = (dir) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = dir > 0 ? 'fi-up' : 'fi-dn';

      let timeoutId, intervalId;

      const step_once = () => {
        apply(clamp(snap(current + dir * step)));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const stop = () => {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
      };

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus on inner input
        step_once();
        timeoutId = setTimeout(() => {
          intervalId = setInterval(step_once, 60);
        }, 400);
      });
      btn.addEventListener('mouseup', stop);
      btn.addEventListener('mouseleave', stop);

      return btn;
    };

    spin.appendChild(makeBtn(+1));
    spin.appendChild(makeBtn(-1));
    wrapper.appendChild(spin);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  Object.defineProperty(wrapper, 'floatValue', {
    get : () => current,
    set : (v) => apply(v === undefined || v === null ? (nullable ? undefined : current) : clamp(v))
  });

  wrapper.reformat = () => apply(current);

  return wrapper;
}
