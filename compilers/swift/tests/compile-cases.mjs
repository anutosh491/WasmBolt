export const frontend = [
  'swift-frontend',
  '-target',
  'wasm32-unknown-emscripten',
  '-sdk',
  '/',
  '-resource-dir',
  '/swift/lib/swift',
  '-module-name',
  'WasmBolt',
  '-num-threads',
  '0',
  '-disable-implicit-concurrency-module-import',
  '-disable-implicit-string-processing-module-import',
  '-Xcc',
  '-isystem',
  '-Xcc',
  '/include/compat',
  '-Xcc',
  '-fPIC',
  '-Xcc',
  '-mno-reference-types',
  '-Xcc',
  '-resource-dir=/swift/lib/swift/clang',
  '-Onone'
];

export const runtime = [
  '/swift/lib/swift/emscripten/wasm32/swiftrt.o',
  '-L/swift/lib/swift/emscripten/wasm32',
  '-lswiftSwiftOnoneSupport',
  '-lswiftCore',
  '-lswiftCommandLineSupport'
];

export const systemFiles = [
  'crt1.o',
  'libstandalonewasm-nocatch.a',
  'libstubs-debug.a',
  'libc-debug.a',
  'libdlmalloc-debug.a',
  'libclang_rt.builtins.a',
  'libc++-debug-noexcept.a',
  'libc++abi-debug-noexcept.a'
];

const link = (object, output) => [
  'wasm-ld',
  '--threads=1',
  '--export-if-defined=__main_argc_argv',
  '--export=__wasm_call_ctors',
  '--export-dynamic',
  '--export-memory',
  '-z',
  'stack-size=16777216',
  object,
  ...runtime,
  '/lib/wasm32-emscripten/crt1.o',
  '-L/lib/wasm32-emscripten',
  '-lstandalonewasm-nocatch',
  '-lstubs-debug',
  '-lc-debug',
  '-ldlmalloc-debug',
  '-lclang_rt.builtins',
  '-lc++-debug-noexcept',
  '-lc++abi-debug-noexcept',
  '-o',
  output
];

/** Exercise real frontend actions and successful linking in the same module. */
export function compileCases(module, run, source, arrays) {
  const results = [];
  const execute = args => {
    console.log(`Swift check: ${args.join(' ')}`);
    const result = run(args);
    results.push({ args, ...result });
    if (result.code !== 0) {
      throw new Error(`${args.join(' ')} failed:\n${result.stderr}`);
    }
    return result;
  };
  module.FS.mkdirTree('/workspace');
  module.FS.chdir('/workspace');
  module.FS.writeFile('/workspace/main.swift', source);
  const ast = execute([...frontend, '-dump-ast', '/workspace/main.swift']);
  if (
    !ast.stdout.includes('func_decl') ||
    ast.stdout.includes('<<error type>>')
  ) {
    throw new Error('The Swift AST output did not contain a function.');
  }
  for (const [action, file] of [
    ['-emit-sil', 'output.sil'],
    ['-emit-ir', 'output.ll'],
    ['-S', 'output.s'],
    ['-emit-object', 'output.o']
  ]) {
    execute([
      ...frontend,
      ...(action === '-emit-object'
        ? ['-gdwarf-types', '-dwarf-version=4']
        : []),
      action,
      '/workspace/main.swift',
      '-o',
      file
    ]);
    if (module.FS.stat(`/workspace/${file}`).size === 0) {
      throw new Error(`Swift produced an empty ${file}.`);
    }
    if (
      action === '-emit-sil' &&
      !module.FS.readFile(`/workspace/${file}`, { encoding: 'utf8' }).includes(
        'sil_stage canonical'
      )
    ) {
      throw new Error('Swift did not produce canonical SIL.');
    }
  }
  execute(link('/workspace/output.o', '/workspace/program.wasm'));
  if (!WebAssembly.validate(module.FS.readFile('/workspace/program.wasm'))) {
    throw new Error(
      'Swift and LLD did not produce a valid WebAssembly module.'
    );
  }
  module.FS.writeFile('/workspace/main.swift', 'let broken: Int = "bad"\n');
  const invalid = run([
    ...frontend,
    '-emit-object',
    '/workspace/main.swift',
    '-o',
    '/workspace/invalid.o'
  ]);
  if (invalid.code !== 1 || !invalid.stderr.includes('error:')) {
    throw new Error('Swift did not report the expected source diagnostic.');
  }
  results.push({ invalidSource: true, ...invalid });
  module.FS.writeFile('/workspace/main.swift', arrays);
  execute([
    ...frontend,
    '-gdwarf-types',
    '-dwarf-version=4',
    '-emit-object',
    '/workspace/main.swift',
    '-o',
    '/workspace/arrays.o'
  ]);
  execute(link('/workspace/arrays.o', '/workspace/arrays.wasm'));
  for (const [name, text, optimization] of [
    ['simple-o', source, '-O'],
    ['arrays-o', arrays, '-O'],
    ['arrays-osize', arrays, '-Osize']
  ]) {
    module.FS.writeFile('/workspace/main.swift', text);
    execute([
      ...frontend.filter(flag => flag !== '-Onone'),
      optimization,
      '-emit-object',
      '/workspace/main.swift',
      '-o',
      `/workspace/${name}.o`
    ]);
    execute(link(`/workspace/${name}.o`, `/workspace/${name}.wasm`));
  }
  return results;
}
