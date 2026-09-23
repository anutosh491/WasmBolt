#include <iostream>

int clamp(int value, int low, int high) {
  if (value < low)
    return low;
  if (value > high)
    return high;
  return value;
}

int add_bonus(int score, int bonus) {
  return clamp(score + bonus, 0, 100);
}

int calculate_score(int base) {
  int doubled = base * 2;
  int score = add_bonus(doubled, 5);
  return score;
}

int main() {
  int score = calculate_score(10);
  std::cout << "score=" << score << '\n';
  return score;
}
