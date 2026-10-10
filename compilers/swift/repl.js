import { downloadWasm } from '../../runtime/load-wasm.js';

let worker, ready, binary, sequence = 0;
const pending = new Map();
function request(command, source, wasmBinary) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, command, source, wasmBinary });
  });
}
export function stopSwiftRepl() {
  worker?.terminate(); worker = null; ready = null;
  for (const entry of pending.values()) entry.reject(new Error('Swift REPL stopped'));
  pending.clear();
}
export function startSwiftRepl() {
  return ready ||= (async () => {
    binary ||= downloadWasm(new URL('./wasmbolt-swift-repl.wasm', import.meta.url))
      .catch(error => { binary = null; throw error; });
    const bytes = await binary;
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
    const result = await request('initialize', undefined, bytes);
    if (result.code) throw new Error(result.stderr.join('\n') || 'Could not initialize Swift REPL');
    return result;
  })().catch(error => { stopSwiftRepl(); throw error; });
}
export async function evaluateSwiftRepl(source) {
  await startSwiftRepl();
  return request('cell', source);
}
