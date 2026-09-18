import type { CallSignature } from './execution';
import type { Info, OutputKind, Request } from './types';

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

export type DebugInvocation = Readonly<{
  source: string;
  object: string;
  module: string;
  wrapper: Readonly<{ path: string; source: string }> | null;
  generated: readonly string[];
  commands: readonly (readonly string[])[];
}>;

export type DebugEntry = Readonly<{
  symbol: string;
  signature: CallSignature;
  args: readonly number[];
}>;

const debugLibraries = [
  'libGL-getprocaddr.a',
  'libal.a',
  'libhtml5.a',
  'libstandalonewasm-nocatch.a',
  'libstubs-debug.a',
  'libc-debug.a',
  'libdlmalloc-debug.a',
  'libcompiler_rt.a',
  'libc++-noexcept.a',
  'libc++abi-debug-noexcept.a',
  'libsockets.a'
] as const;

/** Build a standalone DWARF module for the embedded WAMR debugger. */
export function debugInvocation(
  request: Request,
  info: Info,
  directory: string,
  entry: DebugEntry | null
): DebugInvocation {
  const { language, target } = request.options;
  if (
    (language !== 'c' && language !== 'cpp') ||
    target !== 'wasm32-unknown-emscripten'
  ) {
    throw new Error('Source debugging requires WebAssembly C or C++.');
  }
  const source = request.sourcePath;
  if (!source.startsWith(`${directory}/`)) {
    throw new Error('The source file must be in the workspace.');
  }
  const object = `${directory}/debug.o`;
  const module = `${directory}/debug.wasm`;
  const wrapper = entry ? `${directory}/.wasmbolt-debug-main.cpp` : null;
  const wrapperObject = entry ? `${directory}/.wasmbolt-debug-main.o` : null;
  const libraryDirectory = '/lib/wasm32-emscripten';
  const resources = info.resourceDirectory;
  const includes = [
    '/include/wasm32-emscripten/c++/v1',
    '/include/c++/v1',
    `${resources}/include`,
    '/include/wasm32-emscripten',
    '/include'
  ];
  const compiler = [
    language === 'cpp' ? 'clang++' : 'clang',
    '-x',
    language === 'cpp' ? 'c++' : 'c',
    language === 'cpp' ? '-std=c++23' : '-std=c23',
    '-fno-color-diagnostics',
    '-nostdinc',
    `-resource-dir=${resources}`,
    ...includes.flatMap(include => ['-isystem', include]),
    '-Xclang',
    '-iwithsysroot/include/compat',
    '-DEMSCRIPTEN',
    '-fignore-exceptions',
    '-fvisibility=default',
    '-mno-reference-types',
    '--target=wasm32-unknown-emscripten',
    '-O0',
    '-g3',
    '-c',
    source,
    '-o',
    object
  ];
  const wrapperCompiler =
    wrapper && wrapperObject
      ? [
          'clang++',
          '-x',
          'c++',
          '-std=c++23',
          '-fno-color-diagnostics',
          '-nostdinc',
          `-resource-dir=${resources}`,
          ...includes.flatMap(include => ['-isystem', include]),
          '-Xclang',
          '-iwithsysroot/include/compat',
          '-DEMSCRIPTEN',
          '-fignore-exceptions',
          '-mno-reference-types',
          '--target=wasm32-unknown-emscripten',
          '-O0',
          '-g3',
          '-c',
          wrapper,
          '-o',
          wrapperObject
        ]
      : null;
  const linker = [
    'wasm-ld',
    '-o',
    module,
    object,
    ...(wrapperObject ? [wrapperObject] : []),
    `${libraryDirectory}/crt1.o`,
    ...debugLibraries.map(name => `${libraryDirectory}/${name}`),
    '--export=emscripten_stack_get_end',
    '--export=emscripten_stack_get_free',
    '--export=emscripten_stack_get_base',
    '--export=emscripten_stack_get_current',
    '--export=emscripten_stack_init',
    '--export-if-defined=__start_em_asm',
    '--export-if-defined=__stop_em_asm',
    '--export-if-defined=__start_em_lib_deps',
    '--export-if-defined=__stop_em_lib_deps',
    '--export-if-defined=__start_em_js',
    '--export-if-defined=__stop_em_js',
    '--export-table',
    '-z',
    'stack-size=65536',
    '--no-growable-memory',
    '--initial-heap=16777216',
    '--stack-first',
    '--table-base=1'
  ];
  return {
    source,
    object,
    module,
    wrapper: wrapper ? { path: wrapper, source: debugWrapper(entry!) } : null,
    generated: [object, ...(wrapper ? [wrapper, wrapperObject!] : [])],
    commands: [compiler, ...(wrapperCompiler ? [wrapperCompiler] : []), linker]
  };
}

/** Generate the temporary main used to enter a selected scalar function. */
export function debugWrapper(entry: DebugEntry): string {
  if (
    !entry.symbol ||
    /["\\\0]/.test(entry.symbol) ||
    entry.args.length !== entry.signature.params.length
  ) {
    throw new Error('The selected debug entry is invalid.');
  }
  const types: Readonly<Record<CallSignature['params'][number], string>> = {
    i32: 'int',
    f32: 'float',
    f64: 'double'
  };
  const result = entry.signature.results[0];
  const resultType = result ? types[result] : 'void';
  const params = entry.signature.params.map(type => types[type]).join(', ');
  const args = entry.args
    .map((value, index) => {
      const type = entry.signature.params[index];
      return type === 'i32'
        ? String(value)
        : type === 'f32'
          ? `${value}f`
          : String(value);
    })
    .join(', ');
  const call = `wasmbolt_debug_target(${args})`;
  const body =
    result === undefined ? `${call};\n  return 0;` : `return ${call};`;
  return (
    `extern "C" ${resultType} wasmbolt_debug_target(${params})\n` +
    `    asm("${entry.symbol}");\n\n` +
    `int main() {\n  ${body}\n}\n`
  );
}

/** Plan one build; independent branches survive ordinary compiler errors. */
export function invocation(
  request: Request,
  info: Info,
  directory: string
): Invocation {
  const { language, target, optimization } = request.options;
  const source = request.sourcePath;
  if (!source.startsWith(`${directory}/`)) {
    throw new Error('The source file must be in the workspace.');
  }
  const ir = `${directory}/source.ll`;
  const optimized = `${directory}/optimized.ll`;
  const object = `${directory}/output.o`;
  const wasm = target === 'wasm32-unknown-emscripten';
  const directWasm =
    wasm &&
    request.output === 'wasm' &&
    request.options.llvmPipeline === null &&
    (language === 'c' || language === 'cpp');
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
          '-fvisibility=default',
          '-fvisibility-inlines-hidden',
          '-fwasm-exceptions'
        ]
      : []),
    `--target=${target}`,
    `-O${optimization}`
  ];
  if (language === 'mlir') {
    const mlir = `${directory}/optimized.mlir`;
    const steps: readonly Step[] = [
      {
        name: 'mlir',
        requires: [],
        path: mlir,
        commands: [
          [
            'mlir-opt',
            `--pass-pipeline=${request.options.mlirPipeline}`,
            source,
            '-o',
            mlir
          ]
        ]
      },
      {
        name: 'ir',
        requires: ['mlir'],
        path: ir,
        commands: [['mlir-translate', '--mlir-to-llvmir', mlir, '-o', ir]]
      },
      {
        name: 'graphs',
        requires: ['mlir'],
        path: `${directory}/operations.dot`,
        capture: 'stderr',
        graphs: 'mlir',
        commands: [['mlir-opt', '--view-op-graph', mlir, '-o', '/dev/null']]
      }
    ];
    return {
      source,
      steps: selectSteps(steps, request.output)
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
    const directObject = kind === 'object' && directWasm;
    steps.push({
      name: kind,
      requires: directObject ? [] : ['optimized'],
      path,
      commands: [
        directObject
          ? [...clang, '-c', source, '-o', path]
          : [
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
          '--unresolved-symbols=import-dynamic',
          object,
          '-o',
          path
        ]
      ]
    });
  }
  return { source, steps: selectSteps(steps, request.output) };
}

/** Keep the selected output and its transitive prerequisites in plan order. */
function selectSteps(
  steps: readonly Step[],
  output: OutputKind | undefined
): readonly Step[] {
  if (output === undefined) {
    return steps;
  }
  const byName = new Map(steps.map(step => [step.name, step]));
  if (!byName.has(output)) {
    throw new Error('The selected output is unavailable for this build.');
  }
  const selected = new Set<OutputKind>();
  const include = (name: OutputKind): void => {
    if (selected.has(name)) {
      return;
    }
    const step = byName.get(name);
    if (!step) {
      throw new Error(`The build plan is missing its ${name} prerequisite.`);
    }
    for (const dependency of step.requires) {
      include(dependency);
    }
    selected.add(name);
  };
  include(output);
  return steps.filter(step => selected.has(step.name));
}

/** Format argv as a readable, copyable shell command for the transcript. */
export function serialize(args: readonly string[]): string {
  return args
    .map(argument => {
      if (argument.includes('\0')) {
        throw new Error('Compiler arguments cannot contain null bytes.');
      }
      if (/^[A-Za-z0-9_./:=+,-]+$/.test(argument)) {
        return argument;
      }
      return "'" + argument.replace(/'/g, "'\\''") + "'";
    })
    .join(' ');
}
