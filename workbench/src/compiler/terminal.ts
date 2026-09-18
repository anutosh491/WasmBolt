export type Command = Readonly<{
  tool: string;
  args: readonly string[];
  stdout: string | null;
  stderr: string | null;
}>;

const utilityNames: Readonly<Record<string, string>> = {
  'llvm-ar': 'ar',
  'llvm-cxxfilt': 'cxxfilt',
  'llvm-nm': 'nm',
  'llvm-objcopy': 'objcopy',
  'llvm-objdump': 'objdump',
  'llvm-readobj': 'readobj',
  'llvm-size': 'size'
};

export function utilitySubcommand(tool: string): string | null {
  return utilityNames[tool] ?? null;
}

/** A single GNU-quoted tool invocation with filesystem redirections. */
export function command(text: string): Command {
  const tokens: { text: string; redirect: boolean }[] = [];
  let word = '';
  let started = false;
  let quote = '';
  const finish = () => {
    if (started) {
      tokens.push({ text: word, redirect: false });
      word = '';
      started = false;
    }
  };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '\0') {
      throw new Error('Commands cannot contain null bytes.');
    }
    if (character === '\\' && quote !== "'") {
      if (++i === text.length) {
        throw new Error('A command cannot end with an escape.');
      }
      word += text[i];
      started = true;
    } else if (quote) {
      if (character === quote) {
        quote = '';
      } else {
        word += character;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      finish();
    } else if (character === '>') {
      const descriptor = word === '2' ? '2>' : '>';
      if (word === '2') {
        word = '';
        started = false;
      }
      finish();
      tokens.push({ text: descriptor, redirect: true });
    } else if ('|;&<'.includes(character)) {
      // LLVM pass names use angle brackets: quote pipelines containing them.
      throw new Error(
        'Quote special characters in arguments; use one command.'
      );
    } else {
      started = true;
      word += character;
    }
  }
  if (quote) {
    throw new Error('Unclosed quote in command.');
  }
  finish();
  const args: string[] = [];
  let stdout: string | null = null;
  let stderr: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.redirect) {
      args.push(token.text);
      continue;
    }
    const path = tokens[++i];
    if (!path || path.redirect || !path.text) {
      throw new Error('Redirection requires a filename.');
    }
    if (token.text === '2>') {
      stderr = path.text;
    } else {
      stdout = path.text;
    }
  }
  const tool = args[0];
  if (
    ![
      'clang',
      'clang++',
      'opt',
      'llc',
      'wasm-ld',
      'mlir-opt',
      'mlir-translate',
      'dot'
    ].includes(tool) &&
    utilitySubcommand(tool) === null
  ) {
    throw new Error(
      'Choose a compiler, linker, MLIR driver, Graphviz or LLVM utility.'
    );
  }
  return { tool, args, stdout, stderr };
}
