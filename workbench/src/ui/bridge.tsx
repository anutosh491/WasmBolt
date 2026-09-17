import type { CommandRegistry } from '@lumino/commands';
import * as React from 'react';
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react';

import { CommandIDs } from '../commands';
import type { Diagnostic, Options, OutputKind } from '../compiler/types';
import type { Pane } from '../model';
import type { IStore } from '../state';
import { Editor } from './editor';
import { Guide } from './guide';
import { Files, Output } from './outputs';
import { Pipelines, Run, Terminal } from './tools';
import { Controls, Diagnostics, Source } from './views';

interface IBridgeProps {
  store: IStore;
  commands: CommandRegistry;
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
      onCancel: () => execute(CommandIDs.cancel),
      onResetLayout: () => execute(CommandIDs.resetLayout),
      onCompare: () => execute(CommandIDs.compare),
      onShare: () => execute(CommandIDs.share),
      onResetExample: () => execute(CommandIDs.resetExample),
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
            language={state.options.language}
            onChange={callbacks.onChange}
            onResetExample={callbacks.onResetExample}
          />
        </Source>
      );
    case 'outputs':
    case 'comparison':
      return (
        <Output
          state={state}
          kind={props.output ?? 'assembly'}
          {...callbacks}
        />
      );
    case 'diagnostics':
      return <Diagnostics state={state} onNavigate={callbacks.onNavigate} />;
    case 'files':
      return <Files state={state} {...callbacks} />;
    case 'run':
      return <Run state={state} {...callbacks} />;
    case 'terminal':
      return <Terminal state={state} {...callbacks} />;
    case 'pipelines':
      return <Pipelines state={state} {...callbacks} />;
  }
}
