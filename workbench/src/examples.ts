import type { Language } from './compiler/types';

export const examples: Readonly<Record<Language, string>> = {
  cpp: `int square(int x) {
  return x * x;
}
`,
  c: `int square(int x) {
  return x * x;
}
`,
  llvm: `define i32 @square(i32 %x) {
entry:
  %result = mul i32 %x, %x
  ret i32 %result
}
`,
  mlir: `module {
  func.func @add(%x: i32, %y: i32) -> i32 {
    %sum = arith.addi %x, %y : i32
    return %sum : i32
  }
}
`
};
