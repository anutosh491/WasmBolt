import { DebuggerClient, preloadDebugger } from './client.js';
import { updateDebuggerTarget } from '../../ui/debugger-target.js';

const $ = selector => document.querySelector(selector);
const libraries = ['standalonewasm-nocatch', 'stubs-debug', 'c-debug', 'dlmalloc-debug',
  'clang_rt.builtins', 'c++-debug-noexcept', 'c++abi-debug-noexcept'];
let runtimeState = 'idle', runtimeError = '';
const readyNotice = 'LLDB ready. Choose a debug target, set breakpoints, then Start.';
export const workspaceExampleNames = ['snippet.cpp', 'simple.cpp', 'simple.c', 'json.cpp', 'debug.ll', 'input.mlir'];
export async function loadWorkspaceExamples() {
  const response = await fetch(new URL('./workspace-examples.json', import.meta.url));
  if (response.status === 404) return {};
  if (!response.ok) throw new Error('Workspace examples could not load');
  return response.json();
}

// Also works while the compiler is still loading, before the adapter is installed.
export async function prepareDebugger() {
  if (!crossOriginIsolated) return;
  const notice = $('.debugger-notice');
  const idle = () => !$('#debugger-panel').dataset.state || $('#debugger-panel').dataset.state === 'idle';
  runtimeState = 'loading';
  if (idle()) notice.textContent = 'Loading LLDB once for this page…';
  try {
    await preloadDebugger();
    runtimeState = 'ready';
    if (idle()) notice.textContent = readyNotice;
  } catch (error) {
    runtimeState = 'error'; runtimeError = error.message;
    if (idle()) notice.textContent = `${runtimeError}. Reopen the panel to retry.`;
  }
}

export async function installDebugger(host) {
  let client = null, phase = 'idle', threadId = 1, frameId = null, revision = 0;
  let installing = null, commandBusy = false, session = 0, launchSource = '', launchProgram = null;
  let launchFiles = null, launchLanguage = '';
  const target = $('#debugger-target');
  const notice = $('.debugger-notice');
  const log = text => {
    $('#debugger-log').append(`${text}\n`);
    $('#debugger-log').scrollTop = $('#debugger-log').scrollHeight;
  };
  const clearFrames = () => {
    $('#debugger-frames').textContent = 'No paused frames.';
    $('#debugger-variables').textContent = 'No paused variables.';
    host.location(null);
    frameId = null;
  };
  const available = () => crossOriginIsolated && !host.busy() && (target.value ||
    (host.arch() === 'wasm32' && host.target() === 'wasm32-unknown-emscripten' && ['c', 'cpp', 'llvm'].includes(host.language())));
  function update() {
    updateDebuggerTarget(host.files(), host.sourceName(),
      (client || phase === 'starting') ? launchProgram || '/workspace/debug.wasm' : '', launchSource);
    target.disabled = !!client || phase === 'starting' || host.busy();
    $('#debugger-panel').dataset.state = phase;
    $('#debugger-start').disabled = !available() || runtimeState !== 'ready' || ['starting', 'running', 'stopped'].includes(phase);
    for (const name of ['continue', 'step-over', 'step-in', 'step-out'])
      $(`#debugger-${name}`).disabled = phase !== 'stopped' || commandBusy;
    $('#debugger-pause').disabled = phase !== 'running' || commandBusy;
    $('#debugger-stop').disabled = !client;
    $('#debugger-restart').disabled = !client || phase === 'starting' || host.busy();
    $('#debugger-command').disabled = !client || !['stopped', 'running'].includes(phase) || commandBusy;
    $('#debugger-command').placeholder = 'LLDB command (prefix with `), e.g. `thread backtrace';
    if (phase === 'idle') notice.textContent = !crossOriginIsolated
      ? 'Debugger needs HTTPS (or localhost) with COOP/COEP headers.'
      : runtimeState === 'ready' ? readyNotice
      : runtimeState === 'error' ? `${runtimeError}. Reopen the panel to retry.`
      : 'Loading LLDB once for this page…';
  }
  function state(value, message) {
    phase = value;
    notice.textContent = message;
    if (value !== 'stopped') { revision++; clearFrames(); }
    update();
  }
  function variableRow(variable, generation) {
    const expandable = variable.variablesReference > 0;
    const row = document.createElement(expandable ? 'details' : 'div');
    const label = expandable ? row.appendChild(document.createElement('summary')) : row;
    label.className = 'debugger-variable';
    label.textContent = `${variable.name}  ${variable.type || ''}  ${variable.value}`;
    if (expandable) {
      const children = row.appendChild(document.createElement('div'));
      children.className = 'debugger-variable-children';
      let loaded = false;
      row.ontoggle = async () => {
        if (!row.open || loaded || generation !== revision || phase !== 'stopped') return;
        loaded = true;
        children.textContent = 'Loading…';
        try {
          const { variables = [] } = await client.request('variables', {
            variablesReference: variable.variablesReference,
          });
          if (generation !== revision || phase !== 'stopped') return;
          children.replaceChildren(...variables.map(child => variableRow(child, generation)));
          if (!variables.length) children.textContent = 'No fields available.';
        } catch (error) {
          if (generation !== revision || phase !== 'stopped') return;
          children.textContent = error.message;
          loaded = false;
        }
      };
    }
    return row;
  }
  async function selectFrame(frame, generation) {
    frameId = frame.id;
    host.location(frame.source?.path ? { path: frame.source.path, line: frame.line } : null);
    $('#debugger-variables').textContent = 'Loading variables…';
    const { scopes = [] } = await client.request('scopes', { frameId });
    const scope = scopes.find(item => item.name === 'Locals') || scopes[0];
    let { variables = [] } = scope ? await client.request('variables', { variablesReference: scope.variablesReference }) : {};
    if (generation !== revision || frameId !== frame.id || phase !== 'stopped') return;
    $('#debugger-variables').replaceChildren(...variables.map(variable => variableRow(variable, generation)));
    if (!variables.length) $('#debugger-variables').textContent = 'No variables in this frame.';
  }
  async function stopped(body) {
    threadId = body.threadId || 1;
    state('stopped', `Paused (${body.reason || 'breakpoint'})`);
    const generation = ++revision;
    const { stackFrames = [] } = await client.request('stackTrace', { threadId, startFrame: 0, levels: 30 });
    if (generation !== revision || phase !== 'stopped') return;
    $('#debugger-frames').replaceChildren(...stackFrames.map(frame => {
      const button = document.createElement('button');
      button.textContent = `${frame.name}  ${frame.source?.name || ''}:${frame.line || ''}`;
      button.title = button.textContent;
      button.onclick = () => selectFrame(frame, ++revision).catch(showError);
      return button;
    }));
    // Steps remain available even when LLDB cannot inspect a variable location.
    if (stackFrames.length) await selectFrame(stackFrames[0], generation);
  }
  function showError(error) { log(`Error: ${error.message}`); }
  function event(name, body) {
    if (name === 'loading') notice.textContent = body.message;
    else if (name === 'continued') state('running', 'Running');
    else if (name === 'stopped') stopped(body).catch(showError);
    else if (name === 'exited') { state('exited', `Exited with code ${body.exitCode}`); log(notice.textContent); }
    else if (name === 'breakpoints') {
      for (const breakpoint of body.breakpoints)
        if ((!launchSource || body.path === launchSource) && !breakpoint.verified) log(`Unresolved breakpoint ${body.path}:${breakpoint.line || '?'}: ${breakpoint.message || 'no executable location'}`);
    }
    else if (name === 'output') log((body.output || '').replace(/\n$/, ''));
    else if (name === 'fatal') { state('error', body.message); log(body.message); }
  }
  async function resources() {
    installing ||= (async () => {
      const manifest = await fetch(new URL('./guest-files.json', import.meta.url)).then(response => {
        if (!response.ok) throw new Error('Guest SDK is missing; run scripts/70-stage-site.py');
        return response.json();
      });
      await Promise.all(manifest.map(async ({ path, url }) => {
        const response = await fetch(new URL(url, import.meta.url));
        if (!response.ok) throw new Error(`Guest file download failed: ${path}`);
        host.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
        host.FS.writeFile(path, new Uint8Array(await response.arrayBuffer()));
      }));
    })().catch(error => { installing = null; throw error; });
    await installing;
  }
  async function start(restart = false) {
    if (restart ? (!launchFiles || host.busy()) : !available()) return;
    const program = restart ? launchProgram : target.value;
    if (!restart) {
      launchProgram = program || null;
      launchSource = program ? '' : host.sourceName();
      launchLanguage = host.language();
      launchFiles = null;
    }
    const generation = ++session;
    client?.close(); client = null;
    $('#debugger-log').textContent = '';
    state('starting', program ? `Starting ${program.split('/').pop()}…` : 'Building debug program (-O0 -g)…');
    try {
      if (!program) await resources();
      if (generation !== session) return;
      const settings = restart ? null : host.source();
      if (!program) {
        const source = settings.filename, cpp = launchLanguage === 'cpp';
        const includes = settings.llvmIr ? '' : '-isystem /include/wasm32-emscripten/c++/v1 -isystem /include/c++/v1 -isystem /include/wasm32-emscripten -isystem /include';
        await host.run(`${cpp ? 'clang++' : 'clang'} --target=wasm32-unknown-emscripten --sysroot=/ -resource-dir=${host.resourceDir()} -Xclang -iwithsysroot/include/compat ${includes} -x ${settings.llvmIr ? 'ir' : cpp ? 'c++' : 'c'} ${settings.llvmIr ? '' : settings.standard} -fno-color-diagnostics -fignore-exceptions -mno-reference-types -mno-tail-call -O0 -g -gdwarf-4 -c ${source} -o /workspace/debug.o`);
        await host.run(`wasm-ld /workspace/debug.o /lib/wasm32-emscripten/crt1.o -L/lib/wasm32-emscripten ${libraries.map(name => `-l${name}`).join(' ')} -o /workspace/debug.wasm`);
      }
      if (generation !== session) return;
      host.refresh();
      launchProgram = program || '/workspace/debug.wasm';
      launchFiles ||= host.files().map(path => ({ path, bytes: host.FS.readFile(path) }));
      const breakpoints = [...host.breakpoints()].map(([path, lines]) => ({ path, lines: [...lines] }));
      client = new DebuggerClient(event);
      await client.request('start', { files: launchFiles, program: launchProgram, breakpoints });
    } catch (error) {
      if (generation !== session) return;
      client?.close(); client = null;
      state('error', 'Debug start failed'); showError(error);
    }
    update();
  }
  $('#debugger-start').onclick = () => start();
  $('#debugger-restart').onclick = () => start(true);
  $('#debugger-stop').onclick = () => {
    session++; client?.close(); client = null; launchFiles = null; state('idle', 'Debugger stopped');
  };
  for (const [name, command] of Object.entries({ continue: 'continue', 'step-over': 'next', 'step-in': 'stepIn', 'step-out': 'stepOut', pause: 'pause' })) {
    $(`#debugger-${name}`).onclick = async () => {
      if (commandBusy) return;
      commandBusy = true; update();
      try { await client.request(command, { threadId }); }
      catch (error) { if (phase !== 'exited') showError(error); }
      finally { commandBusy = false; update(); }
    };
  }
  $('#debugger-command').onkeydown = async event => {
    if (event.key !== 'Enter' || commandBusy) return;
    const input = event.target, expression = input.value.trim();
    if (!expression) return;
    input.value = ''; log(`(lldb) ${expression}`);
    commandBusy = true; update();
    try {
      const { result } = await client.request('evaluate', { expression, context: 'repl', ...(frameId === null ? {} : { frameId }) });
      if (result) log(result.replace(/\n$/, ''));
    } catch (error) { showError(error); }
    finally { commandBusy = false; update(); }
  };
  host.refresh(); update();
  return {
    update,
    async preload() { await prepareDebugger(); update(); },
    syncBreakpoints(path, lines) {
      if (client && phase === 'stopped') {
        commandBusy = true; update();
        client.request('setBreakpoints', { source: { path }, breakpoints: lines.map(line => ({ line })) })
          .catch(showError).finally(() => { commandBusy = false; update(); });
      }
    },
  };
}
