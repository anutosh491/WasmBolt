export function configureResizers() {
  const workspace = document.querySelector('#workspace');
  const advanced = document.querySelector('#advanced');
  const toggle = document.querySelector('#toggle-explorer');
  let explorerWidth = 180;
  let expandedHeight = 260;
  const railWidth = () => document.querySelector('#activity-bar').getBoundingClientRect().width;
  const collapsed = (panel, value) => workspace.toggleAttribute(`data-${panel}-collapsed`, value);
  const snap = (value, maximum) => value < 24 ? 0 : value > maximum - 24 ? maximum : value;

  const setExplorer = (width) => {
    width = Math.max(0, Math.min(workspace.clientWidth - railWidth() - 10, width));
    if (width) explorerWidth = width;
    workspace.style.setProperty('--explorer-width', `${width}px`);
    collapsed('explorer', !width);
    toggle.setAttribute('aria-expanded', String(Boolean(width)));
  };
  const setSource = (width) => {
    const available = workspace.clientWidth - railWidth() - document.querySelector('.explorer').getBoundingClientRect().width - 10;
    const ratio = Math.max(0, Math.min(1, width / Math.max(1, available)));
    workspace.style.setProperty('--source-ratio', String(ratio));
    collapsed('source', ratio === 0);
    collapsed('output', ratio === 1);
  };
  const setTerminal = (height) => {
    height = Math.max(0, Math.min(workspace.clientHeight - 8, height));
    if (advanced.open && height) expandedHeight = height;
    workspace.style.setProperty('--console-height', `${height}px`);
    collapsed('console', height === 0);
    collapsed('top', height === workspace.clientHeight - 8);
  };
  toggle.addEventListener('click', () => setExplorer(workspace.hasAttribute('data-explorer-collapsed') ? explorerWidth : 0));
  advanced.addEventListener('toggle', () => {
    if (!workspace.hasAttribute('data-console-collapsed'))
      setTerminal(advanced.open ? expandedHeight : 38);
  });
  setTerminal(advanced.open ? expandedHeight : 38);

  for (const [id, axis, read, write, restore] of [
    ['explorer-resizer', 'x', () => document.querySelector('.explorer').getBoundingClientRect().width, setExplorer, () => setExplorer(180)],
    ['vertical-resizer', 'x', () => document.querySelector('.source-pane').getBoundingClientRect().width, setSource, () => setSource((workspace.clientWidth - railWidth() - document.querySelector('.explorer').getBoundingClientRect().width - 10) * .46)],
    ['horizontal-resizer', 'y', () => advanced.getBoundingClientRect().height, setTerminal, () => { advanced.open = true; setTerminal(260); }],
  ]) {
    const handle = document.getElementById(id);
    handle.addEventListener('dblclick', restore);
    handle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); restore(); }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1;
      write(read() + direction * 24);
    });
    handle.addEventListener('pointerdown', (event) => {
      if (innerWidth <= 900 || event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      if (axis === 'y') advanced.open = true;
      const move = (event) => {
        const bounds = workspace.getBoundingClientRect();
        if (id === 'explorer-resizer') write(snap(event.clientX - bounds.left - railWidth(), bounds.width - railWidth() - 10));
        else if (axis === 'x') {
          const left = document.querySelector('.source-pane').getBoundingClientRect().left;
          write(snap(event.clientX - left, bounds.right - left - 5));
        } else write(snap(bounds.bottom - event.clientY - 4, bounds.height - 8));
      };
      const end = () => {
        handle.classList.remove('dragging');
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }
}
