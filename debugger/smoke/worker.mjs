import createLLDBDAPModule from '/artifacts/lldb-dap.js';

const outputBase = new URL('/artifacts/', import.meta.url);
const moduleLoader = new URL('lldb-dap.js', outputBase);
const probe = new URL(self.location.href).searchParams.get('probe');
const xtensor = probe === 'xtensor';
const iostream = probe === 'iostream';
const json = probe === 'json';
const pause = probe === 'pause';
const multipleBreakpoints = probe === 'multiple-breakpoints';
const distantBreakpoints = probe === 'distant-breakpoints';
const stepInOut = probe === 'step-in-out';
const guest = pause
  ? {
      base: 'pause',
      breakpointLine: 0,
      functionName: 'busy_work',
      stepLine: 0,
      variablesBefore: {},
      variablesAfter: {},
      exitCode: 42
    }
  : json
  ? {
      base: 'json',
      breakpointLine: 7,
      functionName: 'json_score',
      stepLine: 8,
      variablesBefore: { base: '35', bonus: '7' },
      variablesAfter: { score: '42' },
      exitCode: 42
    }
  : iostream
  ? {
      base: 'iostream',
      breakpointLine: 16,
      functionName: 'calculate_score',
      stepLine: 17,
      variablesBefore: { base: '10' },
      variablesAfter: { doubled: '20' },
      exitCode: 25,
      stdout: 'score=25\n'
    }
  : xtensor
    ? {
      base: 'xtensor',
      breakpointLine: 10,
      functionName: 'xtensor_broadcast_sum',
      stepLine: 11,
      variablesBefore: { scale: '2', total: '141' },
      variablesAfter: { result: '282' },
      exitCode: 26
    }
  : {
      base: 'simple',
      breakpointLine: 12,
      functionName: 'compute',
      stepLine: 13,
      variablesBefore: { input: '7' },
      variablesAfter: { sum: '11' },
      exitCode: 31
    };
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

function lldb(command) {
  const output = String(
    module.ccall(
      'wasmbolt_lldb_command',
      'string',
      ['string'],
      [command]
    ) ?? ''
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
  const [guestBytes, source] = await Promise.all([
    fetch(`/guests/${guest.base}.wasm`).then(response =>
      response.arrayBuffer()
    ),
    fetch(`/tests/${guest.base}.cpp`).then(response => response.text())
  ]);
  module.FS.mkdirTree('/workspace');
  const modulePath = `/workspace/${guest.base}.wasm`;
  const sourcePath = `/workspace/${guest.base}.cpp`;
  module.FS.writeFile(modulePath, new Uint8Array(guestBytes));
  module.FS.writeFile(sourcePath, source);

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
        [modulePath, '', '[]']
      )
    ) === 0,
    nativeString('wasmbolt_dap_last_error') || 'WAMR session prepare failed.'
  );

  if (probe === 'static-commands') {
    check(
      Number(
        module.ccall('wasmbolt_lldb_set_async', 'number', ['number'], [0])
      ) === 0,
      'Unable to select synchronous LLDB command execution.'
    );
    const firstBreakpoint = lldb(
      `breakpoint set --file ${guest.base}.cpp --line ${guest.breakpointLine}`
    );
    const secondBreakpoint = lldb(
      `breakpoint set --file ${guest.base}.cpp --line 2`
    );
    check(
      firstBreakpoint.includes('Breakpoint 1:') &&
        firstBreakpoint.includes('address = '),
      `First LLDB breakpoint failed: ${firstBreakpoint}`
    );
    check(
      secondBreakpoint.includes('Breakpoint 2:') &&
        secondBreakpoint.includes('address = '),
      `Second LLDB breakpoint failed: ${secondBreakpoint}`
    );
    const firstStop = lldb('process continue');
    const backtrace = lldb('thread backtrace');
    const variables = lldb('frame variable input sum product');
    check(firstStop.includes(`at ${guest.base}.cpp:${guest.breakpointLine}`),
      `Unexpected first stop: ${firstStop}`);
    check(backtrace.includes(guest.functionName),
      `Unexpected LLDB backtrace: ${backtrace}`);
    check(variables.includes('(int) input = 7'),
      `Unexpected LLDB variables: ${variables}`);
    const deleteSecondBreakpoint = lldb('breakpoint delete 2');
    check(
      deleteSecondBreakpoint.includes('1 breakpoints deleted'),
      `Unable to remove the auxiliary breakpoint: ${deleteSecondBreakpoint}`
    );
    const stepStop = lldb('thread step-over');
    const steppedVariables = lldb('frame variable input sum product');
    check(stepStop.includes('stop reason = step over'),
      `Unexpected LLDB step stop: ${stepStop}`);
    check(steppedVariables.includes('(int) sum = 11'),
      `Unexpected stepped variables: ${steppedVariables}`);
    const exit = lldb('process continue');
    check(
      exit.includes('exited with status = 31'),
      `Unexpected LLDB exit: ${exit}`
    );
    return {
      ok: true,
      probe,
      firstStop,
      backtrace,
      variables,
      stepStop,
      steppedVariables,
      exit
    };
  }

  const session = JSON.parse(nativeString('wasmbolt_dap_session_json'));
  const attach = dap('attach', {
    program: modulePath,
    stopOnEntry: false,
    session
  });
  const breakpointResponse = await dap('setBreakpoints', {
    source: { name: `${guest.base}.cpp`, path: sourcePath },
    breakpoints: pause
      ? []
      : [
          { line: guest.breakpointLine },
          ...(multipleBreakpoints
            ? [{ line: guest.stepLine }]
            : distantBreakpoints
              ? [{ line: 2 }]
              : [])
        ],
    sourceModified: false
  });
  const breakpoints = breakpointResponse.body?.breakpoints ?? [];
  const breakpoint = breakpoints[0];
  if (!pause) {
    check(
      breakpoint?.verified === true,
      `Breakpoint was not verified: ${JSON.stringify(breakpoint)}`
    );
  }
  if (multipleBreakpoints || distantBreakpoints) {
    check(
      breakpoints.length === 2 && breakpoints.every(item => item.verified),
      `Multiple breakpoints were not verified: ${JSON.stringify(breakpoints)}`
    );
  }
  await dap('configurationDone');
  await attach;

  if (pause) {
    await dap('pause', { threadId: 0 });
    const stopped = await stack('pause');
    const frame = stopped.frames[0];
    check(
      frame.name.includes(guest.functionName) &&
        frame.source?.path === sourcePath,
      `Unexpected paused frame: ${JSON.stringify(frame)}`
    );
    log({
      milestone: 'pause-stack',
      frame: { name: frame.name, line: frame.line }
    });
    const continueResponse = dap('continue', { threadId: stopped.threadId });
    const exited = await waitEvent('exited', () => true, 30_000);
    await continueResponse;
    check(
      exited.body?.exitCode === guest.exitCode,
      `Expected exit code ${guest.exitCode}, got ${exited.body?.exitCode}.`
    );
    return {
      ok: true,
      probe,
      frame: { name: frame.name, line: frame.line },
      exitCode: exited.body.exitCode
    };
  }

  const first = await stack('breakpoint');
  const firstFrame = first.frames[0];
  check(
    firstFrame.name.includes(guest.functionName),
    `Unexpected first frame: ${JSON.stringify(firstFrame)}`
  );
  check(
    firstFrame.line === guest.breakpointLine,
    `Expected line ${guest.breakpointLine}, got ${firstFrame.line}.`
  );
  if (probe === 'continue-first') {
    const continueResponse = dap('continue', { threadId: first.threadId });
    const exited = await waitEvent('exited', () => true, 30_000);
    await continueResponse;
    return { ok: true, probe, exitCode: exited.body?.exitCode };
  }
  let before = {};
  if (probe !== 'next-first' && probe !== 'instruction-first') {
    const variableNames = Object.keys(guest.variablesBefore);
    const repl = await dap('evaluate', {
      expression: `frame variable ${variableNames.join(' ')}`,
      context: 'repl',
      frameId: firstFrame.id
    });
    check(
      variableNames.every(name => repl.body?.result?.includes(name)),
      'DAP REPL command returned unexpected output: ' +
        JSON.stringify(repl.body)
    );
    before = await variables(firstFrame.id);
    for (const [name, value] of Object.entries(guest.variablesBefore)) {
      check(
        before[name] === value,
        `Expected ${name}=${value}, got ${before[name]}.`
      );
    }
    log({
      milestone: 'breakpoint-and-variables',
      frame: firstFrame,
      variables: before
    });
  }

  if (multipleBreakpoints || distantBreakpoints) {
    const continueResponse = dap('continue', { threadId: first.threadId });
    const second = await stack('breakpoint');
    await continueResponse;
    const secondFrame = second.frames[0];
    const expectedLine = multipleBreakpoints ? guest.stepLine : 2;
    const expectedName = multipleBreakpoints ? guest.functionName : 'add';
    check(
      secondFrame.line === expectedLine &&
        secondFrame.name.includes(expectedName),
      `Unexpected second breakpoint frame: ${JSON.stringify(secondFrame)}`
    );
    const exitResponse = dap('continue', { threadId: second.threadId });
    const exited = await waitEvent('exited', () => true, 30_000);
    await exitResponse;
    check(
      exited.body?.exitCode === guest.exitCode,
      `Expected exit code ${guest.exitCode}, got ${exited.body?.exitCode}.`
    );
    return {
      ok: true,
      probe,
      first: { name: firstFrame.name, line: firstFrame.line },
      second: { name: secondFrame.name, line: secondFrame.line },
      exitCode: exited.body.exitCode
    };
  }

  if (stepInOut) {
    const stepInResponse = dap('stepIn', { threadId: first.threadId });
    const inside = await stack('step');
    await stepInResponse;
    const insideFrame = inside.frames[0];
    check(
      insideFrame.name.includes('add') && insideFrame.line === 2,
      `Unexpected Step Into frame: ${JSON.stringify(insideFrame)}`
    );
    const insideVariables = await variables(insideFrame.id);
    check(
      insideVariables.left === '7' && insideVariables.right === '4',
      `Unexpected Step Into variables: ${JSON.stringify(insideVariables)}`
    );

    const stepOutResponse = dap('stepOut', { threadId: inside.threadId });
    const outside = await stack('step');
    await stepOutResponse;
    const outsideFrame = outside.frames[0];
    check(
      outsideFrame.name.includes(guest.functionName) &&
        outsideFrame.line === guest.breakpointLine,
      `Unexpected Step Out frame: ${JSON.stringify(outsideFrame)}`
    );

    const nextResponse = dap('next', { threadId: outside.threadId });
    const afterCall = await stack('step');
    await nextResponse;
    const afterCallFrame = afterCall.frames[0];
    check(
      afterCallFrame.name.includes(guest.functionName) &&
        afterCallFrame.line === guest.stepLine,
      `Unexpected post-Step-Out frame: ${JSON.stringify(afterCallFrame)}`
    );
    const afterCallVariables = await variables(afterCallFrame.id);
    check(
      afterCallVariables.sum === '11',
      `Unexpected post-Step-Out variables: ${JSON.stringify(afterCallVariables)}`
    );

    const continueResponse = dap('continue', { threadId: afterCall.threadId });
    const exited = await waitEvent('exited', () => true, 30_000);
    await continueResponse;
    check(
      exited.body?.exitCode === guest.exitCode,
      `Expected exit code ${guest.exitCode}, got ${exited.body?.exitCode}.`
    );
    return {
      ok: true,
      probe,
      inside: {
        name: insideFrame.name,
        line: insideFrame.line,
        variables: insideVariables
      },
      outside: {
        name: outsideFrame.name,
        line: outsideFrame.line
      },
      afterCall: {
        name: afterCallFrame.name,
        line: afterCallFrame.line,
        variables: afterCallVariables
      },
      exitCode: exited.body.exitCode
    };
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
  check(
    secondFrame.line === guest.stepLine,
    `Expected line ${guest.stepLine}, got ${secondFrame.line}.`
  );
  const after = await variables(secondFrame.id);
  for (const [name, value] of Object.entries(guest.variablesAfter)) {
    check(
      after[name] === value,
      `Expected ${name}=${value}, got ${after[name]}.`
    );
  }
  log({ milestone: 'step-over', frame: secondFrame, variables: after });

  const continueResponse = dap('continue', { threadId: second.threadId });
  const exited = await waitEvent('exited', () => true, 30_000);
  await continueResponse;
  check(
    exited.body?.exitCode === guest.exitCode,
    `Expected exit code ${guest.exitCode}, got ${exited.body?.exitCode}.`
  );
  if (guest.stdout !== undefined) {
    const stdout = nativeString('wasmbolt_wasi_stdout');
    check(
      stdout === guest.stdout,
      `Expected stdout ${JSON.stringify(guest.stdout)}, got ${JSON.stringify(stdout)}.`
    );
  }
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
