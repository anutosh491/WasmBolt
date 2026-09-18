import { asset } from '../compiler/assets';
import { restore } from '../compiler/files';
import type { IFilesystem } from '../compiler/module';
import { isRecord } from '../compiler/protocol';
import type {
  DebugBreakpoint,
  DebugFrame,
  DebugStartRequest,
  DebugVariable
} from './debugger';
import { isDebuggerInput } from './debug-protocol';
import type {
  DebugControl,
  DebuggerInput,
  DebuggerOutput
} from './debug-protocol';
import { DebuggerSessionPhase, isDebuggerRuntimeLog } from './phase';

type DapRequest = Readonly<{
  seq: number;
  type: 'request';
  command: string;
  arguments?: unknown;
}>;

type DapResponse = Readonly<{
  seq: number;
  type: 'response';
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: unknown;
}>;

type DapEvent = Readonly<{
  seq: number;
  type: 'event';
  event: string;
  body?: unknown;
}>;

type DapMessage = DapRequest | DapResponse | DapEvent;

type DapPending = Readonly<{
  command: string;
  resolve(response: DapResponse): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}>;

type DebuggerModule = Readonly<{
  FS: IFilesystem;
  PThread?: Readonly<{ terminateAllThreads?(): void }>;
  UTF8ToString(pointer: number): string;
  ccall(
    name: string,
    result: 'number' | 'string' | null,
    argumentTypes: readonly string[],
    arguments_: readonly unknown[]
  ): unknown;
}>;

type DebuggerFactory = (
  options: Record<string, unknown>
) => Promise<DebuggerModule>;

const scope: DedicatedWorkerGlobalScope = self;
const dapTimeout = 15_000;
let operation = Promise.resolve();
let module: DebuggerModule | null = null;
let request: DebugStartRequest | null = null;
let dapSequence = 0;
let drainTimer: ReturnType<typeof setInterval> | null = null;
const sessionPhase = new DebuggerSessionPhase();
let threadId: number | null = null;
let frames: DebugFrame[] = [];
const dapPending = new Map<number, DapPending>();
let stopRefresh = Promise.resolve();

scope.addEventListener('message', event => {
  const value: unknown = event.data;
  const id =
    isRecord(value) && Number.isSafeInteger(value.id) ? Number(value.id) : 0;
  if (!isDebuggerInput(value)) {
    reply({ kind: 'error', id, message: 'Invalid debugger request.' });
    return;
  }
  operation = operation.then(
    () => handle(value),
    () => handle(value)
  );
});

async function handle(input: DebuggerInput): Promise<void> {
  try {
    if (input.kind === 'start') {
      await start(input.base, input.request);
    } else {
      requireSession();
      if (input.kind === 'breakpoints') {
        await setBreakpoints(input.path, input.lines);
      } else if (input.kind === 'control') {
        await control(input.control);
      } else if (input.kind === 'frame') {
        const variables = await frameVariables(input.frameId);
        event({ type: 'frame', frameId: input.frameId, variables });
      } else {
        await rawCommand(input.command);
      }
    }
    reply({ kind: 'response', id: input.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    event({ type: 'error', message });
    reply({ kind: 'error', id: input.id, message });
  }
}

async function start(base: string, startRequest: DebugStartRequest) {
  if (module) {
    throw new Error('This debugger runtime already owns a session.');
  }
  request = startRequest;
  sessionPhase.begin();
  event({ type: 'status', status: 'starting', message: 'Loading LLDB…' });
  module = await loadModule(new URL(base));
  restore(module.FS, startRequest.files);
  if (nativeNumber('wasmbolt_lldb_initialize') !== 0) {
    throw new Error(nativeError('LLDB initialization failed.'));
  }
  if (nativeNumber('wasmbolt_dap_initialize') !== 0) {
    throw new Error(nativeError('LLDB-DAP initialization failed.'));
  }
  drainTimer = setInterval(drain, 20);

  await dap('initialize', {
    adapterID: 'lldb',
    clientID: 'wasmbolt',
    clientName: 'WasmBolt browser debugger',
    linesStartAt1: true,
    columnsStartAt1: true,
    supportsVariableType: true
  });

  // Native contract: prepare the selected MEMFS module and entry inside WAMR.
  // Keeping this call in one place makes an ABI adjustment mechanical while
  // the upstream LLDB/WAMR prototype settles on its final exported signature.
  const prepared = Number(
    module.ccall(
      'wasmbolt_dap_prepare_wamr_session',
      'number',
      ['string', 'string', 'string'],
      [
        startRequest.module,
        startRequest.entry,
        JSON.stringify(startRequest.argv)
      ]
    )
  );
  if (prepared !== 0) {
    throw new Error(
      nativeError(`Unable to prepare ${basename(startRequest.module)}.`)
    );
  }

  const sessionText = nativeString('wasmbolt_dap_session_json');
  const session: unknown = JSON.parse(sessionText);
  if (!isRecord(session)) {
    throw new Error('LLDB-DAP returned invalid session identifiers.');
  }
  const attach = dap('attach', {
    program: startRequest.module,
    stopOnEntry: false,
    session
  });
  for (const path of new Set([
    ...startRequest.sourcePaths,
    ...startRequest.breakpoints.map(item => item.path)
  ])) {
    await setBreakpoints(
      path,
      startRequest.breakpoints
        .filter(item => item.path === path)
        .map(item => item.line)
    );
  }
  await dap('configurationDone');
  const stopped = sessionPhase.configure();
  if (stopped) {
    queueStopped(stopped.threadId, stopped.reason);
  }
  if (sessionPhase.startRunning()) {
    event({ type: 'running' });
  }
  await attach;
}

async function loadModule(base: URL): Promise<DebuggerModule> {
  const root = new URL('../', base);
  const manifestResponse = await fetch(new URL('manifest.json', root));
  if (!manifestResponse.ok) {
    throw new Error(
      `Debugger manifest could not load (${manifestResponse.status}).`
    );
  }
  const manifest: unknown = await manifestResponse.json();
  if (
    !isRecord(manifest) ||
    manifest.format !== 1 ||
    manifest.debuggerOrigin !== 'source' ||
    typeof manifest.revision !== 'string'
  ) {
    throw new Error('The debugger manifest is invalid or not source-built.');
  }
  const loaderUrl = new URL('lldb-dap.js', base);
  const [loader, wasmBuffer] = await Promise.all([
    import(/* @vite-ignore */ loaderUrl.href),
    asset(root.href, manifest.files, 'lldb-dap/lldb-dap.wasm', () => undefined)
  ]);
  if (!isRecord(loader) || typeof loader.default !== 'function') {
    throw new Error('The LLDB debugger loader has no module factory.');
  }
  const wasm = new Uint8Array(wasmBuffer);
  const compiled = await WebAssembly.compile(wasm);
  return (loader.default as DebuggerFactory)({
    noInitialRun: true,
    locateFile: (path: string) => new URL(path, base).href,
    mainScriptUrlOrBlob: new URL('lldb-dap.worker.js', base).href,
    wasmBinary: wasm,
    instantiateWasm: (
      imports: WebAssembly.Imports,
      receive: (
        instance: WebAssembly.Instance,
        binary: WebAssembly.Module
      ) => void
    ) => {
      void WebAssembly.instantiate(compiled, imports).then(instance =>
        receive(instance, compiled)
      );
      return {};
    },
    print: (value: unknown) => runtimeOutput('stdout', String(value)),
    printErr: (value: unknown) => runtimeOutput('stderr', String(value)),
    onAbort: (reason: unknown) => {
      event({
        type: 'error',
        message: `The debugger runtime aborted: ${String(reason)}`
      });
    }
  });
}

async function setBreakpoints(
  path: string,
  lines: readonly number[]
): Promise<void> {
  const response = await dap('setBreakpoints', {
    source: { name: basename(path), path },
    breakpoints: lines.map(line => ({ line })),
    sourceModified: false
  });
  const body = isRecord(response.body) ? response.body : {};
  const resolved = Array.isArray(body.breakpoints) ? body.breakpoints : [];
  const breakpoints: DebugBreakpoint[] = lines.map((line, index) => {
    const result = isRecord(resolved[index]) ? resolved[index] : {};
    return {
      path,
      line: Number.isInteger(result.line) ? Number(result.line) : line,
      verified: result.verified === true,
      ...(typeof result.message === 'string' ? { message: result.message } : {})
    };
  });
  event({ type: 'breakpoints', path, breakpoints });
}

async function control(action: DebugControl): Promise<void> {
  const commands: Readonly<Record<DebugControl, string>> = {
    continue: 'continue',
    pause: 'pause',
    stepOver: 'next',
    stepIn: 'stepIn',
    stepOut: 'stepOut'
  };
  const command = commands[action];
  if (action !== 'pause' && threadId === null) {
    throw new Error('The program is not paused.');
  }
  await dap(command, { threadId: threadId ?? 1 });
}

async function rawCommand(command: string): Promise<void> {
  const frameId = frames[0]?.id;
  const response = await dap('evaluate', {
    expression: command,
    context: 'repl',
    ...(frameId === undefined ? {} : { frameId })
  });
  const body = isRecord(response.body) ? response.body : {};
  if (typeof body.result === 'string' && body.result) {
    consoleEvent('console', body.result.replace(/\n$/, ''));
  }
}

function dap(command: string, arguments_?: unknown): Promise<DapResponse> {
  const seq = ++dapSequence;
  const message: DapRequest = {
    seq,
    type: 'request',
    command,
    ...(arguments_ === undefined ? {} : { arguments: arguments_ })
  };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      dapPending.delete(seq);
      reject(new Error(`LLDB-DAP ${command} timed out.`));
    }, dapTimeout);
    dapPending.set(seq, { command, resolve, reject, timeout });
    const status = Number(
      module!.ccall(
        'wasmbolt_dap_send_json',
        'number',
        ['string'],
        [JSON.stringify(message)]
      )
    );
    if (status !== 0) {
      clearTimeout(timeout);
      dapPending.delete(seq);
      reject(new Error(nativeError(`LLDB-DAP could not send ${command}.`)));
      return;
    }
    drain();
  });
}

function drain(): void {
  if (!module) {
    return;
  }
  const count = nativeNumber('wasmbolt_dap_message_count');
  for (let index = 0; index < count; index += 1) {
    const text = nativeString('wasmbolt_dap_pop_message');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      event({ type: 'error', message: 'LLDB-DAP emitted invalid JSON.' });
      continue;
    }
    const message = dapMessage(parsed);
    if (!message) {
      event({ type: 'error', message: 'LLDB-DAP emitted an invalid message.' });
    } else if (message.type === 'response') {
      const pending = dapPending.get(message.request_seq);
      if (!pending) {
        continue;
      }
      clearTimeout(pending.timeout);
      dapPending.delete(message.request_seq);
      if (message.success) {
        pending.resolve(message);
      } else {
        pending.reject(
          new Error(message.message || `LLDB-DAP ${pending.command} failed.`)
        );
      }
    } else if (message.type === 'event') {
      dapEvent(message);
    }
  }
}

function dapEvent(message: DapEvent): void {
  const body = isRecord(message.body) ? message.body : {};
  if (message.event === 'continued') {
    sessionPhase.continued();
    event({ type: 'running' });
  } else if (message.event === 'stopped') {
    const stoppedThread = Number.isSafeInteger(body.threadId)
      ? Number(body.threadId)
      : threadId;
    if (stoppedThread !== null) {
      const reason = typeof body.reason === 'string' ? body.reason : 'stopped';
      const stopped = sessionPhase.stopped({
        threadId: stoppedThread,
        reason
      });
      if (stopped) {
        queueStopped(stopped.threadId, stopped.reason);
      }
    }
  } else if (message.event === 'exited') {
    const exitCode = Number.isInteger(body.exitCode)
      ? Number(body.exitCode)
      : 0;
    sessionPhase.exited();
    threadId = null;
    frames = [];
    event({ type: 'exited', exitCode });
  } else if (message.event === 'output') {
    const output = typeof body.output === 'string' ? body.output : '';
    if (output) {
      const category = body.category;
      consoleEvent(
        category === 'stdout' || category === 'stderr' ? category : 'console',
        output.replace(/\n$/, '')
      );
    }
  }
}

function queueStopped(stoppedThread: number, reason: string): void {
  stopRefresh = stopRefresh.then(
    () => refreshStopped(stoppedThread, reason),
    () => refreshStopped(stoppedThread, reason)
  );
  stopRefresh = stopRefresh.catch(error => {
    event({
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    });
  });
}

async function refreshStopped(
  stoppedThread: number,
  reason: string
): Promise<void> {
  threadId = stoppedThread;
  const response = await dap('stackTrace', {
    threadId: stoppedThread,
    startFrame: 0,
    levels: 50
  });
  const body = isRecord(response.body) ? response.body : {};
  const stack = Array.isArray(body.stackFrames) ? body.stackFrames : [];
  frames = stack.flatMap(value => {
    if (!isRecord(value) || !Number.isSafeInteger(value.id)) {
      return [];
    }
    const source = isRecord(value.source) ? value.source : {};
    return [
      {
        id: Number(value.id),
        name: typeof value.name === 'string' ? value.name : '<unknown>',
        path: typeof source.path === 'string' ? source.path : null,
        line: Number.isInteger(value.line) ? Number(value.line) : null,
        column: Number.isInteger(value.column) ? Number(value.column) : null
      }
    ];
  });
  const frameId = frames[0]?.id ?? null;
  const variables = frameId === null ? [] : await frameVariables(frameId);
  event({
    type: 'stopped',
    threadId: stoppedThread,
    frames,
    frameId,
    variables,
    reason
  });
}

async function frameVariables(frameId: number): Promise<DebugVariable[]> {
  if (!frames.some(frame => frame.id === frameId)) {
    throw new Error('The selected stack frame is no longer available.');
  }
  const response = await dap('scopes', { frameId });
  const body = isRecord(response.body) ? response.body : {};
  const scopes = Array.isArray(body.scopes) ? body.scopes : [];
  const local =
    scopes.find(scope => isRecord(scope) && scope.name === 'Locals') ??
    scopes[0];
  if (!isRecord(local) || !Number.isSafeInteger(local.variablesReference)) {
    return [];
  }
  const variablesResponse = await dap('variables', {
    variablesReference: Number(local.variablesReference)
  });
  const variablesBody = isRecord(variablesResponse.body)
    ? variablesResponse.body
    : {};
  const values = Array.isArray(variablesBody.variables)
    ? variablesBody.variables
    : [];
  return values.flatMap(value => {
    if (
      !isRecord(value) ||
      typeof value.name !== 'string' ||
      typeof value.value !== 'string'
    ) {
      return [];
    }
    return [
      {
        name: value.name,
        value: value.value,
        ...(typeof value.type === 'string' ? { type: value.type } : {}),
        ...(Number.isSafeInteger(value.variablesReference)
          ? { variablesReference: Number(value.variablesReference) }
          : {})
      }
    ];
  });
}

function dapMessage(value: unknown): DapMessage | null {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.seq) ||
    !['request', 'response', 'event'].includes(String(value.type))
  ) {
    return null;
  }
  if (value.type === 'response') {
    return Number.isSafeInteger(value.request_seq) &&
      typeof value.success === 'boolean' &&
      typeof value.command === 'string'
      ? (value as DapResponse)
      : null;
  }
  if (value.type === 'event') {
    return typeof value.event === 'string' ? (value as DapEvent) : null;
  }
  return typeof value.command === 'string' ? (value as DapRequest) : null;
}

function nativeNumber(name: string): number {
  return Number(module!.ccall(name, 'number', [], []));
}

function nativeString(name: string): string {
  const value = module!.ccall(name, 'string', [], []);
  return typeof value === 'string' ? value : '';
}

function nativeError(fallback: string): string {
  return nativeString('wasmbolt_dap_last_error') || fallback;
}

function requireSession(): void {
  if (!module || !request) {
    throw new Error('Start the debugger first.');
  }
}

function consoleEvent(
  channel: 'stdout' | 'stderr' | 'console',
  text: string
): void {
  if (text) {
    event({ type: 'console', channel, text });
  }
}

function runtimeOutput(channel: 'stdout' | 'stderr', text: string): void {
  if (isDebuggerRuntimeLog(text)) {
    console.debug(text);
  } else {
    consoleEvent(channel, text);
  }
}

function event(value: Extract<DebuggerOutput, { kind: 'event' }>['event']) {
  reply({ kind: 'event', event: value });
}

function reply(output: DebuggerOutput): void {
  scope.postMessage(output);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

scope.addEventListener('close', () => {
  if (drainTimer !== null) {
    clearInterval(drainTimer);
  }
  module?.PThread?.terminateAllThreads?.();
  for (const pending of dapPending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error('The debugger worker closed.'));
  }
  dapPending.clear();
});
