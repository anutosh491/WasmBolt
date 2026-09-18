import type { Language } from './compiler/types';

export const examples: Readonly<Record<Language, string>> = {
  cpp: `int sum_invariant(int count, int scale) {
  int total = 0;

  for (int i = 0; i < count; ++i) {
    const int invariant = scale * 3;
    total += invariant;
  }

  return total;
}
`,
  c: `int square_plus_one(int value) {
  int squared = value * value;
  return squared + 1;
}

int main(void) {
  return square_plus_one(6);
}
`,
  llvm: `define i32 @sum_to(i32 %n) {
entry:
  %positive = icmp sgt i32 %n, 0
  br i1 %positive, label %loop, label %done

loop:
  %i = phi i32 [ 1, %entry ], [ %next, %loop ]
  %sum = phi i32 [ 0, %entry ], [ %total, %loop ]
  %total = add i32 %sum, %i
  %next = add i32 %i, 1
  %more = icmp sle i32 %next, %n
  br i1 %more, label %loop, label %done

done:
  %result = phi i32 [ 0, %entry ], [ %total, %loop ]
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

/** A custom example proving headers from an emscripten-forge package work. */
export const xtensorExample = `#include <xtensor/containers/xarray.hpp>
#include <xtensor/core/xmath.hpp>
#include <xtensor/core/xoperation.hpp>

int xtensor_broadcast_sum(int scale) {
  xt::xarray<int> values = {{1, 2, 3}, {4, 5, 6}};
  xt::xarray<int> offsets = {10, 20, 30};
  auto shifted = values + offsets;
  int total = static_cast<int>(xt::sum(shifted)());
  int result = total * scale;
  return result;
}

int main() {
  return xtensor_broadcast_sum(2);
}
`;
