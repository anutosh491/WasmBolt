import type { CommandRegistry } from '@lumino/commands';
import * as React from 'react';
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react';

import type { IClangdClient } from '../clangd/types';
import { CommandIDs } from '../commands';
import type { Diagnostic, Options, OutputKind } from '../compiler/types';
import type { IWatRenderer } from '../compiler/wat';
import type { Pane } from '../model';
import type { IStore } from '../state';
import { Editor } from './editor';
import { Debugger } from './debug';
import { Explorer } from './explorer';
import { Guide } from './guide';
import { Output } from './outputs';
import { Execute, Pipelines, Terminal } from './tools';
import { Controls, Diagnostics, Source } from './views';

interface IBridgeProps {
  store: IStore;
  commands: CommandRegistry;
  clangd: IClangdClient | null;
  debuggerAvailable: boolean;
  wat: IWatRenderer;
  pane: Pane | 'controls';
  output?: OutputKind;
  canShare?: boolean;
  onSize(height: number): void;
}

/** Subscribe here; views receive state and command-backed callbacks. */
export function Bridge(props: IBridgeProps): React.ReactElement {
  const { store, commands, pane, onSize } = props;
  const [guideOpen, setGuideOpen] = useState(false);
  const node = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      onSize(element.getBoundingClientRect().height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onSize]);
  const state = useSyncExternalStore(store.subscribe, () => store.state);
  const callbacks = useMemo(() => {
    const execute = (id: string, args = {}) => {
      void commands.execute(id, args).catch(error => {
        store.dispatch({ type: 'notice', message: String(error) });
      });
    };
    return {
      onChange: (source: string) => execute(CommandIDs.setSource, { source }),
      onOptions: (options: Options) =>
        execute(CommandIDs.setOptions, { options }),
      onCompile: () => execute(CommandIDs.compile),
      onCompileAndRun: () => execute(CommandIDs.compileAndRun),
      onCancel: () => execute(CommandIDs.cancel),
      onResetLayout: () => execute(CommandIDs.resetLayout),
      onCompare: () => execute(CommandIDs.compare),
      onShare: () => execute(CommandIDs.share),
      onResetExample: () => execute(CommandIDs.resetExample),
      onCreateFile: (name: string) => execute(CommandIDs.createFile, { name }),
      onImportFile: (name: string, data: Uint8Array) =>
        execute(CommandIDs.importFile, { name, data }),
      onSelectFile: (path: string) => execute(CommandIDs.selectFile, { path }),
      onShowDebugger: () => execute(CommandIDs.showDebugger),
      onShowDiagnostics: () => execute(CommandIDs.showDiagnostics),
      onShowPipelines: () => execute(CommandIDs.showPipelines),
      onToggleBreakpoint: (line: number) =>
        execute(CommandIDs.toggleBreakpoint, {
          path: store.state.activeFile,
          line
        }),
      onStartDebugging: () => execute(CommandIDs.startDebugging),
      onContinueDebugging: () => execute(CommandIDs.continueDebugging),
      onPauseDebugging: () => execute(CommandIDs.pauseDebugging),
      onStepOver: () => execute(CommandIDs.stepOver),
      onStepIn: () => execute(CommandIDs.stepIn),
      onStepOut: () => execute(CommandIDs.stepOut),
      onRestartDebugging: () => execute(CommandIDs.restartDebugging),
      onStopDebugging: () => execute(CommandIDs.stopDebugging),
      onSelectFrame: (frameId: number) =>
        execute(CommandIDs.selectDebugFrame, { frameId }),
      onDebugCommand: (command: string) =>
        execute(CommandIDs.debugCommand, { command }),
      onRun: () => execute(CommandIDs.run),
      onStop: () => execute(CommandIDs.stop),
      onCommand: (command: string) =>
        execute(CommandIDs.runCommand, { command }),
      onClear: () => execute(CommandIDs.clearTerminal),
      onSelectExport: (symbol: string) =>
        execute(CommandIDs.selectExport, { symbol }),
      onArguments: (values: readonly string[]) =>
        execute(CommandIDs.setArguments, { values }),
      onTimeout: (timeout: number) =>
        execute(CommandIDs.setTimeout, { timeout }),
      onSelectModule: (path: string) =>
        execute(CommandIDs.selectModule, { path }),
      onCopy: (path: string, workspace: boolean, hideMetadata: boolean) =>
        execute(CommandIDs.copy, { path, workspace, hideMetadata }),
      onDownload: (path: string, workspace: boolean) =>
        execute(CommandIDs.download, { path, workspace }),
      onNavigate: ({ line, column }: Diagnostic) =>
        execute(CommandIDs.navigate, { line, column })
    };
  }, [store, commands]);
  switch (pane) {
    case 'controls':
      return (
        <div ref={node}>
          <Controls
            state={state}
            {...callbacks}
            debuggerAvailable={props.debuggerAvailable}
            onShare={props.canShare ? callbacks.onShare : undefined}
            onGuide={() => setGuideOpen(true)}
          />
          {guideOpen && <Guide onClose={() => setGuideOpen(false)} />}
        </div>
      );
    case 'source':
      return (
        <Source state={state}>
          <Editor
            store={store}
            clangd={props.clangd}
            debuggerAvailable={props.debuggerAvailable}
            path={state.activeFile}
            onChange={callbacks.onChange}
            onResetExample={callbacks.onResetExample}
            onToggleBreakpoint={callbacks.onToggleBreakpoint}
          />
        </Source>
      );
    case 'explorer':
      return <Explorer state={state} {...callbacks} />;
    case 'outputs':
    case 'comparison': {
      const kind = props.output ?? 'assembly';
      return (
        <Output
          state={state}
          kind={kind}
          renderer={props.wat}
          active={
            state.outputs[pane === 'outputs' ? 'primary' : 'comparison'] ===
            kind
          }
          {...callbacks}
        />
      );
    }
    case 'diagnostics':
      return <Diagnostics state={state} onNavigate={callbacks.onNavigate} />;
    case 'run':
      return <Execute state={state} {...callbacks} />;
    case 'terminal':
      return <Terminal state={state} {...callbacks} />;
    case 'debugger':
      return props.debuggerAvailable ? (
        <Debugger state={state} {...callbacks} />
      ) : (
        <></>
      );
    case 'pipelines':
      return <Pipelines state={state} {...callbacks} />;
  }
}
