import { useEffect, useRef, useState } from 'react';
import * as React from 'react';

import { isTimeout } from '../compiler/execution';
import type { Options } from '../compiler/types';
import type { State } from '../model';
import { canRun, currentModule } from '../model';

export function Pipelines({
  state,
  onOptions
}: {
  state: State;
  onOptions(options: Options): void;
}): React.ReactElement {
  return (
    <section className="wasmbolt-form" aria-label="Pipelines pane">
      {state.options.language !== 'mlir' && (
        <>
          <label>
            LLVM pipeline
            <input
              value={state.options.llvmPipeline ?? ''}
              placeholder={`default<O${state.options.optimization}>`}
              onChange={event =>
                onOptions({
                  ...state.options,
                  llvmPipeline: event.target.value || null
                })
              }
            />
          </label>
          <label>
            Analysis pipeline
            <input
              value={state.options.analysisPipeline}
              onChange={event =>
                onOptions({
                  ...state.options,
                  analysisPipeline: event.target.value
                })
              }
            />
          </label>
        </>
      )}
      {state.options.language === 'mlir' && (
        <label>
          MLIR pipeline
          <input
            value={state.options.mlirPipeline}
            onChange={event =>
              onOptions({
                ...state.options,
                mlirPipeline: event.target.value
              })
            }
          />
        </label>
      )}
      <p className="wasmbolt-hint">
        {state.options.language === 'mlir'
          ? 'MLIR produces transformed IR and an operation graph.'
          : 'Leave the LLVM pipeline empty to follow the optimization level.'}
      </p>
    </section>
  );
}

export function Terminal({
  state,
  onCommand,
  onClear
}: {
  state: State;
  onCommand(command: string): void;
  onClear(): void;
}): React.ReactElement {
  const [command, setCommand] = useState('');
  const output = useRef<HTMLDivElement>(null);
  useEffect(() => {
    output.current?.scrollTo({ top: output.current.scrollHeight });
  }, [state.terminal]);
  return (
    <section className="wasmbolt-terminal" aria-label="Terminal pane">
      <div className="wasmbolt-terminal-title">
        <span className="wasmbolt-terminal-actions">
          <span aria-hidden="true">›_ wasmbolt</span>
          <button
            className="wasmbolt-icon-button"
            title="Clear terminal"
            aria-label="Clear terminal"
            onClick={onClear}
          >
            ⌫
          </button>
        </span>
      </div>
      <div
        ref={output}
        className="wasmbolt-terminal-output"
        aria-label="Command log"
      >
        {state.terminal.flatMap((stage, stageIndex) => [
          ...stage.commands.map((line, index) => (
            <div
              className="wasmbolt-terminal-command"
              key={`${stageIndex}-${index}`}
            >
              <span className="wasmbolt-prompt">wasmbolt:/workspace $</span>{' '}
              <span>{line}</span>
            </div>
          )),
          stage.stdout && <pre key={`${stageIndex}-out`}>{stage.stdout}</pre>,
          stage.stderr && (
            <pre className="wasmbolt-terminal-error" key={`${stageIndex}-err`}>
              {stage.stderr}
            </pre>
          ),
          stage.exitCode !== 0 && (
            <div className="wasmbolt-terminal-error" key={`${stageIndex}-code`}>
              [exit {stage.exitCode}]
            </div>
          )
        ])}
        <form
          className="wasmbolt-command-line"
          onSubmit={event => {
            event.preventDefault();
            if (command.trim() && !state.active) {
              onCommand(command);
              setCommand('');
            }
          }}
        >
          <span className="wasmbolt-prompt">wasmbolt:/workspace $</span>
          <input
            aria-label="Compiler command"
            value={command}
            placeholder="Type a tool command or lldb <command>"
            onChange={event => setCommand(event.target.value)}
            spellCheck={false}
          />
        </form>
      </div>
    </section>
  );
}

export function Execute({
  state,
  onRun,
  onStop,
  onSelectExport,
  onArguments,
  onTimeout
}: {
  state: State;
  onRun(): void;
  onStop(): void;
  onSelectExport(symbol: string): void;
  onArguments(values: readonly string[]): void;
  onTimeout(timeout: number): void;
}): React.ReactElement {
  const execution = state.execution;
  const fn = execution.info?.functions.find(fn => fn.name === execution.symbol);
  const functions = execution.info?.functions.filter(fn => fn.callable) ?? [];
  const main =
    fn?.name === 'main' &&
    fn.params.length === 2 &&
    fn.params.every(type => type === 'i32');
  const busy = execution.active !== null;
  const value =
    execution.result?.status === 'success' ? execution.result.value : null;
  const returned = value === null ? 'void' : String(value);
  return (
    <section className="wasmbolt-form" aria-label="Execute pane">
      <div className="wasmbolt-run-controls">
        <label>
          Export
          <select
            value={execution.symbol}
            disabled={busy}
            onChange={event => onSelectExport(event.target.value)}
          >
            <option value="">Select an export</option>
            {functions.map(fn => (
              <option key={fn.name} value={fn.name}>
                {fn.name} · {fn.signature}
              </option>
            ))}
          </select>
        </label>
        {!main &&
          fn?.params.map((type, index) => (
            <label key={index}>
              Argument {index + 1} ({type})
              <input
                aria-label={`Argument ${index + 1}`}
                value={execution.args[index] ?? ''}
                disabled={busy}
                inputMode="decimal"
                onChange={event =>
                  onArguments(
                    execution.args.map((value, i) =>
                      i === index ? event.target.value : value
                    )
                  )
                }
              />
            </label>
          ))}
        <button
          onClick={onRun}
          disabled={
            !canRun(state) || (currentModule(state) && fn?.callable === false)
          }
        >
          Run function
        </button>
        {(busy || execution.result) && (
          <button onClick={onStop}>{busy ? 'Stop' : 'Reset execution'}</button>
        )}
      </div>
      {execution.module !== null && !currentModule(state) && (
        <p className="wasmbolt-hint">
          Out of date — Run rebuilds source when WebAssembly is selected.
        </p>
      )}
      {!execution.module && (
        <p className="wasmbolt-hint">
          {canRun(state)
            ? 'Compile and Run builds a module and calls an exported function.'
            : 'Choose WebAssembly to run your code, or use a Wasm file.'}
        </p>
      )}
      {execution.info && functions.length === 0 && (
        <p className="wasmbolt-hint">
          This module has no callable scalar exports.
        </p>
      )}
      {fn?.callable === false && (
        <p>This function signature is not supported.</p>
      )}
      {busy && (
        <p role="status">
          {execution.status === 'running'
            ? 'Running program…'
            : execution.progress?.phase === 'downloading'
              ? 'Downloading runner…'
              : 'Preparing runner…'}
        </p>
      )}
      {(execution.notice || execution.result?.status === 'failed') && (
        <p role="alert" className="wasmbolt-error">
          {execution.notice ||
            (execution.result?.status === 'failed'
              ? execution.result.message
              : '')}
        </p>
      )}
      {execution.result && (
        <pre aria-label="Execution result">
          {execution.result.status === 'success' ? `Return: ${returned}\n` : ''}
          {execution.result.stdout && `Stdout:\n${execution.result.stdout}\n`}
          {execution.result.stderr && `Stderr:\n${execution.result.stderr}\n`}
          {'\n'}
          {Math.round(execution.result.duration)} ms
        </pre>
      )}
      <details>
        <summary>Execution settings</summary>
        <label>
          Execution timeout (seconds)
          <input
            type="number"
            min="0.1"
            max="2147483.647"
            step="0.1"
            value={state.timeout / 1000}
            onChange={event => {
              const seconds = Number(event.target.value);
              if (isTimeout(seconds * 1000)) {
                onTimeout(seconds * 1000);
              }
            }}
          />
        </label>
        <p className="wasmbolt-hint">
          Pointer and aggregate values are not supported. Calls retain module
          state until reset.
        </p>
      </details>
    </section>
  );
}
