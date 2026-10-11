import createCompiler from '/compiler/wasmbolt-swift.js';
import { unpackTar } from '/support/archive.mjs';
import { compileCases } from '/compile-cases.mjs';
import { runStandalone } from '/support/standalone.mjs';

self.onmessage = async () => {
  let module;
  try {
    let stdout = '';
    let stderr = '';
    module = await createCompiler({
      locateFile: name => new URL(`/compiler/${name}`, self.location).href,
      noInitialRun: true,
      noExitRuntime: true,
      print: text => (stdout += text + '\n'),
      printErr: text => (stderr += text + '\n')
    });
    const invoke = module.cwrap('wb_swift_run', 'number', ['string']);
    const reusable = module.cwrap('wb_swift_can_run_again', 'number', []);
    const results = [];
    for (const args of [
      ['swift-frontend', '-version'],
      ['wasm-ld', '--version'],
      ['swift-frontend', '-unknown-wasmbolt-option'],
      ['wasm-ld', '/workspace/missing.o'],
      ['swift-frontend', '-version'],
      ['wasm-ld', '--version']
    ]) {
      stdout = '';
      stderr = '';
      const code = invoke(JSON.stringify(args));
      results.push({ args, code, stdout, stderr, reusable: reusable() });
    }
    const sdk = await fetch('/swift-package/runtime.tar.gz');
    const archive = sdk.body.pipeThrough(new DecompressionStream('gzip'));
    unpackTar(
      module.FS,
      new Uint8Array(await new Response(archive).arrayBuffer())
    );
    const run = args => {
      stdout = '';
      stderr = '';
      const code = invoke(JSON.stringify(args));
      return { code, stdout, stderr };
    };
    const compilation = compileCases(
      module,
      run,
      await (await fetch('/scalar.swift')).text(),
      await (await fetch('/arrays.swift')).text()
    );
    const execution = [];
    for (const [name, file] of [
      ['simple', 'program'],
      ['arrays', 'arrays'],
      ['simple-o', 'simple-o'],
      ['arrays-o', 'arrays-o'],
      ['arrays-osize', 'arrays-osize']
    ]) {
      const bytes = module.FS.readFile(`/workspace/${file}.wasm`);
      if (name === 'simple' || name === 'arrays') {
        const saved = await fetch(`/save/${name}/program.wasm`, {
          method: 'POST',
          body: bytes
        });
        if (!saved.ok)
          throw new Error('Unable to save the compiled test program.');
      }
      for (let repeat = 0; repeat < 2; repeat++) {
        const result = await runStandalone(
          bytes,
          `/workspace/${name}.wasm`,
          '__main_argc_argv',
          { params: ['i32', 'i32'], results: ['i32'] },
          [0, 0]
        );
        if (result.value.status !== 'success')
          throw new Error(JSON.stringify(result));
        execution.push(result);
      }
    }
    self.postMessage({
      success: true,
      isolated: self.crossOriginIsolated,
      results,
      compilation,
      execution,
      reusable: reusable()
    });
  } catch (error) {
    self.postMessage({ success: false, message: String(error) });
  } finally {
    module?.PThread.terminateAllThreads();
  }
};
