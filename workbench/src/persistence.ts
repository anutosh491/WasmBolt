import { isOptions, isOutputKind, pipelines } from './compiler/types';
import { isTimeout } from './compiler/execution';
import { isRecord } from './compiler/protocol';
import { isToolArea } from './model';
import type { Area, Pane, Session } from './model';

export interface IPersistence {
  load(): Promise<unknown>;
  save(session: Session): Promise<void>;
}

const panes: readonly Pane[] = [
  'explorer',
  'source',
  'outputs',
  'diagnostics',
  'terminal',
  'debugger',
  'run',
  'pipelines'
];

/** Validate and migrate editing state without initializing the compiler. */
export function session(value: unknown): Session | null {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    typeof value.source !== 'string' ||
    !isRecord(value.options)
  ) {
    return null;
  }
  const legacy = value.version === 1;
  const options = legacy ? { ...pipelines, ...value.options } : value.options;
  if (!isOptions(options)) {
    return null;
  }
  const seen = new Set<Pane>();
  let layout =
    value.layout === null ? null : area(value.layout, seen, 0, legacy);
  if (
    value.layout !== null &&
    (!layout ||
      !(legacy ? ['source', 'outputs', 'diagnostics'] : panes).every(name =>
        [...seen].some(pane => pane === name)
      ))
  ) {
    return null;
  }
  if (legacy && layout) {
    layout = addUtilities(layout);
  }
  const outputs = legacy
    ? { primary: 'assembly', comparison: 'optimized' }
    : value.outputs;
  const timeout = legacy ? 10000 : value.timeout;
  if (
    !isRecord(outputs) ||
    !isOutputKind(outputs.primary) ||
    !isOutputKind(outputs.comparison) ||
    !isTimeout(timeout)
  ) {
    return null;
  }
  const savedDocuments = documents(value.documents);
  if (value.documents !== undefined && savedDocuments === null) {
    return null;
  }
  return {
    version: 2,
    source: value.source,
    documents: savedDocuments ?? undefined,
    activeFile:
      typeof value.activeFile === 'string' ? value.activeFile : undefined,
    options,
    layout,
    outputs: { primary: outputs.primary, comparison: outputs.comparison },
    timeout
  };
}

function documents(
  value: unknown
): readonly Readonly<{ path: string; source: string }>[] | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (
    !Array.isArray(value) ||
    !value.every(
      document =>
        isRecord(document) &&
        typeof document.path === 'string' &&
        document.path.startsWith('/workspace/') &&
        typeof document.source === 'string'
    )
  ) {
    return undefined;
  }
  return value.map(document => ({
    path: String(document.path),
    source: String(document.source)
  }));
}

function addUtilities(area: Area): Area {
  if (area.type === 'split-area') {
    return { ...area, children: area.children.map(addUtilities) };
  }
  return area.widgets.includes('diagnostics')
    ? {
        ...area,
        widgets: [
          ...area.widgets,
          'explorer',
          'terminal',
          'debugger',
          'run',
          'pipelines'
        ]
      }
    : area;
}

function pane(value: unknown, legacy: boolean): Pane | null {
  if (legacy) {
    return value === 'assembly'
      ? 'outputs'
      : value === 'source' || value === 'diagnostics'
        ? value
        : null;
  }
  if (value === 'files') {
    return 'explorer';
  }
  return [...panes, 'comparison' as const].find(pane => pane === value) ?? null;
}

function area(
  value: unknown,
  seen: Set<Pane>,
  depth: number,
  legacy: boolean
): Area | null {
  if (!isRecord(value) || depth > 8) {
    return null;
  }
  if (value.type === 'tab-area') {
    if (
      !Array.isArray(value.widgets) ||
      value.widgets.length === 0 ||
      typeof value.currentIndex !== 'number' ||
      !Number.isInteger(value.currentIndex) ||
      value.currentIndex < -1 ||
      value.currentIndex >= value.widgets.length
    ) {
      return null;
    }
    const widgets = value.widgets.map(value => pane(value, legacy));
    if (!widgets.every((value): value is Pane => value !== null)) {
      return null;
    }
    if (value.currentIndex === -1 && !isToolArea(widgets)) {
      return null;
    }
    for (const widget of widgets) {
      if (seen.has(widget)) {
        return null;
      }
      seen.add(widget);
    }
    return { type: 'tab-area', widgets, currentIndex: value.currentIndex };
  }
  if (
    value.type !== 'split-area' ||
    !['horizontal', 'vertical'].includes(String(value.orientation)) ||
    !Array.isArray(value.children) ||
    value.children.length < 2 ||
    value.children.length > panes.length + 1 ||
    !Array.isArray(value.sizes) ||
    value.sizes.length !== value.children.length ||
    !value.sizes.every(
      size => typeof size === 'number' && Number.isFinite(size) && size > 0
    )
  ) {
    return null;
  }
  const children = value.children.map(child =>
    area(child, seen, depth + 1, legacy)
  );
  if (!children.every((child): child is Area => child !== null)) {
    return null;
  }
  return {
    type: 'split-area',
    orientation: value.orientation === 'horizontal' ? 'horizontal' : 'vertical',
    children,
    sizes: value.sizes
  };
}
