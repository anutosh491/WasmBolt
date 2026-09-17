import { autocompletion } from '@codemirror/autocomplete';
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource
} from '@codemirror/autocomplete';
import { history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { openSearchPanel } from '@codemirror/search';
import { Compartment, EditorState, RangeSet } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  EditorView,
  gutter,
  GutterMarker,
  keymap
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import * as React from 'react';

import type { IClangdClient } from '../clangd/types';
import type { IStore } from '../state';
import { languageForPath, text, workspaceRoot } from '../workspace';
import { editorExtensions } from './codemirror';

interface IEditorProps {
  store: IStore;
  clangd: IClangdClient;
  path: string;
  onChange(source: string): void;
  onResetExample(): void;
  onToggleBreakpoint(line: number): void;
}

/** Own editor effects here; source text remains in the application store. */
export function Editor({
  store,
  clangd,
  path,
  onChange,
  onResetExample,
  onToggleBreakpoint
}: IEditorProps): React.ReactElement {
  const node = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  useEffect(() => {
    if (!node.current) {
      return;
    }
    let updating = false;
    let language = store.state.options.language;
    const documents = clangdDocuments(clangd, store);
    const dialect = new Compartment();
    const debugging = new Compartment();
    const extensions = () => (['c', 'cpp'].includes(language) ? cpp() : []);
    let position = store.state.position?.serial ?? 0;
    let debug = debugKey(store);
    const view = new EditorView({
      parent: node.current,
      state: EditorState.create({
        doc: store.state.source,
        extensions: [
          editorExtensions,
          dialect.of(extensions()),
          autocompletion({
            activateOnTyping: true,
            override: [documents.completions]
          }),
          debugging.of(debugExtensions(store, onToggleBreakpoint)),
          history(),
          drawSelection(),
          syntaxHighlighting(
            HighlightStyle.define([
              {
                tag: tags.keyword,
                color: 'var(--wasmbolt-accent)',
                fontWeight: '600'
              },
              {
                tag: [tags.string, tags.number, tags.bool],
                color: 'var(--wasmbolt-accent)'
              },
              {
                tag: tags.comment,
                color: 'var(--wasmbolt-muted)',
                fontStyle: 'italic'
              }
            ])
          ),
          keymap.of([...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({
            'aria-label': 'Source code',
            'aria-description': 'Press Escape, then Tab to leave the editor.'
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !updating) {
              onChange(update.state.doc.toString());
            }
          })
        ]
      })
    });
    editor.current = view;
    void documents.synchronize().catch(() => undefined);
    const unsubscribe = store.subscribe(() => {
      const state = store.state;
      void documents.synchronize().catch(() => undefined);
      if (state.options.language !== language) {
        language = state.options.language;
        view.dispatch({ effects: dialect.reconfigure(extensions()) });
      }
      if (state.source !== view.state.doc.toString()) {
        updating = true;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: state.source }
        });
        updating = false;
      }
      const nextDebug = debugKey(store);
      if (nextDebug !== debug) {
        debug = nextDebug;
        view.dispatch({
          effects: debugging.reconfigure(
            debugExtensions(store, onToggleBreakpoint)
          )
        });
      }
      if (state.position && state.position.serial !== position) {
        position = state.position.serial;
        const line = view.state.doc.line(
          Math.min(state.position.line, view.state.doc.lines)
        );
        let column = 0;
        let bytes = 0;
        const encoder = new TextEncoder();
        for (const character of line.text) {
          const length = encoder.encode(character).length;
          if (bytes + length > state.position.column - 1) {
            break;
          }
          bytes += length;
          column += character.length;
        }
        view.dispatch({
          selection: { anchor: line.from + column },
          scrollIntoView: true
        });
        view.focus();
      }
    });
    const observer = new ResizeObserver(() => view.requestMeasure());
    observer.observe(node.current);
    return () => {
      observer.disconnect();
      unsubscribe();
      documents.dispose();
      view.destroy();
      editor.current = null;
    };
  }, [store, clangd, onChange, onToggleBreakpoint]);
  return (
    <>
      <div className="wasmbolt-file-actions">
        <span>{path.slice(path.lastIndexOf('/') + 1)}</span>
        <button
          onClick={onResetExample}
          title="Replace source with this language's example (undo to restore)"
        >
          Reset example
        </button>
        <button
          title="Find in source (Ctrl/Cmd+F)"
          onClick={() => {
            if (editor.current) {
              openSearchPanel(editor.current);
            }
          }}
        >
          Find
        </button>
      </div>
      <div className="wasmbolt-editor" ref={node} />
    </>
  );
}

type ClangdDocuments = Readonly<{
  synchronize(): Promise<void>;
  completions: CompletionSource;
  dispose(): void;
}>;

const completionTypes = new Map<number, string>([
  [2, 'method'],
  [3, 'function'],
  [4, 'class'],
  [5, 'property'],
  [6, 'variable'],
  [7, 'class'],
  [8, 'interface'],
  [9, 'namespace'],
  [10, 'property'],
  [14, 'keyword'],
  [21, 'constant']
]);

/** Keep clangd lazy and synchronized without putting LSP state in React. */
function clangdDocuments(
  clangd: IClangdClient,
  store: IStore
): ClangdDocuments {
  let desired = '';
  const opened = new Map<string, string>();
  let task = Promise.resolve();
  let disposed = false;
  let lastError: string | null = null;

  const report = (error: unknown) => {
    const message = `clangd is unavailable: ${String(error)}`;
    if (message !== lastError && !disposed) {
      lastError = message;
      store.dispatch({ type: 'notice', message });
    }
  };

  const synchronize = (): Promise<void> => {
    const state = store.state;
    const supported =
      state.options.language === 'c' || state.options.language === 'cpp';
    const documents = supported
      ? state.files.flatMap(file => {
          if (!state.editableFiles.includes(file.path)) {
            return [];
          }
          const language = languageForPath(file.path);
          const source = text(file);
          return (language === 'c' || language === 'cpp') && source !== null
            ? [{ path: projectPath(file.path), source, language }]
            : [];
        })
      : [];
    const key = JSON.stringify(documents);
    if (key === desired) {
      return task;
    }
    desired = key;
    task = task
      .catch(() => undefined)
      .then(async () => {
        if (disposed) {
          return;
        }
        const paths = new Set(documents.map(document => document.path));
        for (const path of opened.keys()) {
          if (!paths.has(path)) {
            clangd.closeDocument(path);
            opened.delete(path);
          }
        }
        for (const document of documents) {
          if (opened.get(document.path) === document.source) {
            continue;
          }
          await clangd.openDocument(
            document.path,
            document.source,
            document.language
          );
          opened.set(document.path, document.source);
        }
        lastError = null;
      })
      .catch(error => {
        desired = '';
        report(error);
        throw error;
      });
    return task;
  };

  const completions = async (
    context: CompletionContext
  ): Promise<CompletionResult | null> => {
    const state = store.state;
    if (state.options.language !== 'c' && state.options.language !== 'cpp') {
      return null;
    }
    const line = context.state.doc.lineAt(context.pos);
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*$/);
    const trigger = context.state.sliceDoc(
      Math.max(0, context.pos - 1),
      context.pos
    );
    const triggerCharacter = ['.', '>', ':'].includes(trigger)
      ? trigger
      : undefined;
    if (!context.explicit && !word && !triggerCharacter) {
      return null;
    }
    const path = projectPath(state.activeFile);
    try {
      await synchronize();
      const result = await clangd.completion(
        path,
        {
          line: line.number - 1,
          character: context.pos - line.from
        },
        triggerCharacter
          ? { triggerKind: 2, triggerCharacter }
          : { triggerKind: 1 }
      );
      if (disposed || projectPath(store.state.activeFile) !== path) {
        return null;
      }
      return {
        from: word?.from ?? context.pos,
        options: result.items.map(completion),
        validFor: /^[A-Za-z0-9_:]*$/
      };
    } catch (error) {
      report(error);
      return null;
    }
  };

  return {
    synchronize,
    completions,
    dispose() {
      disposed = true;
      for (const path of opened.keys()) {
        clangd.closeDocument(path);
      }
      opened.clear();
    }
  };
}

function projectPath(path: string): string {
  const prefix = `${workspaceRoot}/`;
  if (!path.startsWith(prefix)) {
    throw new Error('clangd documents must be in the workspace.');
  }
  return path.slice(prefix.length);
}

function completion(item: {
  label: string;
  detail?: string;
  insertText?: string;
  kind?: number;
}): Completion {
  const apply = item.insertText ?? item.label;
  return {
    label: item.label,
    ...(item.detail ? { detail: item.detail } : {}),
    ...(apply === item.label ? {} : { apply }),
    ...(completionType(item.kind) ? { type: completionType(item.kind) } : {})
  };
}

function completionType(kind: number | undefined): string | undefined {
  return completionTypes.get(kind ?? 0);
}

class BreakpointMarker extends GutterMarker {
  constructor(private readonly verified: boolean | null) {
    super();
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className =
      this.verified === false
        ? 'wasmbolt-breakpoint wasmbolt-breakpoint-unverified'
        : 'wasmbolt-breakpoint';
    marker.title =
      this.verified === false ? 'Unverified breakpoint' : 'Breakpoint';
    return marker;
  }
}

function debugKey(store: IStore): string {
  const state = store.state;
  const frame = state.debugger.frames.find(
    frame => frame.id === state.debugger.frameId
  );
  return JSON.stringify([
    state.activeFile,
    frame?.path,
    frame?.line,
    state.debugger.breakpoints
  ]);
}

function debugExtensions(
  store: IStore,
  toggle: (line: number) => void
): Extension {
  const state = store.state;
  const path = state.activeFile;
  const breakpoints = state.debugger.breakpoints.filter(
    breakpoint => breakpoint.path === path
  );
  const frame = state.debugger.frames.find(
    frame => frame.id === state.debugger.frameId && frame.path === path
  );
  const active = frame?.line;
  return [
    gutter({
      class: 'cm-debug-gutter',
      markers: view =>
        RangeSet.of(
          breakpoints.flatMap(breakpoint => {
            if (breakpoint.line < 1 || breakpoint.line > view.state.doc.lines) {
              return [];
            }
            return [
              new BreakpointMarker(breakpoint.verified).range(
                view.state.doc.line(breakpoint.line).from
              )
            ];
          }),
          true
        ),
      domEventHandlers: {
        mousedown(view, line) {
          toggle(view.state.doc.lineAt(line.from).number);
          return true;
        }
      }
    }),
    EditorView.decorations.of(
      active && active <= state.source.split('\n').length
        ? Decoration.set([
            Decoration.line({ class: 'wasmbolt-debug-line' }).range(
              state.source
                .split('\n')
                .slice(0, active - 1)
                .reduce((offset, line) => offset + line.length + 1, 0)
            )
          ])
        : Decoration.none
    )
  ];
}
