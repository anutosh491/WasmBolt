import { createClangd } from './client.js';

export function installClangd(host) {
  const editor = document.querySelector('#source');
  const pane = document.querySelector('.source-pane');
  const toolbar = document.createElement('div');
  toolbar.className = 'clangd-toolbar';
  toolbar.innerHTML = '<button id="clangd-enable" class="quiet" aria-pressed="false">Enable clangd</button>' +
    '<button id="clangd-problems" class="quiet" title="Clangd errors and warnings. Click to view; F8 next, Shift+F8 previous." hidden>No errors or warnings</button>' +
    '<span id="clangd-hint">C/C++ completion, diagnostics and definitions</span>';
  pane.append(toolbar);
  const results = document.createElement('div');
  results.id = 'clangd-results'; results.hidden = true; results.tabIndex = -1;
  pane.append(results);
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = new URL('./style.css', import.meta.url).href;
  document.head.append(link);
  const enable = toolbar.querySelector('#clangd-enable');
  const problems = toolbar.querySelector('#clangd-problems');
  const hint = toolbar.querySelector('#clangd-hint');
  let enabled = false, timer, issues = [], selected = 0, lastState;
  const cSource = () => ['c', 'cpp'].includes(host.source().language);
  function setState(state, message, analysis = 'idle') {
    lastState = { state, message, analysis };
    if (!enabled) return;
    toolbar.dataset.state = state;
    toolbar.dataset.analysis = analysis;
    enable.textContent = state === 'error' ? 'Retry clangd' : 'Disable clangd';
    enable.setAttribute('aria-pressed', String(state !== 'error'));
    hint.textContent = state === 'ready' ? message || 'Tab accept · Ctrl+Space suggest · F8 error · F12 definition' : message;
  }
  const client = createClangd(host, diagnostics => {
    issues = diagnostics;
    const errors = issues.filter(issue => issue.severity === 1).length;
    const warnings = issues.filter(issue => issue.severity === 2).length;
    problems.textContent = errors || warnings
      ? `${errors} error${errors === 1 ? '' : 's'} · ${warnings} warning${warnings === 1 ? '' : 's'}`
      : 'No errors or warnings';
    problems.dataset.errors = String(errors);
    problems.hidden = !enabled || !cSource();
  }, setState);
  const close = () => { results.hidden = true; results.replaceChildren(); };
  function placeResults() {
    // Measure with the editor's font so tabs and Unicode match the caret.
    const style = getComputedStyle(editor), bounds = pane.getBoundingClientRect();
    const rect = editor.getBoundingClientRect(), mirror = document.createElement('div');
    Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', whiteSpace: 'pre',
      left: '0', top: '0', font: style.font, letterSpacing: style.letterSpacing, tabSize: style.tabSize });
    mirror.textContent = editor.value.slice(0, editor.selectionStart);
    const caret = document.createElement('span'); caret.textContent = '\u200b';
    mirror.append(caret); document.body.append(mirror);
    const x = rect.left - bounds.left + parseFloat(style.paddingLeft) + caret.offsetLeft - editor.scrollLeft;
    const y = rect.top - bounds.top + parseFloat(style.paddingTop) + caret.offsetTop - editor.scrollTop;
    mirror.remove();
    const lineHeight = parseFloat(style.lineHeight), left = rect.left - bounds.left;
    const top = rect.top - bounds.top, bottom = rect.bottom - bounds.top;
    if (y + lineHeight < top || y > bottom || x < left || x > left + rect.width) { close(); return; }
    const below = Math.max(0, bottom - y - lineHeight - 8), above = Math.max(0, y - top - 8);
    results.style.width = `${Math.min(420, rect.width - 12)}px`;
    const upwards = below < Math.min(245, results.scrollHeight) && above > below;
    results.style.maxHeight = `${Math.min(245, upwards ? above : below)}px`;
    results.style.left = `${Math.max(left + 6, Math.min(x, left + rect.width - results.offsetWidth - 6))}px`;
    results.style.top = `${upwards ? y - results.offsetHeight - 4 : y + lineHeight + 4}px`;
  }
  async function sync() {
    clearTimeout(timer);
    if (!enabled) return;
    hint.hidden = !cSource(); problems.hidden = !cSource();
    try { await client.sync(); } catch (error) {
      if (enabled && error.name !== 'AbortError') hint.textContent = error.message;
    }
  }
  async function start() {
    enabled = true;
    if (lastState) setState(lastState.state, lastState.message, lastState.analysis);
    await sync();
  }
  enable.addEventListener('click', () => {
    if (!enabled || lastState?.state === 'error') { void start(); return; }
    enabled = false; clearTimeout(timer); close();
    client.stop(); issues = []; lastState = null;
    toolbar.dataset.state = 'disabled';
    enable.textContent = 'Enable clangd'; enable.setAttribute('aria-pressed', 'false');
    problems.hidden = true;
    hint.textContent = 'C/C++ completion, diagnostics and definitions';
  });
  function position(text, offset) {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length - 1, character: before.at(-1).length };
  }
  function offset(text, position) {
    const lines = text.split('\n');
    return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
  }
  function jump(range) {
    const begin = offset(editor.value, range.start), end = offset(editor.value, range.end);
    editor.focus(); editor.setSelectionRange(begin, end);
    editor.scrollTop = Math.max(0, (range.start.line - 4) * parseFloat(getComputedStyle(editor).lineHeight));
    editor.dispatchEvent(new Event('scroll')); close();
  }
  function choose(index) {
    const buttons = results.querySelectorAll('button');
    if (!buttons.length) return;
    selected = (index + buttons.length) % buttons.length;
    buttons.forEach((button, i) => button.classList.toggle('selected', i === selected));
    buttons[selected].scrollIntoView({ block: 'nearest' });
  }
  function show(items, label, action, kind = 'completion') {
    results.replaceChildren(); results.setAttribute('aria-label', label);
    results.dataset.kind = kind;
    for (const item of items.slice(0, 60)) {
      const button = document.createElement('button');
      button.textContent = item.label; button.title = item.detail || item.label;
      button.addEventListener('click', () => { close(); action(item); });
      results.append(button);
    }
    if (!items.length) results.textContent = toolbar.dataset.analysis === 'idle'
      ? 'No results.' : 'Parsing headers. Try completion when clangd is ready.';
    results.hidden = false; editor.focus(); placeResults(); choose(0);
  }
  function showDiagnostic(issue) {
    jump(issue.range);
    const severity = { 1: 'Error', 2: 'Warning', 3: 'Information', 4: 'Hint' }[issue.severity] || 'Diagnostic';
    results.dataset.kind = 'diagnostic';
    results.setAttribute('aria-label', 'Clangd diagnostic');
    results.textContent = `${severity}: ${issue.message}`;
    results.hidden = false; placeResults();
  }
  function nextDiagnostic(direction) {
    const sorted = [...issues].sort((a, b) => offset(editor.value, a.range.start) - offset(editor.value, b.range.start));
    if (!sorted.length) { hint.textContent = 'No errors or warnings in this file.'; close(); return; }
    const cursor = editor.selectionStart;
    const issue = direction > 0
      ? sorted.find(issue => offset(editor.value, issue.range.start) > cursor) || sorted[0]
      : sorted.findLast(issue => offset(editor.value, issue.range.start) < cursor) || sorted.at(-1);
    showDiagnostic(issue);
  }
  function complete(item, text, cursor) {
    const word = /[A-Za-z_0-9]*$/.exec(text.slice(0, cursor))[0];
    const main = item.textEdit || { newText: item.insertText || item.label.trim(),
      range: { start: position(text, cursor - word.length), end: position(text, cursor) } };
    const edits = [main, ...(item.additionalTextEdits || [])].map(edit => ({
      start: offset(text, (edit.range || edit.replace).start),
      end: offset(text, (edit.range || edit.replace).end), text: edit.newText,
    }));
    let next = edits[0].start + edits[0].text.length;
    for (const edit of edits.slice(1)) {
      if (edit.end <= edits[0].start) next += edit.text.length - (edit.end - edit.start);
    }
    for (const edit of edits.sort((a, b) => b.start - a.start))
      editor.setRangeText(edit.text, edit.start, edit.end);
    editor.setSelectionRange(next, next); editor.focus();
    editor.dispatchEvent(new Event('input'));
  }
  async function perform(method) {
    if (!enabled || !cSource()) return;
    const source = host.source(), cursor = editor.selectionStart;
    try {
      const document = await client.sync();
      if (!document) return;
      const value = await client.request(`textDocument/${method}`, {
        textDocument: { uri: document.uri }, position: position(source.text, cursor),
        ...(method === 'completion' ? { context: { triggerKind: 1 } } : {}),
      });
      const current = host.source();
      if (!enabled || current.path !== source.path || current.text !== source.text || editor.selectionStart !== cursor) return;
      if (method === 'completion') {
        const items = (Array.isArray(value) ? value : value?.items || [])
          .sort((a, b) => (a.sortText || a.label).localeCompare(b.sortText || b.label));
        show(items, 'Code completion', item => complete(item, source.text, cursor));
      } else if (method === 'hover') {
        close(); const contents = value?.contents;
        results.dataset.kind = 'hover';
        results.textContent = typeof contents === 'string' ? contents : contents?.value || 'No type information.';
        results.hidden = false; placeResults();
      } else {
        const locations = Array.isArray(value) ? value : value ? [value] : [];
        const location = locations[0];
        if (!location) { hint.textContent = 'No definition found.'; return; }
        const path = decodeURIComponent(new URL(location.uri || location.targetUri).pathname);
        const range = location.range || location.targetSelectionRange;
        if (path.startsWith('/workspace/')) { host.open(path); jump(range); }
        else hint.textContent = `Definition: ${path}:${range.start.line + 1}`;
      }
    } catch (error) {
      if (enabled && error.name !== 'AbortError') hint.textContent = error.message;
    }
  }
  problems.addEventListener('click', () => show(issues.map(issue => ({ ...issue,
    label: `${issue.range.start.line + 1}:${issue.range.start.character + 1} ${issue.message}`,
  })), 'Source diagnostics', showDiagnostic, 'diagnostics'));
  editor.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'F8' && enabled && cSource()) {
      event.preventDefault(); clearTimeout(timer); nextDiagnostic(event.shiftKey ? -1 : 1); return;
    }
    const acceptTab = event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
      && results.dataset.kind === 'completion';
    if (!results.hidden && results.querySelector('button') && (acceptTab || ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key))) {
      event.preventDefault();
      if (acceptTab || event.key === 'Enter') results.querySelectorAll('button')[selected]?.click();
      else choose(selected + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'].includes(event.key)) close();
    const method = event.ctrlKey && event.code === 'Space' ? 'completion'
      : event.key === 'F12' ? 'definition' : event.shiftKey && event.key === 'F1' ? 'hover' : null;
    if (method && enabled && cSource()) { event.preventDefault(); void perform(method); }
  });
  editor.addEventListener('scroll', () => { if (!results.hidden) placeResults(); });
  new ResizeObserver(() => { if (!results.hidden) placeResults(); }).observe(pane);
  editor.addEventListener('input', () => {
    close(); clearTimeout(timer);
    if (enabled) timer = setTimeout(async () => {
      await sync();
      if (!enabled) return;
      const before = editor.value.slice(0, editor.selectionStart);
      if (/(?:\.|->|::)[A-Za-z_0-9]*$/.test(before) || /\b[A-Za-z_][A-Za-z_0-9]{1,}$/.test(before))
        void perform('completion');
    }, 200);
  });
  for (const selector of ['#language', '#target'])
    document.querySelector(selector).addEventListener('change', () => { close(); void sync(); });
  document.querySelector('#reset-source').addEventListener('click', () => { close(); void sync(); });
  new MutationObserver(() => { close(); void sync(); })
    .observe(document.querySelector('#filename'), { childList: true });
  document.addEventListener('pointerdown', event => {
    if (!results.contains(event.target) && !toolbar.contains(event.target)) close();
  });
  if (new URLSearchParams(location.search).get('clangd') === '1') void start();
}
