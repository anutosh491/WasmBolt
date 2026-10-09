export const examples = {
  cpp: `int sum_invariant(int N, int x) {
  int out = 0;

  for (int i = 0; i < N; ++i) {
    int invariant = x * 3;
    out += invariant;
  }

  return out > 0 ? out : 0;
}`,
  c: `int sum_invariant(int N, int x) {
  int out = 0;

  for (int i = 0; i < N; ++i) {
    int invariant = x * 3;
    out += invariant;
  }

  return out;
}`,
  mlir: `module {
  func.func @matmul(%lhs: tensor<2x3xf32>, %rhs: tensor<3x2xf32>) -> tensor<2x2xf32> {
    %zero = arith.constant 0.0 : f32
    %empty = tensor.empty() : tensor<2x2xf32>
    %initialized = linalg.fill ins(%zero : f32)
      outs(%empty : tensor<2x2xf32>) -> tensor<2x2xf32>
    %result = linalg.matmul
      ins(%lhs, %rhs : tensor<2x3xf32>, tensor<3x2xf32>)
      outs(%initialized : tensor<2x2xf32>) -> tensor<2x2xf32>
    return %result : tensor<2x2xf32>
  }
}`,
  llvm: `define i32 @absolute_difference(i32 %a, i32 %b) {
entry:
  %greater = icmp sgt i32 %a, %b
  br i1 %greater, label %a_greater, label %b_greater

a_greater:
  %left = sub i32 %a, %b
  ret i32 %left

b_greater:
  %right = sub i32 %b, %a
  ret i32 %right
}`,
};

