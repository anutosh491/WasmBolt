import { cpSync, createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig } from 'vite';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);

export default defineConfig(({ mode }) => {
  const output = mode === 'site' ? 'dist/site' : 'dist/standalone';
  return {
    root: 'standalone',
    base: './',
    publicDir: mode === 'site' ? 'public' : false,
    define: {
      'import.meta.env.FORTITUDO_VERSION': JSON.stringify(version)
    },
    build: {
      target: 'es2022',
      outDir: `../${output}`,
      emptyOutDir: true
    },
    plugins: [
      mode === 'site' && {
        name: 'fortitudo-site',
        transformIndexHtml: {
          // Process the site module and version with Vite's HTML pipeline.
          order: 'pre',
          handler: () => [
            {
              tag: 'nav',
              attrs: {
                class: 'fortitudo-navigation',
                'aria-label': 'Fortitudo links'
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
        name: 'fortitudo-compiler',
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
          server.middlewares.use('/compiler', (request, response, next) => {
            const url = new URL(request.url, 'http://localhost');
            const path = resolve(
              directory,
              `.${decodeURIComponent(url.pathname)}`
            );
            if (!path.startsWith(directory + sep)) {
              return next();
            }
            try {
              if (!statSync(path).isFile()) {
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
                  : 'application/octet-stream';
            response.setHeader('Content-Type', type);
            createReadStream(path).pipe(response);
          });
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
