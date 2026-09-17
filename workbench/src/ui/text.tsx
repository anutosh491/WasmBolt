import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting
} from '@codemirror/language';
import { gas } from '@codemirror/legacy-modes/mode/gas';
import { openSearchPanel } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import * as React from 'react';

import { editorExtensions } from './codemirror';

const x86Highlighting = [
  StreamLanguage.define(gas),
  syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: [
          tags.keyword,
          tags.variableName,
          tags.tagName,
          tags.number,
          tags.string
        ],
        color: 'var(--wasmbolt-accent)'
      },
      { tag: tags.comment, color: 'var(--wasmbolt-muted)' }
    ])
  )
];

/** Own the read-only editor; artifact content remains in the store. */
export function TextOutput({
  text,
  label,
  x86 = false,
  children
}: {
  text: string;
  label: string;
  x86?: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  const node = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  useEffect(() => {
    if (!node.current) {
      return;
    }
    const view = new EditorView({
      parent: node.current,
      state: EditorState.create({
        extensions: [
          editorExtensions,
          x86 ? x86Highlighting : [],
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            'aria-label': label,
            'aria-readonly': 'true',
            role: 'textbox',
            tabindex: '0'
          })
        ]
      })
    });
    editor.current = view;
    const observer = new ResizeObserver(() => view.requestMeasure());
    observer.observe(node.current);
    return () => {
      observer.disconnect();
      view.destroy();
      editor.current = null;
    };
  }, [label, x86]);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text }
      });
    }
  }, [text, label, x86]);
  return (
    <>
      <div className="wasmbolt-file-actions">
        {children}
        <button
          title="Find in output (Ctrl/Cmd+F)"
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
