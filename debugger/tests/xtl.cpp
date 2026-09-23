#include <xtl/xoptional.hpp>

int optional_score(int input) {
  xtl::xoptional<int> doubled;
  if (input > 0)
    doubled = input * 2;

  bool present = doubled.has_value();
  int score = present ? doubled.value() + 5 : -1;
  return score;
}

int main() { return optional_score(13); }
