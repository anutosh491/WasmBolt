import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'compiler',
    emptyOutDir: false,
    lib: {
      entry: resolve('src/compiler/worker.ts'),
      formats: ['es'],
      fileName: () => 'worker.js'
    },
    minify: 'esbuild'
  }
});
