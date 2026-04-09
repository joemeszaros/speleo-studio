import { vi, describe, it, expect } from 'vitest';

vi.mock('../../src/i18n/i18n.js', () => ({
  i18n : { t: (key) => key }
}));

vi.mock('../../src/model/geo.js', () => ({
  CoordinateSystemType : Object.freeze({ EOV: 'eov', UTM: 'utm' })
}));

const { EOVToWGS84Transformer, UTMConverter, WGS84Converter } = await import('../../src/utils/geo.js');

describe('EOVToWGS84Transformer', () => {

  describe('eovTOwgs84', () => {
    it('should convert Laci cave EOV coordinates to WGS84', () => {
      const [lat, lon] = EOVToWGS84Transformer.eovTOwgs84(644741, 255551);
      expect(lat).toBeCloseTo(47.643785, 5);
      expect(lon).toBeCloseTo(18.977448, 5);
    });

    it('should convert Budapest center EOV to WGS84', () => {
      const [lat, lon] = EOVToWGS84Transformer.eovTOwgs84(650568, 238392);
      expect(lat).toBeCloseTo(47.48947, 4);
      expect(lon).toBeCloseTo(19.05498, 4);
    });
  });

  describe('wgs84TOeov', () => {
    it('should convert Laci cave WGS84 coordinates to EOV', () => {
      const [eovY, eovX] = EOVToWGS84Transformer.wgs84TOeov(47.64378573513598, 18.97744998587031);
      expect(eovY).toBeCloseTo(644741, 0);
      expect(eovX).toBeCloseTo(255551, 0);
    });

    it('should round-trip Laci cave with sub-meter accuracy', () => {
      const originalY = 644741.567;
      const originalX = 255551.123;
      const [lat, lon] = EOVToWGS84Transformer.eovTOwgs84(originalY, originalX);
      const [eovY, eovX] = EOVToWGS84Transformer.wgs84TOeov(lat, lon);
      expect(Math.abs(eovY - originalY)).toBeLessThan(0.001);
      expect(Math.abs(eovX - originalX)).toBeLessThan(0.001);
    });

    it('should round-trip Budapest with sub-meter accuracy', () => {
      const originalY = 650568;
      const originalX = 238392;
      const [lat, lon] = EOVToWGS84Transformer.eovTOwgs84(originalY, originalX);
      const [eovY, eovX] = EOVToWGS84Transformer.wgs84TOeov(lat, lon);
      expect(Math.abs(eovY - originalY)).toBeLessThan(0.001);
      expect(Math.abs(eovX - originalX)).toBeLessThan(0.001);
    });

    it('should round-trip coordinates near the edge of EOV range', () => {
      // Eastern Hungary area
      const originalY = 800000;
      const originalX = 100000;
      const [lat, lon] = EOVToWGS84Transformer.eovTOwgs84(originalY, originalX);
      const [eovY, eovX] = EOVToWGS84Transformer.wgs84TOeov(lat, lon);
      expect(Math.abs(eovY - originalY)).toBeLessThan(0.001);
      expect(Math.abs(eovX - originalX)).toBeLessThan(0.001);
    });

    it('should throw RangeError for latitude below EOV range', () => {
      expect(() => EOVToWGS84Transformer.wgs84TOeov(44.0, 19.0)).toThrow(RangeError);
    });

    it('should throw RangeError for latitude above EOV range', () => {
      expect(() => EOVToWGS84Transformer.wgs84TOeov(50.0, 19.0)).toThrow(RangeError);
    });

    it('should throw RangeError for longitude below EOV range', () => {
      expect(() => EOVToWGS84Transformer.wgs84TOeov(47.5, 15.0)).toThrow(RangeError);
    });

    it('should throw RangeError for longitude above EOV range', () => {
      expect(() => EOVToWGS84Transformer.wgs84TOeov(47.5, 24.0)).toThrow(RangeError);
    });
  });
});

describe('UTMConverter', () => {

  describe('fromLatLon', () => {
    it('should convert Budapest WGS84 to UTM zone 34', () => {
      const result = UTMConverter.fromLatLon(47.497, 19.04);
      expect(result.zoneNum).toBe(34);
      expect(result.zoneLetter).toBe('T');
      expect(result.easting).toBeCloseTo(352380, 0);
      expect(result.northing).toBeCloseTo(5262258, 0);
    });

    it('should convert Derenk WGS84 to UTM zone 34', () => {
      const result = UTMConverter.fromLatLon(48.53987, 20.63889);
      expect(result.zoneNum).toBe(34);
      expect(result.zoneLetter).toBe('U');
      expect(result.easting).toBeCloseTo(473345.084, 1);
      expect(result.northing).toBeCloseTo(5376370.314, 1);
    });

    // Reference values from independent online UTM converters:
    // https://www.latlong.net/lat-long-utm.html
    // https://coordinates-converter.com
    it('should convert 47.4979, 19.04016 to UTM 34T with sub-meter accuracy', () => {
      const result = UTMConverter.fromLatLon(47.4979, 19.04016);
      expect(result.zoneNum).toBe(34);
      expect(result.zoneLetter).toBe('T');
      expect(result.easting).toBeCloseTo(352394.313, 0);
      expect(result.northing).toBeCloseTo(5262357.872, 0);
    });

    it('should produce easting 500000 at equator on central meridian', () => {
      // Zone 37 central meridian is at 39°E = (37-1)*6 - 180 + 3
      const result = UTMConverter.fromLatLon(0.0, 39.0);
      expect(result.zoneNum).toBe(37);
      expect(Math.abs(result.easting - 500000)).toBeLessThan(1);
      expect(result.northing).toBeLessThan(1);
    });
  });

  describe('toLatLon', () => {
    it('should convert UTM back to WGS84', () => {
      const { easting, northing, zoneNum } = UTMConverter.fromLatLon(47.497, 19.04);
      const result = UTMConverter.toLatLon(easting, northing, zoneNum, undefined, true);
      expect(result.latitude).toBeCloseTo(47.497, 5);
      expect(result.longitude).toBeCloseTo(19.04, 5);
    });
  });

  describe('round-trip', () => {
    const testPoints = [
      { name: 'Budapest', lat: 47.497, lon: 19.04 },
      { name: 'Equator', lat: 0.5, lon: 37.5 },
      { name: 'Southern hemisphere', lat: -33.856, lon: 151.215 },
      { name: 'High latitude', lat: 78.23, lon: 15.63 }
    ];

    testPoints.forEach(({ name, lat, lon }) => {
      it(`should round-trip ${name} with sub-meter accuracy`, () => {
        const utm = UTMConverter.fromLatLon(lat, lon);
        const result = UTMConverter.toLatLon(utm.easting, utm.northing, utm.zoneNum, undefined, lat >= 0);
        expect(result.latitude).toBeCloseTo(lat, 5);
        expect(result.longitude).toBeCloseTo(lon, 5);
      });
    });
  });
});

describe('WGS84Converter', () => {

  describe('fromLatLon with EOV', () => {
    it('should convert WGS84 to EOV via the unified API', () => {
      const coordinateSystem = { type: 'eov' };
      const result = WGS84Converter.fromLatLon(47.64378573513598, 18.97744998587031, coordinateSystem);
      expect(result.y).toBeCloseTo(644741, 0);
      expect(result.x).toBeCloseTo(255551, 0);
    });
  });

  describe('fromLatLon with UTM', () => {
    it('should convert WGS84 to UTM via the unified API', () => {
      const coordinateSystem = { type: 'utm' };
      const result = WGS84Converter.fromLatLon(47.497, 19.04, coordinateSystem);
      expect(result.easting).toBeDefined();
      expect(result.northing).toBeDefined();
      expect(result.zoneNum).toBe(34);
    });
  });
});
