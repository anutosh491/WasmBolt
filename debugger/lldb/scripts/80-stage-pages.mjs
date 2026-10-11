// Retain the debugger's staging command while sharing the Pages packager.
import { fileURLToPath } from 'node:url';
process.argv[2] ||= fileURLToPath(new URL('../../../site', import.meta.url));
process.argv[3] ||= fileURLToPath(new URL('../.work/pages', import.meta.url));
await import('../../../scripts/package-pages.mjs');
