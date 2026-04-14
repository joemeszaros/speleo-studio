import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

/**
 * These tests verify the 4x4 matrix <-> position/rotation/scale conversion
 * used by the models-tree 4x4 Matrix dialog.
 *
 * The compose/decompose logic:
 *   Compose:  (pos, rotDeg, scale) -> Matrix4
 *   Decompose: Matrix4 -> (pos, rotDeg, scale)
 */

function degreesToRads(deg) {
  return deg * (Math.PI / 180.0);
}

function radsToDegrees(rad) {
  return (rad * 180.0) / Math.PI;
}

/**
 * Compose a 4x4 matrix from position, rotation (degrees), and scale.
 * This mirrors the logic in showMatrixDialog().
 */
function composeMatrix(position, rotationDeg, scale) {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(position.x, position.y, position.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(degreesToRads(rotationDeg.x), degreesToRads(rotationDeg.y), degreesToRads(rotationDeg.z))
    ),
    new THREE.Vector3(scale.x, scale.y, scale.z)
  );
  return matrix;
}

/**
 * Decompose a 4x4 matrix into position, rotation (degrees), and scale.
 * This mirrors the logic in applyMatrix().
 */
function decomposeMatrix(matrix) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new THREE.Euler().setFromQuaternion(quaternion);
  return {
    position : { x: position.x, y: position.y, z: position.z },
    rotation : { x: radsToDegrees(euler.x), y: radsToDegrees(euler.y), z: radsToDegrees(euler.z) },
    scale    : { x: scale.x, y: scale.y, z: scale.z }
  };
}

/**
 * Parse a 4x4 matrix string (as typed into the textarea).
 * This mirrors the parsing and validation logic in applyMatrix().
 * @returns {{ matrix: THREE.Matrix4, numbers: number[] } | { error: string }}
 */
function parseMatrixString(text) {
  const numbers = text
    .split(/[\n\r]+/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => line.trim().split(/[\s,;]+/))
    .map(Number);

  if (numbers.length !== 16 || numbers.some(isNaN)) {
    return { error: 'invalid' };
  }

  if (!numbers.every(isFinite)) {
    return { error: 'notFinite' };
  }

  if (numbers[12] !== 0 || numbers[13] !== 0 || numbers[14] !== 0 || numbers[15] !== 1) {
    return { error: 'bottomRow' };
  }

  const matrix = new THREE.Matrix4();
  matrix.set(
    numbers[0], numbers[1], numbers[2], numbers[3],
    numbers[4], numbers[5], numbers[6], numbers[7],
    numbers[8], numbers[9], numbers[10], numbers[11],
    numbers[12], numbers[13], numbers[14], numbers[15]
  );
  return { matrix, numbers };
}

describe('4x4 Matrix Transform', () => {

  describe('identity matrix', () => {
    it('should decompose to zero position, zero rotation, unit scale', () => {
      const matrix = new THREE.Matrix4(); // identity
      const result = decomposeMatrix(matrix);

      expect(result.position.x).toBeCloseTo(0);
      expect(result.position.y).toBeCloseTo(0);
      expect(result.position.z).toBeCloseTo(0);
      expect(result.rotation.x).toBeCloseTo(0);
      expect(result.rotation.y).toBeCloseTo(0);
      expect(result.rotation.z).toBeCloseTo(0);
      expect(result.scale.x).toBeCloseTo(1);
      expect(result.scale.y).toBeCloseTo(1);
      expect(result.scale.z).toBeCloseTo(1);
    });
  });

  describe('translation only', () => {
    it('should compose and decompose a pure translation', () => {
      const pos = { x: 10, y: -20, z: 30.5 };
      const rot = { x: 0, y: 0, z: 0 };
      const scl = { x: 1, y: 1, z: 1 };

      const matrix = composeMatrix(pos, rot, scl);
      const result = decomposeMatrix(matrix);

      expect(result.position.x).toBeCloseTo(10);
      expect(result.position.y).toBeCloseTo(-20);
      expect(result.position.z).toBeCloseTo(30.5);
      expect(result.rotation.x).toBeCloseTo(0);
      expect(result.rotation.y).toBeCloseTo(0);
      expect(result.rotation.z).toBeCloseTo(0);
      expect(result.scale.x).toBeCloseTo(1);
      expect(result.scale.y).toBeCloseTo(1);
      expect(result.scale.z).toBeCloseTo(1);
    });
  });

  describe('rotation only', () => {
    it('should round-trip a 90 degree Z rotation', () => {
      const pos = { x: 0, y: 0, z: 0 };
      const rot = { x: 0, y: 0, z: 90 };
      const scl = { x: 1, y: 1, z: 1 };

      const matrix = composeMatrix(pos, rot, scl);
      const result = decomposeMatrix(matrix);

      expect(result.position.x).toBeCloseTo(0);
      expect(result.position.y).toBeCloseTo(0);
      expect(result.position.z).toBeCloseTo(0);
      expect(result.rotation.x).toBeCloseTo(0);
      expect(result.rotation.y).toBeCloseTo(0);
      expect(result.rotation.z).toBeCloseTo(90);
      expect(result.scale.x).toBeCloseTo(1);
      expect(result.scale.y).toBeCloseTo(1);
      expect(result.scale.z).toBeCloseTo(1);
    });

    it('should round-trip a 45 degree X rotation', () => {
      const pos = { x: 0, y: 0, z: 0 };
      const rot = { x: 45, y: 0, z: 0 };
      const scl = { x: 1, y: 1, z: 1 };

      const matrix = composeMatrix(pos, rot, scl);
      const result = decomposeMatrix(matrix);

      expect(result.rotation.x).toBeCloseTo(45);
      expect(result.rotation.y).toBeCloseTo(0);
      expect(result.rotation.z).toBeCloseTo(0);
    });

    it('should round-trip a combined XYZ rotation', () => {
      const pos = { x: 0, y: 0, z: 0 };
      const rot = { x: 15, y: 30, z: -57.29 };
      const scl = { x: 1, y: 1, z: 1 };

      const matrix = composeMatrix(pos, rot, scl);
      const result = decomposeMatrix(matrix);

      expect(result.rotation.x).toBeCloseTo(15, 1);
      expect(result.rotation.y).toBeCloseTo(30, 1);
      expect(result.rotation.z).toBeCloseTo(-57.29, 1);
    });
  });

  describe('scale only', () => {
    it('should round-trip uniform scale', () => {
      const pos = { x: 0, y: 0, z: 0 };
      const rot = { x: 0, y: 0, z: 0 };
      const scl = { x: 2.5, y: 2.5, z: 2.5 };

      const matrix = composeMatrix(pos, rot, scl);
      const result = decomposeMatrix(matrix);

      expect(result.scale.x).toBeCloseTo(2.5);
      expect(result.scale.y).toBeCloseTo(2.5);
      expect(result.scale.z).toBeCloseTo(2.5);
    });

    it('should round-trip non-uniform scale', () => {
      const pos = { x: 0, y: 0, z: 0 };
      const rot = { x: 0, y: 0, z: 0 };
      const scl = { x: 1, y: 2, z: 0.5 };

      const matrix = composeMatrix(pos, rot, scl);
      const result = decomposeMatrix(matrix);

      expect(result.scale.x).toBeCloseTo(1);
      expect(result.scale.y).toBeCloseTo(2);
      expect(result.scale.z).toBeCloseTo(0.5);
    });
  });

  describe('combined transforms', () => {
    it('should round-trip position + rotation + scale', () => {
      const pos = { x: 10.5, y: -3.2, z: 100 };
      const rot = { x: 15, y: -30, z: 45 };
      const scl = { x: 2, y: 2, z: 2 };

      const matrix = composeMatrix(pos, rot, scl);
      const result = decomposeMatrix(matrix);

      expect(result.position.x).toBeCloseTo(10.5);
      expect(result.position.y).toBeCloseTo(-3.2);
      expect(result.position.z).toBeCloseTo(100);
      expect(result.rotation.x).toBeCloseTo(15, 1);
      expect(result.rotation.y).toBeCloseTo(-30, 1);
      expect(result.rotation.z).toBeCloseTo(45, 1);
      expect(result.scale.x).toBeCloseTo(2);
      expect(result.scale.y).toBeCloseTo(2);
      expect(result.scale.z).toBeCloseTo(2);
    });

    it('should round-trip a CloudCompare-style rotation + translation matrix', () => {
      // 15 degree rotation around Z axis with translation
      const cos15 = Math.cos(degreesToRads(15));
      const sin15 = Math.sin(degreesToRads(15));
      const text = [
        `${cos15} ${-sin15} 0 10.5`,
        `${sin15} ${cos15} 0 -3.2`,
        '0 0 1 0',
        '0 0 0 1'
      ].join('\n');

      const parsed = parseMatrixString(text);
      expect(parsed.error).toBeUndefined();
      const result = decomposeMatrix(parsed.matrix);

      expect(result.position.x).toBeCloseTo(10.5);
      expect(result.position.y).toBeCloseTo(-3.2);
      expect(result.position.z).toBeCloseTo(0);
      expect(result.rotation.x).toBeCloseTo(0);
      expect(result.rotation.y).toBeCloseTo(0);
      expect(result.rotation.z).toBeCloseTo(15, 1);
      expect(result.scale.x).toBeCloseTo(1);
      expect(result.scale.y).toBeCloseTo(1);
      expect(result.scale.z).toBeCloseTo(1);
    });
  });

  describe('matrix string parsing', () => {
    it('should parse space-separated values', () => {
      const parsed = parseMatrixString('1 0 0 5\n0 1 0 10\n0 0 1 15\n0 0 0 1');
      expect(parsed.error).toBeUndefined();
      const result = decomposeMatrix(parsed.matrix);
      expect(result.position.x).toBeCloseTo(5);
      expect(result.position.y).toBeCloseTo(10);
      expect(result.position.z).toBeCloseTo(15);
    });

    it('should parse tab-separated values', () => {
      const parsed = parseMatrixString('1\t0\t0\t5\n0\t1\t0\t10\n0\t0\t1\t15\n0\t0\t0\t1');
      expect(parsed.error).toBeUndefined();
      const result = decomposeMatrix(parsed.matrix);
      expect(result.position.x).toBeCloseTo(5);
    });

    it('should parse comma-separated values', () => {
      const parsed = parseMatrixString('1,0,0,5\n0,1,0,10\n0,0,1,15\n0,0,0,1');
      expect(parsed.error).toBeUndefined();
      const result = decomposeMatrix(parsed.matrix);
      expect(result.position.x).toBeCloseTo(5);
    });

    it('should parse semicolon-separated values', () => {
      const parsed = parseMatrixString('1;0;0;5\n0;1;0;10\n0;0;1;15\n0;0;0;1');
      expect(parsed.error).toBeUndefined();
      const result = decomposeMatrix(parsed.matrix);
      expect(result.position.x).toBeCloseTo(5);
    });

    it('should ignore empty lines', () => {
      const parsed = parseMatrixString('\n1 0 0 5\n\n0 1 0 10\n0 0 1 15\n0 0 0 1\n');
      expect(parsed.error).toBeUndefined();
      const result = decomposeMatrix(parsed.matrix);
      expect(result.position.x).toBeCloseTo(5);
    });

    it('should parse mixed delimiters', () => {
      const parsed = parseMatrixString('1 0,0;5\n0 1 0 10\n0 0 1 15\n0 0 0 1');
      expect(parsed.error).toBeUndefined();
      const result = decomposeMatrix(parsed.matrix);
      expect(result.position.x).toBeCloseTo(5);
    });

    it('should handle extra whitespace around values', () => {
      const parsed = parseMatrixString('  1  0  0  5  \n  0  1  0  10  \n  0  0  1  15  \n  0  0  0  1  ');
      expect(parsed.error).toBeUndefined();
      const result = decomposeMatrix(parsed.matrix);
      expect(result.position.x).toBeCloseTo(5);
    });

    it('should parse negative and decimal numbers', () => {
      const parsed = parseMatrixString('1 0 0 -5.5\n0 1 0 10.123\n0 0 1 0.001\n0 0 0 1');
      expect(parsed.error).toBeUndefined();
      const result = decomposeMatrix(parsed.matrix);
      expect(result.position.x).toBeCloseTo(-5.5);
      expect(result.position.y).toBeCloseTo(10.123);
      expect(result.position.z).toBeCloseTo(0.001);
    });

    it('should parse scientific notation', () => {
      const parsed = parseMatrixString('1 0 0 1e2\n0 1 0 -2.5e1\n0 0 1 3.14e0\n0 0 0 1');
      expect(parsed.error).toBeUndefined();
      const result = decomposeMatrix(parsed.matrix);
      expect(result.position.x).toBeCloseTo(100);
      expect(result.position.y).toBeCloseTo(-25);
      expect(result.position.z).toBeCloseTo(3.14);
    });
  });

  describe('invalid input handling', () => {
    it('should reject empty input', () => {
      expect(parseMatrixString('').error).toBe('invalid');
    });

    it('should reject whitespace-only input', () => {
      expect(parseMatrixString('   \n  \n  ').error).toBe('invalid');
    });

    it('should reject plain text', () => {
      expect(parseMatrixString('not a matrix').error).toBe('invalid');
    });

    it('should reject text mixed with numbers', () => {
      expect(parseMatrixString('1 0 abc 0\n0 1 0 0\n0 0 1 0\n0 0 0 1').error).toBe('invalid');
    });

    it('should reject too few values (3x3 matrix)', () => {
      expect(parseMatrixString('1 0 0\n0 1 0\n0 0 1').error).toBe('invalid');
    });

    it('should reject too many values (5 columns)', () => {
      expect(parseMatrixString('1 0 0 0 0\n0 1 0 0 0\n0 0 1 0 0\n0 0 0 1 0').error).toBe('invalid');
    });

    it('should reject too many rows (5x4)', () => {
      expect(parseMatrixString('1 0 0 0\n0 1 0 0\n0 0 1 0\n0 0 0 1\n0 0 0 0').error).toBe('invalid');
    });

    it('should reject single number', () => {
      expect(parseMatrixString('42').error).toBe('invalid');
    });

    it('should reject Infinity values', () => {
      expect(parseMatrixString('Infinity 0 0 0\n0 1 0 0\n0 0 1 0\n0 0 0 1').error).toBe('notFinite');
    });

    it('should reject -Infinity values', () => {
      expect(parseMatrixString('1 0 0 0\n0 -Infinity 0 0\n0 0 1 0\n0 0 0 1').error).toBe('notFinite');
    });

    it('should reject invalid bottom row [0, 0, 0, 0]', () => {
      expect(parseMatrixString('1 0 0 0\n0 1 0 0\n0 0 1 0\n0 0 0 0').error).toBe('bottomRow');
    });

    it('should reject invalid bottom row [1, 0, 0, 1]', () => {
      expect(parseMatrixString('1 0 0 0\n0 1 0 0\n0 0 1 0\n1 0 0 1').error).toBe('bottomRow');
    });

    it('should reject invalid bottom row [0, 0, 0, 2]', () => {
      expect(parseMatrixString('1 0 0 0\n0 1 0 0\n0 0 1 0\n0 0 0 2').error).toBe('bottomRow');
    });

    it('should reject special characters', () => {
      expect(parseMatrixString('1 0 0 0\n0 1 $ 0\n0 0 1 0\n0 0 0 1').error).toBe('invalid');
    });

    it('should reject matrix with only 15 values', () => {
      expect(parseMatrixString('1 0 0 0\n0 1 0 0\n0 0 1 0\n0 0 0').error).toBe('invalid');
    });

    it('should reject matrix with 17 values', () => {
      expect(parseMatrixString('1 0 0 0\n0 1 0 0\n0 0 1 0\n0 0 0 1 0').error).toBe('invalid');
    });
  });
});
