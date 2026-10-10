// Keep compiled code for the page lifetime, independently of debug processes.
let compiledModule = null;
export function preloadDebugger() {
  return compiledModule ||= Promise.all([
    import('./lldb-dap.js'),
    (async () => {
      const response = await fetch(new URL('./lldb-dap.wasm', import.meta.url));
      if (!response.ok) throw new Error(`LLDB download failed (${response.status})`);
      return WebAssembly.compileStreaming(response);
    })(),
  ]).then(([, module]) => module).catch(error => {
    compiledModule = null;
    throw error;
  });
}

/** One LLDB/WAMR session per Worker. Closing releases its pthread pool. */
export class DebuggerClient {
  constructor(onEvent) {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.sequence = 0;
    this.worker.onmessage = ({ data }) => {
      if (this.closed) return;
      if (data.event) { onEvent(data.event, data.body); return; }
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      clearTimeout(entry.timer);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.body);
    };
    this.worker.onerror = event => {
      if (this.closed) return;
      onEvent('fatal', { message: event.message || 'Debugger Worker failed' });
      this.close();
    };
  }

  async request(command, args = {}) {
    if (command === 'start') args = { ...args, compiledModule: await preloadDebugger() };
    if (this.closed) throw new Error('Debugger session closed');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Debugger ${command} timed out`));
      }, command === 'start' ? 180000 : 35000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, command, arguments: args });
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.worker.postMessage({ command: 'close' });
    // Give the owning Worker time to terminate its nested pthread Workers.
    setTimeout(() => this.worker.terminate(), 200);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Debugger session closed'));
    }
    this.pending.clear();
  }
}
