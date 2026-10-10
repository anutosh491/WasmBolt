import createLLDBDAPModule from '/artifacts/lldb-dap.js';
import { unpackTar } from '/support/archive.mjs';
const outputBase = new URL('/artifacts/', import.meta.url);
const probe = 'swift';
const delayMilliseconds = 6000;
const pending = new Map();
const eventQueue = [];
const eventWaiters = [];
let sequence = 0;
let module;
let drainTimer;

async function delay() {
  log({ milestone: 'idle', milliseconds: delayMilliseconds });
  await new Promise(resolve => setTimeout(resolve, delayMilliseconds));
}

const log = value => postMessage({ kind: 'log', value });

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function deadline(label, milliseconds = 20_000) {
  return setTimeout(() => {
    throw new Error(`${label} timed out.`);
  }, milliseconds);
}

function nativeNumber(name) {
  return Number(module.ccall(name, 'number', [], []));
}

function nativeString(name) {
  const value = module.ccall(name, 'string', [], []);
  return typeof value === 'string' ? value : '';
}

function lldb(command) {
  const output = String(
    module.ccall('wasmbolt_lldb_command', 'string', ['string'], [command]) ?? ''
  );
  log({ lldb: command, output });
  return output;
}

function dispatchEvent(message) {
  for (let index = 0; index < eventWaiters.length; index += 1) {
    const waiter = eventWaiters[index];
    if (waiter.event === message.event && waiter.predicate(message)) {
      eventWaiters.splice(index, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
      return;
    }
  }
  eventQueue.push(message);
}

function drain() {
  if (!module) {
    return;
  }
  if (typeof module._wasmbolt_dap_poll_runtime === 'function') {
    module._wasmbolt_dap_poll_runtime();
  }
  const count = nativeNumber('wasmbolt_dap_message_count');
  for (let index = 0; index < count; index += 1) {
    const text = nativeString('wasmbolt_dap_pop_message');
    const message = JSON.parse(text);
    if (message.type === 'response') {
      const entry = pending.get(message.request_seq);
      if (!entry) {
        continue;
      }
      pending.delete(message.request_seq);
      clearTimeout(entry.timeout);
      if (message.success) {
        entry.resolve(message);
      } else {
        log({ dapFailure: message });
        entry.reject(
          new Error(
            message.body?.error?.format ||
              message.message ||
              `${entry.command} request failed.`
          )
        );
      }
    } else if (message.type === 'event') {
      const noisy =
        message.event === 'initialized' || message.event === 'terminated';
      log({
        dapEvent: message.event,
        body: noisy ? '[omitted]' : (message.body ?? null)
      });
      dispatchEvent(message);
    }
  }
}

function dap(command, arguments_) {
  const seq = ++sequence;
  const message = {
    seq,
    type: 'request',
    command,
    ...(arguments_ === undefined ? {} : { arguments: arguments_ })
  };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(seq);
      const dispatch =
        typeof module._wasmbolt_dap_dispatch_stats === 'function'
          ? nativeString('wasmbolt_dap_dispatch_stats')
          : '';
      reject(
        new Error(
          `${command} request timed out.` +
            (dispatch ? ` Dispatch state: ${dispatch}` : '')
        )
      );
    }, 20_000);
    pending.set(seq, { command, resolve, reject, timeout });
    log({ dapRequest: command, seq });
    const status = Number(
      module.ccall(
        'wasmbolt_dap_send_json',
        'number',
        ['string'],
        [JSON.stringify(message)]
      )
    );
    if (status !== 0) {
      pending.delete(seq);
      clearTimeout(timeout);
      reject(
        new Error(
          nativeString('wasmbolt_dap_last_error') ||
            `${command} dispatch failed.`
        )
      );
      return;
    }
    drain();
  });
}

function waitEvent(event, predicate = () => true, milliseconds = 20_000) {
  const found = eventQueue.findIndex(
    message => message.event === event && predicate(message)
  );
  if (found >= 0) {
    return Promise.resolve(eventQueue.splice(found, 1)[0]);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = eventWaiters.indexOf(waiter);
      if (index >= 0) {
        eventWaiters.splice(index, 1);
      }
      reject(new Error(`${event} event timed out.`));
    }, milliseconds);
    const waiter = { event, predicate, resolve, reject, timeout };
    eventWaiters.push(waiter);
  });
}

function discardEvents(event, predicate = () => true) {
  for (let index = eventQueue.length - 1; index >= 0; index -= 1) {
    const message = eventQueue[index];
    if (message.event === event && predicate(message)) {
      eventQueue.splice(index, 1);
    }
  }
}

async function variables(frameId) {
  const scopes = await dap('scopes', { frameId });
  const local =
    scopes.body?.scopes?.find(scope => scope.name === 'Locals') ??
    scopes.body?.scopes?.[0];
  check(local, 'The stopped frame has no variable scope.');
  const response = await dap('variables', {
    variablesReference: local.variablesReference
  });
  log({ variables: response.body });
  return Object.fromEntries(
    response.body.variables.map(variable => [variable.name, variable.value])
  );
}

async function stack(reason) {
  const stopped = await waitEvent(
    'stopped',
    message => reason === undefined || message.body?.reason === reason
  );
  const threadId = stopped.body?.threadId;
  check(Number.isSafeInteger(threadId), 'Stopped event has no thread id.');
  const response = await dap('stackTrace', {
    threadId,
    startFrame: 0,
    levels: 20
  });
  const frames = response.body?.stackFrames ?? [];
  check(
    frames.length > 0,
    `The stopped thread has no stack frames: ${JSON.stringify(response.body)}`
  );
  return { threadId, frames };
}

async function run() {
  module = await createLLDBDAPModule({
    noInitialRun: true,
    noExitRuntime: true,
    mainScriptUrlOrBlob: new URL('lldb-dap.worker.js', outputBase).href,
    locateFile: path => new URL(path, outputBase).href,
    print: value => log({ stdout: String(value) }),
    printErr: value => log({ stderr: String(value) })
  });
  const sdk = await fetch('/swift-package/runtime.tar.gz');
  unpackTar(
    module.FS,
    new Uint8Array(
      await new Response(
        sdk.body.pipeThrough(new DecompressionStream('gzip'))
      ).arrayBuffer()
    )
  );
  module.FS.mkdirTree('/workspace');
  const modulePath = '/workspace/main.wasm';
  const sourcePath = '/workspace/main.swift';
  module.FS.writeFile(
    modulePath,
    new Uint8Array(
      await (await fetch('/browser-guests/simple/program.wasm')).arrayBuffer()
    )
  );
  module.FS.writeFile(sourcePath, await (await fetch('/scalar.swift')).text());
  check(nativeNumber('wasmbolt_lldb_initialize') === 0, 'LLDB init failed.');
  check(nativeNumber('wasmbolt_dap_initialize') === 0, 'DAP init failed.');
  drainTimer = setInterval(drain, 10);
  await dap('initialize', {
    adapterID: 'lldb',
    clientID: 'swift-browser-test',
    linesStartAt1: true,
    columnsStartAt1: true,
    supportsVariableType: true
  });
  check(
    Number(
      module.ccall(
        'wasmbolt_dap_prepare_wamr_session',
        'number',
        ['string', 'string', 'string'],
        [modulePath, '', '[]']
      )
    ) === 0,
    nativeString('wasmbolt_dap_last_error')
  );
  await delay();
  lldb('image list');
  lldb('image dump line-table main.swift');
  const session = JSON.parse(nativeString('wasmbolt_dap_session_json'));
  const attach = dap('attach', {
    program: modulePath,
    stopOnEntry: false,
    session,
    initCommands: [
      'settings set target.swift-module-search-paths /swift/lib/swift/emscripten',
      'settings set target.sdk-path /',
      'settings set -- target.swift-extra-clang-flags "-resource-dir=/swift/lib/swift/clang -I/include/compat"'
    ]
  });
  const bps = await dap('setBreakpoints', {
    source: { path: sourcePath },
    breakpoints: [{ line: 7 }],
    sourceModified: false
  });
  check(bps.body?.breakpoints?.[0]?.verified, JSON.stringify(bps));
  await dap('configurationDone');
  await attach;
  const first = await stack('breakpoint');
  check(first.frames[0].line === 7, JSON.stringify(first));
  log({ milestone: 'swift-main', frame: first.frames[0] });
  discardEvents('stopped');
  let response = dap('stepIn', { threadId: first.threadId });
  const inside = await stack('step');
  await response;
  log({ milestone: 'swift-step-in', frame: inside.frames[0] });
  check(inside.frames[0].name.includes('add'), JSON.stringify(inside));
  const locals = await variables(inside.frames[0].id);
  lldb('frame variable --raw --show-types left right');
  log({ milestone: 'swift-variables', locals });
  check(locals.left === '19' && locals.right === '23', JSON.stringify(locals));
  await delay();
  response = dap('next', { threadId: inside.threadId });
  const next = await stack('step');
  await response;
  const after = await variables(next.frames[0].id);
  log({ milestone: 'swift-next', frame: next.frames[0], locals: after });
  check(after.sum === '42', JSON.stringify(after));
  lldb('frame variable --raw --show-types sum');
  response = dap('stepOut', { threadId: next.threadId });
  const outside = await stack('step');
  await response;
  log({ milestone: 'swift-step-out', frame: outside.frames[0] });
  response = dap('continue', { threadId: outside.threadId });
  const exited = await waitEvent('exited');
  await response;
  check(exited.body.exitCode === 0, JSON.stringify(exited));
  const stdout = nativeString('wasmbolt_wasi_stdout');
  check(stdout === 'Swift answer: 42\n', JSON.stringify(stdout));
  return {
    success: true,
    locals,
    after,
    stdout,
    exitCode: exited.body.exitCode
  };
}
try {
  postMessage({ kind: 'result', value: await run() });
} catch (error) {
  postMessage({
    kind: 'result',
    value: {
      success: false,
      message: String(error.stack ?? error)
    }
  });
} finally {
  clearInterval(drainTimer);
  for (const value of pending.values()) clearTimeout(value.timeout);
  for (const value of eventWaiters) clearTimeout(value.timeout);
  module?.PThread.terminateAllThreads();
}
