import { describe, it, expect } from 'vitest';
import { SurveyAlias } from '../../src/model/survey.js';

describe('SurveyAlias', () => {

  describe('getEmptyFields', () => {
    it('returns no empty fields when both from and to are set', () => {
      expect(new SurveyAlias('A0', 'B0').getEmptyFields()).toEqual([]);
    });

    it('flags from when it is missing', () => {
      expect(new SurveyAlias(undefined, 'B0').getEmptyFields()).toEqual(['from']);
      expect(new SurveyAlias('', 'B0').getEmptyFields()).toEqual(['from']);
      expect(new SurveyAlias(null, 'B0').getEmptyFields()).toEqual(['from']);
    });

    it('flags to when it is missing', () => {
      expect(new SurveyAlias('A0', undefined).getEmptyFields()).toEqual(['to']);
      expect(new SurveyAlias('A0', '').getEmptyFields()).toEqual(['to']);
      expect(new SurveyAlias('A0', null).getEmptyFields()).toEqual(['to']);
    });

    it('flags both fields when both are missing', () => {
      expect(new SurveyAlias().getEmptyFields()).toEqual(['from', 'to']);
      expect(new SurveyAlias('', '').getEmptyFields()).toEqual(['from', 'to']);
    });
  });

  describe('contains / getPair', () => {
    it('contains matches either endpoint', () => {
      const alias = new SurveyAlias('A0', 'B0');
      expect(alias.contains('A0')).toBe(true);
      expect(alias.contains('B0')).toBe(true);
      expect(alias.contains('C0')).toBe(false);
    });

    it('getPair returns the opposite endpoint, undefined otherwise', () => {
      const alias = new SurveyAlias('A0', 'B0');
      expect(alias.getPair('A0')).toBe('B0');
      expect(alias.getPair('B0')).toBe('A0');
      expect(alias.getPair('C0')).toBeUndefined();
    });
  });

  describe('isEqual', () => {
    it('is direction-sensitive (from/to must match positionally)', () => {
      const a = new SurveyAlias('A0', 'B0');
      expect(a.isEqual(new SurveyAlias('A0', 'B0'))).toBe(true);
      expect(a.isEqual(new SurveyAlias('B0', 'A0'))).toBe(false);
      expect(a.isEqual(new SurveyAlias('A0', 'C0'))).toBe(false);
    });
  });

  describe('toExport / fromPure round-trip', () => {
    it('preserves from and to', () => {
      const alias = new SurveyAlias('A0', 'B0');
      const pure = alias.toExport();
      expect(pure).toEqual({ from: 'A0', to: 'B0' });

      const restored = SurveyAlias.fromPure(pure);
      expect(restored).toBeInstanceOf(SurveyAlias);
      expect(restored.isEqual(alias)).toBe(true);
    });
  });
});
