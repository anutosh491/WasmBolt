int clamp(int value, int low, int high) {
  if (value < low)
    return low;
  if (value > high)
    return high;
  return value;
}

int main(void) {
  int input = 17;
  int result = clamp(input, 0, 10);
  return result;
}
