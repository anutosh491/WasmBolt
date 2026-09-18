const { cpSync } = require('node:fs');
const { resolve } = require('node:path');

module.exports = {
  module: {
    rules: [
      {
        test: /compiler[/\\]worker\.js$/,
        type: 'asset/resource',
        generator: { filename: 'compiler/worker.js' }
      }
    ]
  },
  plugins: [
    {
      apply(compiler) {
        compiler.hooks.afterEmit.tap('WasmBoltCompiler', () => {
          cpSync(
            resolve(__dirname, 'compiler'),
            resolve(compiler.options.output.path, 'compiler'),
            { recursive: true }
          );
        });
      }
    }
  ]
};
