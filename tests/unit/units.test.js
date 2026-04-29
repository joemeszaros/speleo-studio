import { vi, describe, it, expect } from 'vitest';

vi.mock('../../src/i18n/i18n.js', () => ({
  i18n : { t: (key) => key }
}));

const {
  convertLengthFromMeters,
  convertLengthToMeters,
  convertLength,
  convertAngleToDegrees,
  convertAngleFromDegrees,
  convertAngle,
  lengthUnitLabel,
  angleUnitLabel,
  unitsEqual
} = await import('../../src/utils/utils.js');

describe('convertLengthFromMeters', () => {
  it('returns the value unchanged for meters', () => {
    expect(convertLengthFromMeters(10, 'meters')).toBe(10);
  });

  it('converts to feet', () => {
    expect(convertLengthFromMeters(0.3048, 'feet')).toBeCloseTo(1, 6);
    expect(convertLengthFromMeters(3.048, 'feet')).toBeCloseTo(10, 6);
  });

  it('converts to yards', () => {
    expect(convertLengthFromMeters(0.9144, 'yards')).toBeCloseTo(1, 6);
  });

  it('converts to inches', () => {
    expect(convertLengthFromMeters(0.0254, 'inches')).toBeCloseTo(1, 6);
    expect(convertLengthFromMeters(1, 'inches')).toBeCloseTo(39.3700787, 5);
  });

  it('falls back to meters for unknown units', () => {
    expect(convertLengthFromMeters(5, 'unknown')).toBe(5);
  });
});

describe('convertLengthToMeters', () => {
  it('returns the value unchanged for meters', () => {
    expect(convertLengthToMeters(10, 'meters')).toBe(10);
  });

  it('converts feet to meters', () => {
    expect(convertLengthToMeters(1, 'feet')).toBeCloseTo(0.3048, 6);
    expect(convertLengthToMeters(10, 'feet')).toBeCloseTo(3.048, 6);
  });

  it('converts yards to meters', () => {
    expect(convertLengthToMeters(1, 'yards')).toBeCloseTo(0.9144, 6);
  });

  it('converts inches to meters', () => {
    expect(convertLengthToMeters(1, 'inches')).toBeCloseTo(0.0254, 6);
  });
});

describe('convertLength (round-trip and cross-unit)', () => {
  it('returns the same value when fromUnit equals toUnit', () => {
    expect(convertLength(42.5, 'feet', 'feet')).toBe(42.5);
    expect(convertLength(42.5, 'meters', 'meters')).toBe(42.5);
  });

  it('round-trips through meters losslessly', () => {
    expect(convertLength(10, 'feet', 'meters')).toBeCloseTo(3.048, 6);
    expect(convertLength(3.048, 'meters', 'feet')).toBeCloseTo(10, 6);
    expect(convertLength(convertLength(10, 'feet', 'meters'), 'meters', 'feet')).toBeCloseTo(10, 6);
  });

  it('converts feet to yards', () => {
    expect(convertLength(3, 'feet', 'yards')).toBeCloseTo(1, 6);
  });

  it('converts inches to feet', () => {
    expect(convertLength(12, 'inches', 'feet')).toBeCloseTo(1, 6);
  });
});

describe('convertAngleToDegrees', () => {
  it('returns the value unchanged for degrees', () => {
    expect(convertAngleToDegrees(45, 'degrees')).toBe(45);
  });

  it('converts grads to degrees (100 grads = 90 degrees)', () => {
    expect(convertAngleToDegrees(100, 'grads')).toBeCloseTo(90, 6);
    expect(convertAngleToDegrees(400, 'grads')).toBeCloseTo(360, 6);
    expect(convertAngleToDegrees(50, 'grads')).toBeCloseTo(45, 6);
  });
});

describe('convertAngleFromDegrees', () => {
  it('returns the value unchanged for degrees', () => {
    expect(convertAngleFromDegrees(90, 'degrees')).toBe(90);
  });

  it('converts degrees to grads', () => {
    expect(convertAngleFromDegrees(90, 'grads')).toBeCloseTo(100, 6);
    expect(convertAngleFromDegrees(360, 'grads')).toBeCloseTo(400, 6);
    expect(convertAngleFromDegrees(45, 'grads')).toBeCloseTo(50, 6);
  });
});

describe('convertAngle', () => {
  it('returns the same value when units match', () => {
    expect(convertAngle(123.4, 'degrees', 'degrees')).toBe(123.4);
    expect(convertAngle(123.4, 'grads', 'grads')).toBe(123.4);
  });

  it('round-trips through degrees', () => {
    expect(convertAngle(50, 'grads', 'degrees')).toBeCloseTo(45, 6);
    expect(convertAngle(45, 'degrees', 'grads')).toBeCloseTo(50, 6);
    expect(convertAngle(convertAngle(50, 'grads', 'degrees'), 'degrees', 'grads')).toBeCloseTo(50, 6);
  });
});

describe('lengthUnitLabel', () => {
  it('returns short labels for known units', () => {
    expect(lengthUnitLabel('meters')).toBe('m');
    expect(lengthUnitLabel('feet')).toBe('ft');
    expect(lengthUnitLabel('yards')).toBe('yd');
    expect(lengthUnitLabel('inches')).toBe('in');
  });

  it('falls back to meters label for unknown values', () => {
    expect(lengthUnitLabel('unknown')).toBe('m');
    expect(lengthUnitLabel(undefined)).toBe('m');
  });
});

describe('angleUnitLabel', () => {
  it('returns ° for degrees', () => {
    expect(angleUnitLabel('degrees')).toBe('°');
  });

  it('returns gon for grads', () => {
    expect(angleUnitLabel('grads')).toBe('gon');
  });

  it('falls back to degree symbol for unknown', () => {
    expect(angleUnitLabel('unknown')).toBe('°');
  });
});

describe('unitsEqual', () => {
  it('returns true when both length and angle match', () => {
    expect(
      unitsEqual({ length: 'meters', angle: 'degrees' }, { length: 'meters', angle: 'degrees' })
    ).toBe(true);
    expect(unitsEqual({ length: 'feet', angle: 'grads' }, { length: 'feet', angle: 'grads' })).toBe(true);
  });

  it('returns false when length differs', () => {
    expect(
      unitsEqual({ length: 'meters', angle: 'degrees' }, { length: 'feet', angle: 'degrees' })
    ).toBe(false);
  });

  it('returns false when angle differs', () => {
    expect(
      unitsEqual({ length: 'meters', angle: 'degrees' }, { length: 'meters', angle: 'grads' })
    ).toBe(false);
  });

  it('handles undefined inputs gracefully', () => {
    expect(unitsEqual(undefined, undefined)).toBe(true);
    expect(unitsEqual({ length: 'meters', angle: 'degrees' }, undefined)).toBe(false);
  });
});
