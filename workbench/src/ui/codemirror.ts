import {
  defaultKeymap,
  temporarilySetTabFocusMode
} from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';

/** Shared editor behavior; Ctrl/Cmd+Enter belongs to the workbench. */
export const editorExtensions: Extension = [
  lineNumbers(),
  search({ top: true }),
  keymap.of([
    {
      key: 'Escape',
      run: view => {
        // Keep Tab available even when Escape also clears a selection.
        temporarilySetTabFocusMode(view);
        return false;
      }
    },
    ...searchKeymap,
    ...defaultKeymap.filter(binding => binding.key !== 'Mod-Enter')
  ]),
  EditorView.theme({
    '&': { height: '100%', fontSize: '13px' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'var(--wasmbolt-code-font)'
    },
    '.cm-content': { padding: '12px 0' },
    '.cm-line': { padding: '0 12px' },
    '.cm-gutters': { background: 'var(--wasmbolt-muted-background)' },
    '.cm-cursor': { borderLeftColor: 'var(--wasmbolt-foreground)' },
    '&.cm-focused': { outline: 'none' }
  })
];
