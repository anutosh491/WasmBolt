import { isClangdOutput } from './protocol';
import type { JsonRpcId, JsonRpcMessage } from './protocol';
import type {
  ClangdLanguage,
  ClangdOptions,
  CompletionContext,
  CompletionItem,
  CompletionList,
  Diagnostic,
  Diagnostics,
  IClangdClient,
  IClangdWorker,
  Position
} from './types';

const workspaceUri = 'file:///workspace';

type Pending = Readonly<{
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}>;

type Document = {
  path: string;
  uri: string;
  language: ClangdLanguage;
  contents: string;
  version: number;
  generation: number;
};

type Lifetime = { interruption: Error | null };

function projectPath(value: string): string {
  if (
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid project-relative path: ${value}`);
  }
  return value;
}

function documentUri(path: string): string {
  const encoded = projectPath(path)
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  return `${workspaceUri}/${encoded}`;
}

function language(path: string, requested?: ClangdLanguage): ClangdLanguage {
  if (requested) {
    return requested;
  }
  const extension = path.split('.').at(-1)?.toLowerCase();
  if (extension === 'c') {
    return 'c';
  }
  if (
    ['cc', 'cpp', 'cxx', 'c++', 'h', 'hh', 'hpp', 'hxx'].includes(
      extension ?? ''
    )
  ) {
    return 'cpp';
  }
  throw new Error('clangd supports only C and C++ documents.');
}

function completionList(value: unknown): CompletionList {
  if (Array.isArray(value)) {
    return { isIncomplete: false, items: value as CompletionItem[] };
  }
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { isIncomplete?: unknown; items?: unknown };
    if (Array.isArray(candidate.items)) {
      return {
        isIncomplete: candidate.isIncomplete === true,
        items: candidate.items as CompletionItem[]
      };
    }
  }
  return { isIncomplete: false, items: [] };
}

/** A lazy, persistent clangd connection owned by the browser workbench. */
export function createClangd(options: ClangdOptions): IClangdClient {
  const create: () => IClangdWorker =
    options.createWorker ??
    (() => new Worker(options.workerUrl, { type: 'module', name: 'clangd' }));
  const requestTimeout = options.requestTimeout ?? 15_000;
  const documents = new Map<string, Document>();
  const diagnostics = new Set<(event: Diagnostics) => void>();
  const pending = new Map<JsonRpcId, Pending>();
  let worker: IClangdWorker | null = null;
  let runtimeReady: Promise<void> | null = null;
  let resolveRuntime: (() => void) | null = null;
  let rejectRuntime: ((reason: Error) => void) | null = null;
  let initialized: Promise<void> | null = null;
  let disposed = false;
  let sequence = 0;
  let generation = 0;
  let lifetime: Lifetime = { interruption: null };

  function requireLifetime(expected: Lifetime): void {
    if (lifetime !== expected) {
      throw (
        expected.interruption ?? new Error('The clangd runtime was replaced.')
      );
    }
  }

  function send(message: Parameters<IClangdWorker['postMessage']>[0]): void {
    if (!worker) {
      throw new Error('clangd has not started.');
    }
    worker.postMessage(message);
  }

  function notify(method: string, params: unknown): void {
    send({ kind: 'lsp', message: { jsonrpc: '2.0', method, params } });
  }

  function request(method: string, params: unknown): Promise<unknown> {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, requestTimeout);
      pending.set(id, { resolve, reject, timeout });
      send({
        kind: 'lsp',
        message: { jsonrpc: '2.0', id, method, params }
      });
    });
  }

  function respond(message: JsonRpcMessage): void {
    if (message.id === undefined || !message.method) {
      return;
    }
    let result: unknown = null;
    if (message.method === 'workspace/configuration') {
      const params = message.params as { items?: unknown } | undefined;
      result = Array.isArray(params?.items) ? params.items.map(() => ({})) : [];
    } else if (message.method === 'workspace/workspaceFolders') {
      result = [{ uri: workspaceUri, name: 'workspace' }];
    }
    send({
      kind: 'lsp',
      message: { jsonrpc: '2.0', id: message.id, result }
    });
  }

  function publish(message: JsonRpcMessage): void {
    if (message.method !== 'textDocument/publishDiagnostics') {
      return;
    }
    const params = message.params as
      { uri?: unknown; version?: unknown; diagnostics?: unknown } | undefined;
    const document = [...documents.values()].find(
      candidate => candidate.uri === params?.uri
    );
    if (!document || !Array.isArray(params?.diagnostics)) {
      return;
    }
    if (
      Number.isInteger(params.version) &&
      Number(params.version) < document.version
    ) {
      return;
    }
    const event: Diagnostics = {
      path: document.path,
      ...(Number.isInteger(params.version)
        ? { version: Number(params.version) }
        : {}),
      diagnostics: params.diagnostics as Diagnostic[]
    };
    for (const listener of diagnostics) {
      listener(event);
    }
  }

  function route(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.method) {
      respond(message);
      return;
    }
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) {
        return;
      }
      clearTimeout(entry.timeout);
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(message.error.message));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    publish(message);
  }

  function stop(reason: Error): void {
    lifetime.interruption = reason;
    lifetime = { interruption: null };
    generation += 1;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    rejectRuntime?.(reason);
    resolveRuntime = null;
    rejectRuntime = null;
    runtimeReady = null;
    initialized = null;
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(reason);
    }
    pending.clear();
  }

  function start(): Promise<void> {
    if (disposed) {
      return Promise.reject(new Error('clangd has been disposed.'));
    }
    if (runtimeReady) {
      return runtimeReady;
    }
    const current = create();
    worker = current;
    generation += 1;
    runtimeReady = new Promise<void>((resolve, reject) => {
      resolveRuntime = resolve;
      rejectRuntime = reject;
    });
    current.onmessage = event => {
      if (worker !== current || !isClangdOutput(event.data)) {
        if (worker === current) {
          stop(new Error('clangd returned an invalid response.'));
        }
        return;
      }
      const output = event.data;
      if (output.kind === 'ready') {
        resolveRuntime?.();
        resolveRuntime = null;
        rejectRuntime = null;
      } else if (output.kind === 'progress') {
        options.onProgress?.({
          loaded: output.loaded,
          total: output.total
        });
      } else if (output.kind === 'lsp') {
        route(output.message);
      } else if (output.kind === 'error') {
        stop(new Error(output.message));
      }
    };
    current.onerror = event => {
      if (worker === current) {
        event.preventDefault();
        stop(new Error(event.message || 'The clangd worker failed.'));
      }
    };
    current.onmessageerror = () => {
      if (worker === current) {
        stop(new Error('The clangd response could not be read.'));
      }
    };
    current.postMessage({ kind: 'start', base: options.assetBase.href });
    return runtimeReady;
  }

  function sync(document: Document): void {
    send({
      kind: 'sync',
      path: `/workspace/${document.path}`,
      contents: document.contents
    });
  }

  function open(document: Document): void {
    if (document.generation === generation) {
      return;
    }
    document.generation = generation;
    document.version = 1;
    sync(document);
    notify('textDocument/didOpen', {
      textDocument: {
        uri: document.uri,
        languageId: document.language,
        version: document.version,
        text: document.contents
      }
    });
  }

  function initialize(): Promise<void> {
    if (disposed) {
      return Promise.reject(new Error('clangd has been disposed.'));
    }
    if (!initialized) {
      const current = lifetime;
      const attempt = start()
        .then(() => {
          requireLifetime(current);
          return request('initialize', {
            processId: null,
            clientInfo: { name: 'WasmBolt', version: 'experimental' },
            rootUri: workspaceUri,
            workspaceFolders: [{ uri: workspaceUri, name: 'workspace' }],
            capabilities: {
              general: { positionEncodings: ['utf-16'] },
              workspace: { workspaceFolders: true, configuration: true },
              textDocument: {
                synchronization: {
                  dynamicRegistration: false,
                  didSave: false
                },
                completion: {
                  completionItem: {
                    snippetSupport: false,
                    documentationFormat: ['plaintext']
                  },
                  contextSupport: true
                },
                publishDiagnostics: { relatedInformation: true }
              }
            }
          });
        })
        .then(() => {
          requireLifetime(current);
          notify('initialized', {});
          for (const document of documents.values()) {
            open(document);
          }
        });
      initialized = attempt;
      void attempt.catch(() => {
        if (initialized === attempt) {
          initialized = null;
        }
      });
    }
    return initialized;
  }

  async function openDocument(
    path: string,
    contents: string,
    requestedLanguage?: ClangdLanguage
  ): Promise<void> {
    const normalized = projectPath(path);
    const existing = documents.get(normalized);
    if (existing) {
      if (existing.language !== language(normalized, requestedLanguage)) {
        throw new Error('Changing a document language requires closing it.');
      }
      await changeDocument(normalized, contents);
      return;
    }
    const document: Document = {
      path: normalized,
      uri: documentUri(normalized),
      language: language(normalized, requestedLanguage),
      contents,
      version: 0,
      generation: 0
    };
    documents.set(normalized, document);
    const current = lifetime;
    await initialize();
    requireLifetime(current);
    if (documents.get(normalized) !== document) {
      return;
    }
    open(document);
  }

  async function changeDocument(path: string, contents: string): Promise<void> {
    const normalized = projectPath(path);
    const document = documents.get(normalized);
    if (!document) {
      await openDocument(normalized, contents);
      return;
    }
    const current = lifetime;
    await initialize();
    requireLifetime(current);
    if (documents.get(normalized) !== document) {
      return;
    }
    open(document);
    document.contents = contents;
    document.version += 1;
    sync(document);
    notify('textDocument/didChange', {
      textDocument: { uri: document.uri, version: document.version },
      contentChanges: [{ text: contents }]
    });
  }

  return {
    initialize,
    openDocument,
    changeDocument,
    closeDocument(path) {
      const normalized = projectPath(path);
      const document = documents.get(normalized);
      if (!document) {
        return;
      }
      if (worker && document.generation === generation) {
        notify('textDocument/didClose', {
          textDocument: { uri: document.uri }
        });
      }
      documents.delete(normalized);
    },
    async completion(
      path: string,
      position: Position,
      context: CompletionContext = {}
    ) {
      const normalized = projectPath(path);
      const document = documents.get(normalized);
      if (!document) {
        throw new Error(`The document is not open: ${normalized}`);
      }
      const current = lifetime;
      await initialize();
      requireLifetime(current);
      if (documents.get(normalized) !== document) {
        throw new Error(`The document is no longer open: ${normalized}`);
      }
      open(document);
      return completionList(
        await request('textDocument/completion', {
          textDocument: { uri: document.uri },
          position,
          context: {
            triggerKind: context.triggerKind ?? 1,
            ...(context.triggerCharacter
              ? { triggerCharacter: context.triggerCharacter }
              : {})
          }
        })
      );
    },
    onDiagnostics(listener) {
      diagnostics.add(listener);
      return () => diagnostics.delete(listener);
    },
    suspend() {
      if (!disposed) {
        stop(new Error('clangd has been suspended.'));
      }
    },
    async restart() {
      if (disposed) {
        throw new Error('clangd has been disposed.');
      }
      stop(new Error('clangd restarted.'));
      await initialize();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stop(new Error('clangd has been disposed.'));
      diagnostics.clear();
      documents.clear();
    }
  };
}
