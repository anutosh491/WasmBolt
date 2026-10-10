import createModule from './lldb-dap.js';
import { installSdk } from '../../compilers/swift/sdk.js';

const base = new URL('./', import.meta.url);
const pending = new Map();
let module, timer, sequence = 0;
let configured = false, phase = 'starting', bufferedStop = null;

const emit = (event, body = {}) => postMessage({ event, body });
const native = (name, type = 'number', types = [], args = []) =>
  module.ccall(name, type, types, args);
const failure = () => native('wasmbolt_dap_last_error', 'string');

function drain() {
  if (native('wasmbolt_dap_poll_runtime')) throw new Error(failure());
  const count = native('wasmbolt_dap_message_count');
  for (let i = 0; i < count; i++) {
    const message = JSON.parse(native('wasmbolt_dap_pop_message', 'string'));
    if (message.type === 'response') {
      const request = pending.get(message.request_seq);
      if (!request) continue;
      pending.delete(message.request_seq);
      clearTimeout(request.timer);
      if (message.success) request.resolve(message.body || {});
      else request.reject(new Error(message.body?.error?.format || message.message || `${message.command} failed`));
    } else if (message.type === 'event') {
      if (message.event === 'stopped') {
        if (phase === 'exited') continue;
        // Attach produces a synthetic step before user configuration is done.
        if (!configured) {
          if (message.body.reason !== 'step') bufferedStop = message.body;
          continue;
        }
        phase = 'stopped';
      } else if (message.event === 'continued') {
        if (!configured || phase === 'exited') continue;
        phase = 'running';
      } else if (message.event === 'exited') {
        phase = 'exited';
        bufferedStop = null;
      }
      emit(message.event, message.body);
    }
  }
}

function dap(command, arguments_ = {}) {
  const seq = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(seq);
      reject(new Error(`LLDB ${command} timed out`));
    }, 30000);
    pending.set(seq, { resolve, reject, timer: timeout });
    const status = native('wasmbolt_dap_send_json', 'number', ['string'],
      [JSON.stringify({ seq, type: 'request', command, arguments: arguments_ })]);
    if (status) {
      clearTimeout(timeout);
      pending.delete(seq);
      reject(new Error(failure()));
    } else drain();
  });
}

async function start({ files, program, breakpoints, compiledModule, language }) {
  if (module) throw new Error('Restart requires a new debugger Worker');
  emit('loading', { message: 'Starting LLDB session…' });
  module = await createModule({
    noInitialRun: true, noExitRuntime: true,
    mainScriptUrlOrBlob: new URL('lldb-dap.worker.js', base).href,
    locateFile: path => new URL(path, base).href,
    instantiateWasm(imports, receive) {
      const instance = new WebAssembly.Instance(compiledModule, imports);
      receive(instance, compiledModule);
      return instance.exports;
    },
    print: text => emit('output', { category: 'console', output: `${text}\n` }),
    printErr: text => emit('output', { category: 'stderr', output: `${text}\n` }),
    onAbort: text => emit('fatal', { message: String(text) }),
  });
  if (language === 'swift') await installSdk(module.FS);
  for (const { path, bytes } of files) {
    module.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    module.FS.writeFile(path, bytes);
  }
  if (native('wasmbolt_lldb_initialize') || native('wasmbolt_dap_initialize'))
    throw new Error(failure() || 'LLDB initialization failed');
  timer = setInterval(() => {
    try { drain(); } catch (error) { clearInterval(timer); emit('fatal', { message: error.message }); }
  }, 20);
  await dap('initialize', {
    adapterID: 'lldb', clientID: 'wasmbolt', clientName: 'WasmBolt',
    linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true,
  });
  if (native('wasmbolt_dap_prepare_wamr_session', 'number', ['string', 'string', 'string'], [program, '', '[]']))
    throw new Error(failure());
  // Do not await attach: it can finish only after configuration and a stop.
  const attached = dap('attach', {
    program, stopOnEntry: false,
    session: JSON.parse(native('wasmbolt_dap_session_json', 'string')),
    ...(language === 'swift' ? { initCommands: [
      'settings set target.swift-module-search-paths /swift/lib/swift/emscripten',
      'settings set target.sdk-path /',
      'settings set -- target.swift-extra-clang-flags "-resource-dir=/swift/lib/swift/clang -I/include/compat"',
    ] } : {}),
  });
  // Register rejection immediately, while breakpoint requests are in flight.
  attached.catch(() => {});
  for (const { path, lines } of breakpoints) {
    const result = await dap('setBreakpoints', { source: { path }, breakpoints: lines.map(line => ({ line })) });
    emit('breakpoints', { path, breakpoints: result.breakpoints || [] });
  }
  await dap('configurationDone');
  configured = true;
  if (bufferedStop && phase !== 'exited') {
    phase = 'stopped';
    emit('stopped', bufferedStop);
    bufferedStop = null;
  } else if (phase === 'starting') {
    phase = 'running';
    emit('continued');
  }
  await attached;
}

self.onmessage = async ({ data: { id, command, arguments: args } }) => {
  try {
    if (command === 'close') {
      clearInterval(timer);
      module?.PThread?.terminateAllThreads();
      self.close();
      return;
    }
    const body = command === 'start' ? await start(args) : await dap(command, args);
    postMessage({ id, body });
  } catch (error) { postMessage({ id, error: error.message }); }
};
