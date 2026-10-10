import { workspaceFiles } from '../../tools/client.js';

let worker, ready, sequence = 0;
const pending = new Map();
function request(command, args, inputs) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, command, args, inputs });
  });
}
export function prepareSwift() {
  return ready ||= (async () => {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
    };
    worker.onerror = event => {
      for (const entry of pending.values()) entry.reject(new Error(event.message || 'Swift Worker failed'));
      pending.clear(); worker.terminate(); ready = null;
    };
    await request('initialize');
  })().catch(error => { worker.terminate(); ready = null; throw error; });
}
export async function runSwift(args, FS) {
  await prepareSwift();
  const inputs = workspaceFiles(FS)
    .filter(path => /\.(swift|h|hpp|inc|o|a|swiftmodule|swiftinterface|rsp|cfg)$/.test(path) ||
      args.some(argument => argument.replace(/^@/, '') === path ||
        argument.replace(/^@/, '') === path.replace(/^\/workspace\//, '')))
    .map(path => ({ path, bytes: FS.readFile(path) }));
  const result = await request('run', args, inputs);
  for (const { path, bytes } of result.files) {
    FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    FS.writeFile(path, bytes);
  }
  return result;
}
