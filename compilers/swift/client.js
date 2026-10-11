import { workspaceFiles } from '../../tools/client.js';

let worker, ready, sequence = 0;
const pending = new Map();
const synchronized = new Map();
const inputFile = path => /\.(swift|h|hpp|inc|o|a|swiftmodule|swiftinterface|swiftdoc|swiftsourceinfo|modulemap|pcm|pch|rsp|cfg)$/.test(path);
const sameBytes = (left, right) => left?.length === right.length &&
  right.every((byte, index) => byte === left[index]);
function request(command, args, inputs, paths) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, command, args, inputs, paths });
  });
}
export function prepareSwift() {
  return ready ||= (async () => {
    synchronized.clear();
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
  const paths = workspaceFiles(FS);
  const outputIndex = args.indexOf('-o');
  const output = outputIndex < 0 ? undefined : args[outputIndex + 1];
  const inputs = paths.filter(path => path !== output &&
      path.replace(/^\/workspace\//, '') !== output &&
      (inputFile(path) || args.some((argument, index) => args[index - 1] !== '-o' &&
        (argument.replace(/^@/, '') === path ||
         argument.replace(/^@/, '') === path.replace(/^\/workspace\//, '')))))
    .map(path => ({ path, bytes: FS.readFile(path) }))
    .filter(({ path, bytes }) => !sameBytes(synchronized.get(path), bytes));
  const result = await request('run', args, inputs, paths);
  for (const { path, bytes } of inputs) synchronized.set(path, bytes);
  for (const path of synchronized.keys()) if (!paths.includes(path)) synchronized.delete(path);
  for (const { path, bytes } of result.files) {
    FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    FS.writeFile(path, bytes);
    if (inputFile(path)) synchronized.set(path, bytes);
  }
  return result;
}
