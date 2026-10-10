volatile int observed = 0;

int busy_work(int iterations) {
  int total = 0;
  for (int index = 0; index < iterations; ++index) {
    total = (total + index) ^ (index >> 2);
    observed = total;
  }
  return total;
}

int main() {
  busy_work(20000000);
  return 42;
}
