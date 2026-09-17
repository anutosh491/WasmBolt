import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'compiler',
    emptyOutDir: false,
    lib: {
      entry: {
        worker: resolve('src/compiler/worker.ts'),
        'tool-worker': resolve('src/compiler/tool-worker.ts'),
        'clangd-worker': resolve('src/clangd/worker.ts'),
        'lldb-worker': resolve('src/lldb/worker.ts'),
        'debug-worker': resolve('src/lldb/debug-worker.ts')
      },
      formats: ['es'],
      fileName: (_, name) => `${name}.js`
    },
    minify: 'esbuild'
  }
});
