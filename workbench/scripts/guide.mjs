import {
  existsSync,
  mkdirSync,
  readFileSync,
  watch,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { marked } from 'marked';

const root = resolve(import.meta.dirname, '..');
const readme = resolve(root, 'README.md');

function write(path, text) {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** The README is the only authored source for both editions of the guide. */
function build() {
  const text = readFileSync(readme, 'utf8');
  const match = text.match(/<!-- guide:start -->([\s\S]*?)<!-- guide:end -->/);
  if (!match || !match[1].trim().startsWith('## ')) {
    throw new Error('README.md must contain a guide with level-two headings.');
  }
  const markdown = match[1].trim();
  const sections = markdown.split(/(?=^## )/m).map(section => {
    const newline = section.indexOf('\n');
    return {
      title: section.slice(3, newline).trim(),
      html: marked.parse(section.slice(newline + 1), { async: false })
    };
  });
  write(
    resolve(root, 'src/generated/guide.ts'),
    '// Generated from README.md by scripts/guide.mjs.\n' +
      `export const sections = ${JSON.stringify(sections, null, 2)} as const;\n`
  );
  write(
    resolve(root, 'lite/files/WasmBolt guide.md'),
    `# WasmBolt guide\n\n${markdown}\n`
  );
}

build();
if (process.argv.includes('--watch')) {
  watch(readme, () => {
    try {
      build();
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
    }
  });
}
