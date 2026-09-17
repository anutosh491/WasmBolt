import { MessageLoop } from '@lumino/messaging';
import { SplitPanel, TabPanel, Widget } from '@lumino/widgets';

import { initial, snapshot } from '../model';
import type { Area } from '../model';
import { session } from '../persistence';
import { PanePanel } from '../ui/panels';

function views() {
  return {
    source: new Widget(),
    outputs: new Widget(),
    diagnostics: new Widget(),
    files: new Widget(),
    terminal: new Widget(),
    run: new Widget(),
    pipelines: new Widget(),
    comparison: new Widget()
  };
}

it('restores saved splits and tab groups and reveals inactive panes', () => {
  const panes = views();
  const changed = jest.fn();
  const area: Area = {
    type: 'split-area',
    orientation: 'horizontal',
    sizes: [0.3, 0.7],
    children: [
      {
        type: 'tab-area',
        widgets: ['outputs', 'source'],
        currentIndex: 0
      },
      { type: 'tab-area', widgets: ['diagnostics'], currentIndex: 0 }
    ]
  };
  const panel = new PanePanel(panes, area, changed);
  expect(panel.save()).toEqual(area);
  expect(panes.source.isHidden).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  panel.activatePane('source');
  expect(panes.source.isHidden).toBe(false);
  expect(panes.outputs.isHidden).toBe(true);
  expect(panel.save()).toEqual({
    ...area,
    children: [{ ...area.children[0], currentIndex: 1 }, area.children[1]]
  });
  expect(changed).toHaveBeenCalledTimes(1);
  panel.dispose();
  expect(Object.values(panes).every(pane => pane.isDisposed)).toBe(true);
  expect(changed).toHaveBeenCalledTimes(1);
});

it('resets containers while retaining views and saving once', () => {
  const panes = views();
  const changes: Area[] = [];
  const panel = new PanePanel(
    panes,
    {
      type: 'tab-area',
      widgets: ['outputs', 'source', 'diagnostics'],
      currentIndex: 0
    },
    () => changes.push(panel.save())
  );
  const previous = panel.widgets[0];
  panel.reset();
  expect(previous.isDisposed).toBe(true);
  expect(changes).toEqual([panel.save()]);
  expect(panel.save().type).toBe('split-area');
  expect(panes.source.isHidden).toBe(false);
  expect(panes.source.node.hasAttribute('role')).toBe(false);
  expect(panes.source.node.hasAttribute('aria-labelledby')).toBe(false);
  expect(panes.outputs.isHidden).toBe(false);
  for (const pane of Object.values(panes)) {
    expect(pane.isDisposed).toBe(false);
    if (pane !== panes.comparison) {
      expect(panel.contains(pane)).toBe(true);
    }
  }
  panel.dispose();
  expect(changes).toHaveLength(1);
});

it('preserves pane proportions while the host restores its size', () => {
  const panel = new PanePanel(
    views(),
    {
      type: 'split-area',
      orientation: 'horizontal',
      sizes: [0.3, 0.7],
      children: [
        { type: 'tab-area', widgets: ['source'], currentIndex: 0 },
        {
          type: 'tab-area',
          widgets: ['outputs', 'diagnostics'],
          currentIndex: 0
        }
      ]
    },
    () => {}
  );
  const split = panel.widgets[0];
  if (!(split instanceof SplitPanel)) {
    throw new Error('Expected a split panel.');
  }
  Widget.attach(panel, document.body);
  try {
    // Jupyter can attach the workbench before restoring its sidebars.
    MessageLoop.sendMessage(split, new Widget.ResizeMessage(1200, 600));
    MessageLoop.sendMessage(split, new Widget.ResizeMessage(950, 600));
    expect(split.relativeSizes()[0]).toBeCloseTo(0.3);
    MessageLoop.sendMessage(split, new Widget.ResizeMessage(1200, 600));
    expect(split.relativeSizes()[0]).toBeCloseTo(0.3);
  } finally {
    panel.dispose();
  }
});

it('restores and resets a sole output group, retaining its views', () => {
  const panes = views();
  const area: Area = {
    type: 'tab-area',
    widgets: ['outputs'],
    currentIndex: 0
  };
  const panel = new PanePanel(panes, area, () => {});
  expect(panel.widgets[0]).toBe(panes.outputs);
  expect(panel.save()).toEqual(area);
  panel.compare();
  expect(panel.contains(panes.outputs)).toBe(true);
  expect(panel.contains(panes.comparison)).toBe(true);
  panel.compare();
  expect(panel.save()).toEqual(area);
  panel.reset();
  expect(panes.outputs.isDisposed).toBe(false);
  expect(panel.contains(panes.outputs)).toBe(true);
  panel.dispose();
  expect(Object.values(panes).every(pane => pane.isDisposed)).toBe(true);
});

it('folds tools without losing split proportions or the source view', () => {
  const panes = views();
  const panel = new PanePanel(panes, null, () => {});
  const closed = panel.save();
  expect(panes.diagnostics.isHidden).toBe(true);
  panel.activatePane('diagnostics');
  expect(panes.diagnostics.isHidden).toBe(false);
  expect(panel.save()).toMatchObject({ sizes: [0.75, 0.25] });
  const tools = panes.diagnostics.parent?.parent;
  if (!(tools instanceof TabPanel)) {
    throw new Error('Expected the tools tab panel.');
  }
  tools.currentIndex = -1;
  expect(panel.save()).toEqual(closed);
  panel.compare();
  panel.compare();
  expect(panel.save()).toEqual(closed);
  expect(panes.source.isDisposed).toBe(false);
  panel.dispose();
});

it('restores collapsed tools but rejects a collapsed source area', () => {
  const panel = new PanePanel(views(), null, () => {});
  const saved = { ...snapshot(initial()), layout: panel.save() };
  expect(session(saved)).toEqual(saved);
  expect(
    session({
      ...saved,
      layout: {
        type: 'tab-area',
        widgets: [
          'source',
          'outputs',
          'diagnostics',
          'run',
          'files',
          'terminal',
          'pipelines'
        ],
        currentIndex: -1
      }
    })
  ).toBeNull();
  panel.dispose();
});
