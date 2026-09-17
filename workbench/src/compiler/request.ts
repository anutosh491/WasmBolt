import type { Info, OutputKind, Request } from './types';
import { sourceName } from './types';

export type Step = Readonly<{
  name: OutputKind;
  requires: readonly OutputKind[];
  commands: readonly (readonly string[])[];
  path: string;
  capture?: 'stdout' | 'stderr' | 'both';
  graphs?: 'llvm' | 'mlir';
}>;

export type Invocation = Readonly<{
  source: string;
  steps: readonly Step[];
}>;

/** Plan one build; independent branches survive ordinary compiler errors. */
export function invocation(
  request: Request,
  info: Info,
  directory: string
): Invocation {
  const { language, target, optimization } = request.options;
  const source = `${directory}/${sourceName(language)}`;
  const ir = `${directory}/source.ll`;
  const optimized = `${directory}/optimized.ll`;
  const object = `${directory}/output.o`;
  const wasm = target === 'wasm32-unknown-emscripten';
  const steps: Step[] = [];
  const pipeline = request.options.llvmPipeline ?? `default<O${optimization}>`;
  const resources = info.resourceDirectory;
  const includes = wasm
    ? [
        '/include/wasm32-emscripten/c++/v1',
        '/include/c++/v1',
        `${resources}/include`,
        '/include/wasm32-emscripten',
        '/include'
      ]
    : [`${resources}/include`];
  const clang = [
    language === 'cpp' ? 'clang++' : 'clang',
    '-x',
    language === 'cpp' ? 'c++' : 'c',
    language === 'cpp' ? '-std=c++23' : '-std=c23',
    '-fno-color-diagnostics',
    '-nostdinc',
    `-resource-dir=${resources}`,
    ...includes.flatMap(include => ['-isystem', include]),
    ...(wasm
      ? [
          '-Xclang',
          '-iwithsysroot/include/compat',
          '-fPIC',
          '-fwasm-exceptions'
        ]
      : []),
    `--target=${target}`,
    `-O${optimization}`
  ];
  if (language === 'mlir') {
    const path = `${directory}/optimized.mlir`;
    return {
      source,
      steps: [
        {
          name: 'mlir',
          requires: [],
          path,
          commands: [
            [
              'mlir-opt',
              `--pass-pipeline=${request.options.mlirPipeline}`,
              source,
              '-o',
              path
            ]
          ]
        },
        {
          name: 'graphs',
          requires: ['mlir'],
          path: `${directory}/operations.dot`,
          capture: 'stderr',
          graphs: 'mlir',
          commands: [['mlir-opt', '--view-op-graph', path, '-o', '/dev/null']]
        }
      ]
    };
  }
  if (language !== 'llvm') {
    steps.push({
      name: 'ast',
      requires: [],
      path: `${directory}/ast.txt`,
      capture: 'stdout',
      commands: [[...clang, '-fsyntax-only', '-Xclang', '-ast-dump', source]]
    });
  }
  steps.push(
    {
      name: 'ir',
      requires: [],
      path: ir,
      commands: [
        language === 'llvm'
          ? [
              'opt',
              '-S',
              `-mtriple=${target}`,
              '-passes=verify',
              source,
              '-o',
              ir
            ]
          : [
              ...clang,
              '-Xclang',
              '-disable-llvm-passes',
              '-Xclang',
              '-disable-O0-optnone',
              '-S',
              '-emit-llvm',
              source,
              '-o',
              ir
            ]
      ]
    },
    {
      name: 'optimized',
      requires: ['ir'],
      path: optimized,
      commands: [
        [
          'opt',
          '-S',
          `-mtriple=${target}`,
          `-passes=${pipeline}`,
          ir,
          '-o',
          optimized
        ]
      ]
    },
    {
      name: 'analysis',
      requires: ['optimized'],
      path: `${directory}/analysis.txt`,
      capture: 'both',
      commands: [
        [
          'opt',
          `-passes=${request.options.analysisPipeline}`,
          '-disable-output',
          optimized
        ]
      ]
    },
    {
      name: 'graphs',
      requires: ['optimized'],
      path: directory,
      graphs: 'llvm',
      commands: [['opt', '-passes=dot-cfg', '-disable-output', optimized]]
    }
  );
  for (const kind of ['assembly', 'object'] as const) {
    const path = kind === 'assembly' ? `${directory}/output.s` : object;
    steps.push({
      name: kind,
      requires: ['optimized'],
      path,
      commands: [
        [
          'llc',
          `-mtriple=${target}`,
          `-filetype=${kind === 'assembly' ? 'asm' : 'obj'}`,
          ...(wasm ? ['-relocation-model=pic'] : []),
          `-O${optimization}`,
          optimized,
          '-o',
          path
        ]
      ]
    });
  }
  if (wasm) {
    const path = `${directory}/program.wasm`;
    steps.push({
      name: 'wasm',
      requires: ['object'],
      path,
      commands: [
        [
          'wasm-ld',
          '-shared',
          '--export-all',
          '--unresolved-symbols=import-dynamic',
          object,
          '-o',
          path
        ]
      ]
    });
  }
  return { source, steps };
}

/** Quote arguments for LLVM's GNU command-line tokenizer, not a shell. */
export function serialize(args: readonly string[]): string {
  return args
    .map(argument => {
      if (argument.includes('\0')) {
        throw new Error('Compiler arguments cannot contain null bytes.');
      }
      return `"${argument.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    })
    .join(' ');
}
