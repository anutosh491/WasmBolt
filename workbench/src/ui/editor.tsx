import { history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { openSearchPanel } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import * as React from 'react';

import { sourceName } from '../compiler/types';
import type { Language } from '../compiler/types';
import type { IStore } from '../state';
import { editorExtensions } from './codemirror';

interface IEditorProps {
  store: IStore;
  language: Language;
  onChange(source: string): void;
  onResetExample(): void;
}

/** Own editor effects here; source text remains in the application store. */
export function Editor({
  store,
  language,
  onChange,
  onResetExample
}: IEditorProps): React.ReactElement {
  const node = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  useEffect(() => {
    if (!node.current) {
      return;
    }
    let updating = false;
    let language = store.state.options.language;
    const dialect = new Compartment();
    const extensions = () => (['c', 'cpp'].includes(language) ? cpp() : []);
    let position = store.state.position?.serial ?? 0;
    const view = new EditorView({
      parent: node.current,
      state: EditorState.create({
        doc: store.state.source,
        extensions: [
          editorExtensions,
          dialect.of(extensions()),
          history(),
          drawSelection(),
          syntaxHighlighting(
            HighlightStyle.define([
              {
                tag: tags.keyword,
                color: 'var(--fortitudo-accent)',
                fontWeight: '600'
              },
              {
                tag: [tags.string, tags.number, tags.bool],
                color: 'var(--fortitudo-accent)'
              },
              {
                tag: tags.comment,
                color: 'var(--fortitudo-muted)',
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
    const unsubscribe = store.subscribe(() => {
      const state = store.state;
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
      view.destroy();
      editor.current = null;
    };
  }, [store, onChange]);
  return (
    <>
      <div className="fortitudo-file-actions">
        <span>{sourceName(language)}</span>
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
      <div className="fortitudo-editor" ref={node} />
    </>
  );
}
