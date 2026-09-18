import { useRef, useState } from 'react';
import * as React from 'react';

import type { State } from '../model';

interface IExplorerProps {
  state: State;
  onCreateFile(name: string): void;
  onImportFile(name: string, data: Uint8Array): void;
  onSelectFile(path: string): void;
}

/** A small workspace browser; browser files are copied, never detached. */
export function Explorer(props: IExplorerProps): React.ReactElement {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const create = () => {
    if (!name.trim()) {
      return;
    }
    props.onCreateFile(name);
    setName('');
    setCreating(false);
  };
  return (
    <section className="wasmbolt-explorer" aria-label="Workspace explorer">
      <header className="wasmbolt-panel-title">
        <span>Explorer</span>
        <span className="wasmbolt-explorer-actions">
          <button
            className="wasmbolt-icon-button"
            aria-label="New file"
            title="New file"
            onClick={() => setCreating(true)}
          >
            +
          </button>
          <button
            className="wasmbolt-icon-button"
            aria-label="Import files"
            title="Import files"
            onClick={() => input.current?.click()}
          >
            ↥
          </button>
        </span>
      </header>
      <input
        ref={input}
        className="wasmbolt-visually-hidden"
        type="file"
        multiple
        aria-label="Import workspace files"
        onChange={event => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void Promise.all(
            files.map(async file => {
              props.onImportFile(
                file.name,
                new Uint8Array(await file.arrayBuffer())
              );
            })
          );
        }}
      />
      <div className="wasmbolt-explorer-root">⌄ Workspace</div>
      {creating && (
        <form
          className="wasmbolt-new-file"
          onSubmit={event => {
            event.preventDefault();
            create();
          }}
        >
          <input
            autoFocus
            aria-label="New file name"
            value={name}
            onChange={event => setName(event.target.value)}
            onBlur={() => {
              if (!name.trim()) {
                setCreating(false);
              }
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                setName('');
                setCreating(false);
              }
            }}
          />
        </form>
      )}
      <ul className="wasmbolt-file-tree">
        {props.state.files.map(file => {
          const selected = file.path === props.state.selectedFile;
          const name = filename(file.path);
          return (
            <li key={file.path}>
              <button
                className={`wasmbolt-file${
                  selected ? ' wasmbolt-selected' : ''
                }`}
                aria-current={selected ? 'page' : undefined}
                title={`${file.path} · ${file.data.length.toLocaleString()} bytes`}
                onClick={() => props.onSelectFile(file.path)}
              >
                <span aria-hidden="true">{icon(name)}</span>
                <span>{name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function filename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function icon(name: string): string {
  if (/\.(c|cc|cpp|cxx)$/i.test(name)) {
    return '‹›';
  }
  if (/\.(ll|mlir|s)$/i.test(name)) {
    return '≡';
  }
  return name.endsWith('.wasm') ? '◇' : '□';
}
