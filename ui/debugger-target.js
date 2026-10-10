// Shared target picker; the debugger adapter owns compilation and session state.
export function updateDebuggerTarget(files, source, program = '', builtFrom = '') {
  const target = document.querySelector('#debugger-target');
  const programs = files.filter(path => /\.wasm$/i.test(path));
  const listed = [...target.options].slice(1).map(option => option.value);
  if (programs.join('\n') !== listed.join('\n')) {
    const selected = target.value;
    target.replaceChildren(new Option('Build current source', ''),
      ...programs.map(path => new Option(path.replace('/workspace/', ''), path)));
    if (programs.includes(selected)) target.value = selected;
  }
  document.querySelector('#debugger-program').textContent = program
    ? `Program: ${program}${builtFrom ? ` (built from ${builtFrom.replace('/workspace/', '')})` : ''}`
    : target.value ? `Program: ${target.value}`
    : `Start builds ${source.replace('/workspace/', '')} → /workspace/debug.wasm with debug information.`;
}
