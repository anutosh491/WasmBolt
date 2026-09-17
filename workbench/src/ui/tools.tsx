import { useState } from 'react';
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
    <section className="fortitudo-form" aria-label="Pipelines pane">
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
      <p className="fortitudo-hint">
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
  return (
    <section className="fortitudo-pane" aria-label="Terminal pane">
      <div className="fortitudo-caption">
        <span>clang · clang++ · opt · llc · wasm-ld · mlir-opt · dot</span>
        <button onClick={onClear}>Clear log</button>
      </div>
      <pre className="fortitudo-output" aria-label="Command log">
        {state.terminal
          .map(stage =>
            [
              ...stage.commands.map(command => `$ ${command}`),
              stage.stdout,
              stage.stderr,
              `Exit ${stage.exitCode} · ${Math.round(stage.duration)} ms`
            ]
              .filter(Boolean)
              .join('\n')
          )
          .join('\n\n') ||
          'Working directory: /workspace. Compile replaces the workspace.'}
      </pre>
      <form
        className="fortitudo-command-line"
        onSubmit={event => {
          event.preventDefault();
          if (command.trim() && !state.active) {
            onCommand(command);
            setCommand('');
          }
        }}
      >
        <input
          aria-label="Compiler command"
          value={command}
          placeholder={
            'opt "-passes=print<domtree>" -disable-output optimized.ll'
          }
          onChange={event => setCommand(event.target.value)}
          spellCheck={false}
        />
        <button type="submit" disabled={!!state.active || !command.trim()}>
          Run command
        </button>
      </form>
    </section>
  );
}

export function Run({
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
  const main = fn?.name === 'main' && fn.signatureCode === 2;
  const busy = execution.active !== null;
  const value =
    execution.result?.status === 'success' ? execution.result.value : null;
  const returned = value === null ? 'void' : String(value);
  return (
    <section className="fortitudo-form" aria-label="Run pane">
      <div className="fortitudo-run-controls">
        <label>
          Export
          <select
            value={execution.symbol}
            disabled={busy}
            onChange={event => onSelectExport(event.target.value)}
          >
            <option value="">Select an export</option>
            {execution.info?.functions.map(fn => (
              <option key={fn.name} value={fn.name}>
                {fn.name} · {fn.signature}
                {fn.signatureCode === null ? ' (unsupported)' : ''}
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
            !canRun(state) ||
            (currentModule(state) && fn?.signatureCode === null)
          }
        >
          Run function
        </button>
        {(busy || execution.result) && (
          <button onClick={onStop}>{busy ? 'Stop' : 'Reset execution'}</button>
        )}
      </div>
      {execution.module !== null && !currentModule(state) && (
        <p className="fortitudo-hint">
          Out of date — Run rebuilds source when WebAssembly is selected.
        </p>
      )}
      {!execution.module && (
        <p className="fortitudo-hint">
          {canRun(state)
            ? 'Run compiles your source and calls an exported function.'
            : 'Choose WebAssembly to run your code, or use a Wasm file.'}
        </p>
      )}
      {fn?.signatureCode === null && (
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
        <p role="alert" className="fortitudo-error">
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
        <p className="fortitudo-hint">
          Pointer and aggregate values are not supported. Calls retain module
          state until reset.
        </p>
      </details>
    </section>
  );
}
