int add(int left, int right) {
  int result = left + right;
  return result;
}

int multiply(int value, int factor) {
  int result = value * factor;
  return result;
}

int compute(int input) {
  int sum = add(input, 4);
  int product = multiply(sum, 3);
  return product - 2;
}

int main() { return compute(7); }
