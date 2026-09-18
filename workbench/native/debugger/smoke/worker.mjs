import createLLDBDAPModule from '/artifacts/lldb-dap.js';

const outputBase = new URL('/artifacts/', import.meta.url);
const moduleLoader = new URL('lldb-dap.js', outputBase);
const probe = new URL(self.location.href).searchParams.get('probe');
const pending = new Map();
const eventQueue = [];
const eventWaiters = [];
let sequence = 0;
let module;
let drainTimer;

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
        entry.reject(
          new Error(message.message || `${entry.command} request failed.`)
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
      reject(new Error(`${command} request timed out.`));
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
  check(frames.length > 0, 'The stopped thread has no stack frames.');
  return { threadId, frames };
}

async function run() {
  const startedAt = performance.now();
  const wasm = await fetch(new URL('lldb-dap.wasm', outputBase)).then(
    response => {
      check(response.ok, `lldb-dap.wasm failed to load (${response.status}).`);
      return response.arrayBuffer();
    }
  );
  module = await createLLDBDAPModule({
    noInitialRun: true,
    mainScriptUrlOrBlob: new URL('lldb-dap.worker.js', outputBase).href,
    locateFile: path => new URL(path, outputBase).href,
    wasmBinary: new Uint8Array(wasm),
    print: value => log({ stdout: String(value) }),
    printErr: value => log({ stderr: String(value) }),
    onAbort: reason => log({ abort: String(reason) })
  });
  log({
    milestone: 'module-loaded',
    milliseconds: performance.now() - startedAt
  });

  const [guest, source] = await Promise.all([
    fetch('/guests/simple.wasm').then(response => response.arrayBuffer()),
    fetch('/tests/simple.cpp').then(response => response.text())
  ]);
  module.FS.mkdirTree('/workspace');
  module.FS.writeFile('/workspace/simple.wasm', new Uint8Array(guest));
  module.FS.writeFile('/workspace/simple.cpp', source);

  check(nativeNumber('wasmbolt_lldb_initialize') === 0, 'LLDB init failed.');
  check(
    nativeNumber('wasmbolt_dap_initialize') === 0,
    nativeString('wasmbolt_dap_last_error') || 'DAP init failed.'
  );
  drainTimer = setInterval(drain, 10);

  await dap('initialize', {
    adapterID: 'lldb',
    clientID: 'wasmbolt-smoke',
    clientName: 'WasmBolt LLDB-DAP smoke',
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
        ['/workspace/simple.wasm', '', '[]']
      )
    ) === 0,
    nativeString('wasmbolt_dap_last_error') || 'WAMR session prepare failed.'
  );

  const session = JSON.parse(nativeString('wasmbolt_dap_session_json'));
  const attach = dap('attach', {
    program: '/workspace/simple.wasm',
    stopOnEntry: false,
    session
  });
  const breakpointResponse = await dap('setBreakpoints', {
    source: { name: 'simple.cpp', path: '/workspace/simple.cpp' },
    breakpoints: [{ line: 2 }],
    sourceModified: false
  });
  const breakpoint = breakpointResponse.body?.breakpoints?.[0];
  check(
    breakpoint?.verified === true,
    `Breakpoint was not verified: ${JSON.stringify(breakpoint)}`
  );
  await dap('configurationDone');
  await attach;

  const first = await stack('breakpoint');
  const firstFrame = first.frames[0];
  check(
    firstFrame.name.includes('square_plus_one'),
    `Unexpected first frame: ${JSON.stringify(firstFrame)}`
  );
  check(firstFrame.line === 2, `Expected line 2, got ${firstFrame.line}.`);
  if (probe === 'continue-first') {
    const continueResponse = dap('continue', { threadId: first.threadId });
    const exited = await waitEvent('exited', () => true, 30_000);
    await continueResponse;
    return { ok: true, probe, exitCode: exited.body?.exitCode };
  }
  let before = {};
  if (probe !== 'next-first' && probe !== 'instruction-first') {
    const repl = await dap('evaluate', {
      expression: 'frame variable value squared',
      context: 'repl',
      frameId: firstFrame.id
    });
    check(
      repl.body?.result?.includes('value') &&
        repl.body.result.includes('squared'),
      'DAP REPL command returned unexpected output: ' +
        JSON.stringify(repl.body)
    );
    before = await variables(firstFrame.id);
    check(before.value === '6', `Expected value=6, got ${before.value}.`);
    check(before.squared === '0', `Expected squared=0, got ${before.squared}.`);
    log({
      milestone: 'breakpoint-and-variables',
      frame: firstFrame,
      variables: before
    });
  }

  // WAMR reports a synthetic step stop while the attach request is being
  // configured. Do not mistake that queued event for the stop caused by the
  // explicit `next` request below.
  discardEvents('stopped', message => message.body?.reason === 'step');

  const nextResponse = dap('next', {
    threadId: first.threadId,
    ...(probe === 'instruction-first' ? { granularity: 'instruction' } : {})
  });
  const second = await stack('step');
  await nextResponse;
  const secondFrame = second.frames[0];
  check(secondFrame.line === 3, `Expected line 3, got ${secondFrame.line}.`);
  const after = await variables(secondFrame.id);
  check(after.squared === '36', `Expected squared=36, got ${after.squared}.`);
  log({ milestone: 'step-over', frame: secondFrame, variables: after });

  const continueResponse = dap('continue', { threadId: second.threadId });
  const exited = await waitEvent('exited', () => true, 30_000);
  await continueResponse;
  check(
    exited.body?.exitCode === 37,
    `Expected exit code 37, got ${exited.body?.exitCode}.`
  );
  log({ milestone: 'continued-to-exit', exitCode: exited.body.exitCode });
  return {
    ok: true,
    elapsedMilliseconds: performance.now() - startedAt,
    breakpoint: {
      name: firstFrame.name,
      line: firstFrame.line,
      variables: before
    },
    step: { name: secondFrame.name, line: secondFrame.line, variables: after },
    exitCode: exited.body.exitCode
  };
}

try {
  const result = await run();
  postMessage({ kind: 'result', value: result });
} catch (error) {
  postMessage({
    kind: 'result',
    value: {
      ok: false,
      error:
        error instanceof Error ? error.stack || error.message : String(error)
    }
  });
} finally {
  if (drainTimer) {
    clearInterval(drainTimer);
  }
  for (const entry of pending.values()) {
    clearTimeout(entry.timeout);
  }
  for (const waiter of eventWaiters) {
    clearTimeout(waiter.timeout);
  }
}
