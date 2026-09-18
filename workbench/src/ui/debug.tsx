import { useState } from 'react';
import * as React from 'react';

import type { State } from '../model';

interface IDebuggerProps {
  state: State;
  onStartDebugging(): void;
  onContinueDebugging(): void;
  onPauseDebugging(): void;
  onStepOver(): void;
  onStepIn(): void;
  onStepOut(): void;
  onRestartDebugging(): void;
  onStopDebugging(): void;
  onSelectFrame(frameId: number): void;
  onDebugCommand(command: string): void;
}

export function Debugger(props: IDebuggerProps): React.ReactElement {
  const debug = props.state.debugger;
  const [command, setCommand] = useState('');
  const active = ['starting', 'running', 'stopped'].includes(debug.status);
  const stopped = debug.status === 'stopped';
  const canBuild =
    ['c', 'cpp'].includes(props.state.options.language) &&
    props.state.options.target === 'wasm32-unknown-emscripten';
  const module =
    debug.module ??
    props.state.execution.module ??
    props.state.files.find(file => file.path.endsWith('.wasm'))?.path ??
    (canBuild ? '/workspace/debug.wasm' : null);
  return (
    <section className="wasmbolt-debugger" aria-label="Debugger pane">
      <div className="wasmbolt-debug-toolbar" aria-label="Debug controls">
        <button
          className="wasmbolt-primary"
          disabled={!module || active || props.state.active !== null}
          onClick={props.onStartDebugging}
        >
          Start
        </button>
        {debug.status === 'running' ? (
          <DebugButton
            label="Pause"
            icon="Ⅱ"
            onClick={props.onPauseDebugging}
          />
        ) : (
          <DebugButton
            label="Continue"
            icon="▶"
            disabled={!stopped}
            onClick={props.onContinueDebugging}
          />
        )}
        <DebugButton
          label="Step over"
          icon="↷"
          disabled={!stopped}
          onClick={props.onStepOver}
        />
        <DebugButton
          label="Step into"
          icon="↓"
          disabled={!stopped}
          onClick={props.onStepIn}
        />
        <DebugButton
          label="Step out"
          icon="↑"
          disabled={!stopped}
          onClick={props.onStepOut}
        />
        <DebugButton
          label="Restart"
          icon="↻"
          disabled={!active}
          onClick={props.onRestartDebugging}
        />
        <DebugButton
          label="Stop"
          icon="■"
          disabled={!active}
          onClick={props.onStopDebugging}
        />
        <span className="wasmbolt-debug-target">
          {module ? filename(module) : 'Select a .wasm file in Explorer'}
        </span>
      </div>
      {debug.message && (
        <p
          className={
            debug.status === 'error' ? 'wasmbolt-error' : 'wasmbolt-hint'
          }
          role={debug.status === 'error' ? 'alert' : 'status'}
        >
          {debug.message}
        </p>
      )}
      <div className="wasmbolt-debug-content">
        <section>
          <h3>Variables</h3>
          {debug.variables.length ? (
            <table>
              <tbody>
                {debug.variables.map(variable => (
                  <tr key={variable.name}>
                    <th>{variable.name}</th>
                    <td>{variable.type ?? ''}</td>
                    <td>{variable.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="wasmbolt-hint">No variables available.</p>
          )}
        </section>
        <section>
          <h3>Call stack</h3>
          {debug.frames.length ? (
            <ol className="wasmbolt-call-stack">
              {debug.frames.map(frame => (
                <li key={frame.id}>
                  <button
                    className="wasmbolt-frame"
                    aria-current={
                      frame.id === debug.frameId ? 'true' : undefined
                    }
                    onClick={() => props.onSelectFrame(frame.id)}
                  >
                    <strong>{frame.name}</strong>
                    <span className="wasmbolt-frame-location">
                      {frame.path ? filename(frame.path) : 'unknown'}
                      {frame.line ? `:${frame.line}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="wasmbolt-hint">No paused frames.</p>
          )}
        </section>
      </div>
      <section className="wasmbolt-debug-console">
        <h3>Debug console</h3>
        <pre>
          {debug.console
            .map(
              entry =>
                `${entry.channel === 'input' ? '(lldb) ' : ''}` +
                entry.text.replace(/\n$/, '')
            )
            .join('\n')}
        </pre>
        <form
          onSubmit={event => {
            event.preventDefault();
            if (command.trim() && active) {
              props.onDebugCommand(command);
              setCommand('');
            }
          }}
        >
          <span>(lldb)</span>
          <input
            className="wasmbolt-debug-input"
            aria-label="LLDB command"
            value={command}
            disabled={!active}
            onChange={event => setCommand(event.target.value)}
          />
        </form>
      </section>
    </section>
  );
}

function DebugButton({
  label,
  icon,
  disabled,
  onClick
}: {
  label: string;
  icon: string;
  disabled?: boolean;
  onClick(): void;
}): React.ReactElement {
  return (
    <button
      className="wasmbolt-icon-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function filename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
