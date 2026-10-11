import { compileWasm } from '../../runtime/load-wasm.js';
import { loadSdk } from './sdk.js';

let worker, ready, compiled, sequence = 0;
const pending = new Map();
function request(command, source, compiledModule, sdk) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, command, source, compiledModule, sdk }, sdk ? [sdk.buffer] : []);
  });
}
export function stopSwiftRepl() {
  worker?.terminate(); worker = null; ready = null;
  for (const entry of pending.values()) entry.reject(new Error('Swift REPL stopped'));
  pending.clear();
}
export function startSwiftRepl() {
  return ready ||= (async () => {
    compiled ||= compileWasm(new URL('./wasmbolt-swift-repl.wasm', import.meta.url))
      .catch(error => { compiled = null; throw error; });
    const [module, sdk] = await Promise.all([compiled, loadSdk('repl-modules.tar.gz')]);
    worker = new Worker(new URL('./repl-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data);
    };
    worker.onerror = event => {
      for (const entry of pending.values()) entry.reject(new Error(event.message || 'Swift REPL failed'));
      stopSwiftRepl();
    };
    const result = await request('initialize', undefined, module, sdk);
    if (result.code) throw new Error(result.stderr.join('\n') || 'Could not initialize Swift REPL');
    return result;
  })().catch(error => { stopSwiftRepl(); throw error; });
}
export async function evaluateSwiftRepl(source) {
  await startSwiftRepl();
  return request('cell', source);
}
