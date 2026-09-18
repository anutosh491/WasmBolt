import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2]);
const opt = await import(pathToFileURL(resolve(directory, 'mlir-opt.js')));
const translate = await import(
  pathToFileURL(resolve(directory, 'mlir-translate.js'))
);

async function run(factory, argv, inputPath, input, outputPath) {
  const stdout = [];
  const stderr = [];
  const module = await factory({
    noInitialRun: true,
    print: line => stdout.push(String(line)),
    printErr: line => stderr.push(String(line))
  });
  module.FS.mkdirTree('/workspace');
  module.FS.writeFile(inputPath, input);
  let status = 0;
  try {
    module.callMain(argv);
  } catch (error) {
    if (error?.name !== 'ExitStatus') {
      throw error;
    }
    status = error.status;
  }
  if (status !== 0) {
    throw new Error(stderr.join('\n') || `tool exited with ${status}`);
  }
  return module.FS.readFile(outputPath, { encoding: 'utf8' });
}

const source = `module {
  func.func @add(%x: i32, %y: i32) -> i32 {
    %sum = arith.addi %x, %y : i32
    return %sum : i32
  }
}
`;
const pipeline =
  'builtin.module(canonicalize,cse,convert-arith-to-llvm,' +
  'convert-func-to-llvm,reconcile-unrealized-casts)';
const optimized = await run(
  opt.default,
  [
    `--pass-pipeline=${pipeline}`,
    '/workspace/input.mlir',
    '-o',
    '/workspace/optimized.mlir'
  ],
  '/workspace/input.mlir',
  source,
  '/workspace/optimized.mlir'
);
const llvm = await run(
  translate.default,
  [
    '--mlir-to-llvmir',
    '/workspace/optimized.mlir',
    '-o',
    '/workspace/source.ll'
  ],
  '/workspace/optimized.mlir',
  optimized,
  '/workspace/source.ll'
);

if (
  !optimized.includes('llvm.func @add') ||
  !llvm.includes('define i32 @add')
) {
  throw new Error('MLIR smoke output is incomplete.');
}
process.stdout.write('MLIR optimization and translation smoke passed.\n');
