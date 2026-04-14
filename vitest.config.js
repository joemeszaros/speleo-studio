import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'three': path.resolve(__dirname, 'dependencies/three/three.module.js'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
  },
});
