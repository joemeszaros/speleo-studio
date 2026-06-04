import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    // Mirror the import map in index.html. Order matters: the more specific `three/addons/`
    // prefix must be tried before the bare `three` alias.
    alias: [
      { find: /^three\/addons\//, replacement: path.resolve(__dirname, 'dependencies/three/addons') + '/' },
      { find: /^three$/, replacement: path.resolve(__dirname, 'dependencies/three/three.module.js') },
    ],
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
  },
});
