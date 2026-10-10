export function createClangd(host, diagnostics, state) {
  let worker, loading, ready, generation = 0, nextId = 1, document = null;
  const pending = new Map();
  const written = new Map();
  const send = message => worker.postMessage({ kind: 'lsp', message: { jsonrpc: '2.0', ...message } });
  const notify = (method, params) => send({ method, params });
  function stop(error = new DOMException('clangd stopped', 'AbortError')) {
    generation++;
    ready?.reject(error); ready = null;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear(); worker?.terminate(); worker = null; loading = null; document = null;
    written.clear();
  }
  function fail(error) {
    state('error', error.message);
    stop(error);
  }
  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id); reject(new Error(`${method} timed out`));
      }, 30000);
      pending.set(id, { resolve, reject, timer }); send({ id, method, params });
    });
  }
  function receive({ data }) {
    if (data.kind === 'ready') { ready.resolve(); ready = null; return; }
    if (data.kind === 'error') { fail(new Error(data.message)); return; }
    if (data.kind !== 'lsp') return;
    const message = data.message;
    if (message.method === 'textDocument/clangd.fileStatus') {
      if (message.params.uri === document?.uri)
        state('ready', message.params.state === 'idle' ? '' : 'Parsing headers…', message.params.state);
    } else if (message.method === 'textDocument/publishDiagnostics') {
      if (message.params.uri === document?.uri &&
          (message.params.version === undefined || message.params.version === document.version))
        diagnostics(message.params.diagnostics);
    } else if (message.method && message.id !== undefined) {
      send({ id: message.id, result: null });
    } else if (pending.has(message.id)) {
      const entry = pending.get(message.id); pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    }
  }
  function files(directory) {
    const result = [];
    for (const name of host.FS.readdir(directory)) {
      if (name === '.' || name === '..') continue;
      const path = `${directory}/${name}`;
      if (host.FS.isDir(host.FS.stat(path).mode)) result.push(...files(path));
      else result.push({ path, contents: host.FS.readFile(path) });
    }
    return result;
  }
  async function start() {
    if (loading) return loading;
    const started = generation;
    loading = (async () => {
      if (!crossOriginIsolated) throw new Error('clangd needs cross-origin isolation');
      state('loading', 'Loading clangd…');
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = event => { if (started === generation) receive(event); };
      worker.onerror = error => {
        if (started === generation) fail(new Error(error.message || 'clangd worker failed'));
      };
      const initialized = new Promise((resolve, reject) => { ready = { resolve, reject }; });
      const headers = [...files('/include'), ...files(`${host.resourceDir}/include`)];
      worker.postMessage({ kind: 'start', files: headers }, headers.map(file => file.contents.buffer));
      await initialized;
      await request('initialize', {
        processId: null, rootUri: 'file:///workspace',
        clientInfo: { name: 'WasmBolt' },
        initializationOptions: { clangdFileStatus: true },
        capabilities: {
          general: { positionEncodings: ['utf-16'] },
          offsetEncoding: ['utf-16'],
          textDocument: {
            hover: { contentFormat: ['plaintext'] },
            completion: { completionItem: { snippetSupport: false } },
            publishDiagnostics: { versionSupport: true },
          },
        },
        workspaceFolders: [{ uri: 'file:///workspace', name: 'workspace' }],
      });
      notify('initialized', {}); state('ready', 'clangd ready');
    })();
    try { await loading; } catch (error) {
      if (started === generation) fail(error);
      throw error;
    }
  }
  async function sync() {
    const started = generation;
    const source = host.source();
    if (!['c', 'cpp'].includes(source.language)) {
      if (worker && document) notify('textDocument/didClose', { textDocument: { uri: document.uri } });
      document = null; diagnostics([]); return null;
    }
    await start();
    if (started !== generation) return null;
    // Include other source/header files so cross-file definitions match the workspace.
    const workspace = host.files().filter(path => /\.(c|cc|cpp|cxx|h|hpp)$/.test(path))
      .map(path => ({ path, contents: path === source.path ? source.text : host.FS.readFile(path, { encoding: 'utf8' }) }))
      .filter(file => {
        if (written.get(file.path) === file.contents) return false;
        written.set(file.path, file.contents); return true;
      });
    if (workspace.length) worker.postMessage({ kind: 'write', files: workspace });
    const uri = 'file://' + source.path;
    const command = [source.language === 'c' ? 'clang' : 'clang++',
      `--target=${source.target}`, source.language === 'c' ? '-std=c23' : '-std=c++23',
      '-nostdinc', `-resource-dir=${host.resourceDir}`,
      '-isystem/include/c++/v1', `-isystem${host.resourceDir}/include`,
      '-isystem/include/compat', '-isystem/include', '-c', source.path];
    const configuration = JSON.stringify(command);
    if (document?.configuration !== configuration) {
      notify('workspace/didChangeConfiguration', { settings: { compilationDatabaseChanges: {
        [source.path]: { workingDirectory: '/workspace', compilationCommand: command },
      } } });
    }
    if (document?.uri !== uri) {
      if (document) notify('textDocument/didClose', { textDocument: { uri: document.uri } });
      document = { uri, text: source.text, version: 1, configuration };
      notify('textDocument/didOpen', { textDocument: {
        uri, text: source.text, languageId: source.language, version: 1,
      } });
      diagnostics([]);
    } else if (document.text !== source.text) {
      document.text = source.text; document.version++;
      notify('textDocument/didChange', {
        textDocument: { uri, version: document.version }, contentChanges: [{ text: source.text }],
      });
      diagnostics([]);
    }
    document.configuration = configuration;
    return { uri, text: source.text, path: source.path };
  }
  return { sync, request, stop };
}
