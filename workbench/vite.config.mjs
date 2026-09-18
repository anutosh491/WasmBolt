import { cpSync, createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig } from 'vite';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

const serveCompiler = directory => (request, response, next) => {
  const url = new URL(request.url, 'http://localhost');
  const path = resolve(directory, `.${decodeURIComponent(url.pathname)}`);
  if (!path.startsWith(directory + sep)) {
    return next();
  }
  let file;
  try {
    file = statSync(path);
    if (!file.isFile()) {
      return next();
    }
  } catch {
    return next();
  }
  const type = path.endsWith('.js')
    ? 'text/javascript'
    : path.endsWith('.json')
      ? 'application/json'
      : path.endsWith('.wasm')
        ? 'application/wasm'
        : path.endsWith('.tar.gz')
          ? 'application/gzip'
          : 'application/octet-stream';
  response.setHeader('Content-Type', type);
  response.setHeader('Content-Length', file.size);
  response.setHeader('Cache-Control', 'no-cache');
  for (const [name, value] of Object.entries(isolationHeaders)) {
    response.setHeader(name, value);
  }
  createReadStream(path).pipe(response);
};

export default defineConfig(({ mode }) => {
  const output = mode === 'site' ? 'dist/site' : 'dist/standalone';
  return {
    root: 'standalone',
    base: './',
    publicDir: mode === 'site' ? 'public' : false,
    define: {
      'import.meta.env.WASMBOLT_VERSION': JSON.stringify(version)
    },
    server: { headers: isolationHeaders },
    preview: {
      headers: isolationHeaders,
      allowedHosts: ['.serveousercontent.com']
    },
    build: {
      target: 'es2022',
      outDir: `../${output}`,
      emptyOutDir: true
    },
    plugins: [
      mode === 'site' && {
        name: 'wasmbolt-site',
        transformIndexHtml: {
          // Process the site module and version with Vite's HTML pipeline.
          order: 'pre',
          handler: () => [
            {
              tag: 'nav',
              attrs: {
                class: 'wasmbolt-navigation',
                'aria-label': 'WasmBolt links'
              },
              children: readFileSync(
                new URL('./standalone/navigation.html', import.meta.url),
                'utf8'
              ),
              injectTo: 'body-prepend'
            },
            {
              tag: 'script',
              attrs: {
                type: 'module',
                src: '../src/standalone/site.ts'
              },
              injectTo: 'body'
            }
          ]
        }
      },
      {
        name: 'wasmbolt-compiler',
        generateBundle() {
          for (const id of this.getModuleIds()) {
            if (id.includes('/@jupyterlab/')) {
              throw new Error(
                `Jupyter code reached the standalone build: ${id}`
              );
            }
          }
        },
        configureServer(server) {
          const directory = resolve('compiler');
          server.middlewares.use('/compiler', serveCompiler(directory));
        },
        configurePreviewServer(server) {
          const directory = resolve(output, 'compiler');
          server.middlewares.use('/compiler', serveCompiler(directory));
        },
        closeBundle() {
          cpSync(resolve('compiler'), resolve(output, 'compiler'), {
            recursive: true
          });
        }
      }
    ]
  };
});
