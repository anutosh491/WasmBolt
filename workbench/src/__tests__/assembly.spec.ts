import { assemblyText } from '../compiler/assembly';

it('hides Wasm provenance and retains the following data section', () => {
  const text = [
    '\t.file "snippet.cpp"',
    '\t.section .text.square,"",@',
    'square:',
    '\t.functype square (i32) -> (i32)',
    '\ti32.mul',
    '\tend_function',
    '\t.ident "clang"',
    '\t.section .custom_section.producers,"",@',
    '\t.int8 1',
    '\t.ascii "clang"',
    '\t.section .custom_section.target_features,"",@',
    '\t.ascii "simd128"',
    '\t.section .rodata',
    '\t.int8 42',
    '\t.ascii "data"',
    ''
  ];
  expect(assemblyText(text.join('\n'))).toBe(
    [...text.slice(1, 6), ...text.slice(12)].join('\n')
  );
});

it('retains native data, alignment, unwind, and symbol directives', () => {
  const text = [
    '.globl square',
    '.type square,@function',
    '.p2align 4',
    'square:',
    '.cfi_startproc',
    'imul eax, edi',
    '.cfi_endproc',
    '.section .rodata',
    '.string "clang"',
    '.size square, .-square'
  ].join('\n');
  expect(assemblyText(text)).toBe(text);
});
