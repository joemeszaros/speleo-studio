import { vi, describe, it, expect } from 'vitest';

vi.mock('../../src/i18n/i18n.js', () => ({
  i18n : { t: (key) => key }
}));

const { sanitizeName } = await import('../../src/utils/utils.js');

describe('sanitizeName', () => {
  it('replaces a single double quote with a single quote', () => {
    expect(sanitizeName('a"b')).toBe("a'b");
  });

  it('replaces all double quotes', () => {
    expect(sanitizeName('"foo" "bar"')).toBe("'foo' 'bar'");
  });

  it('leaves names without double quotes unchanged', () => {
    expect(sanitizeName('Cave Name')).toBe('Cave Name');
    expect(sanitizeName("O'Brien")).toBe("O'Brien");
  });

  it('handles empty string', () => {
    expect(sanitizeName('')).toBe('');
  });

  it('passes through non-string values without modification', () => {
    expect(sanitizeName(undefined)).toBe(undefined);
    expect(sanitizeName(null)).toBe(null);
    expect(sanitizeName(42)).toBe(42);
  });
});
