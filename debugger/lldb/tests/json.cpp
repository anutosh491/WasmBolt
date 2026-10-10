#include <nlohmann/json.hpp>

int json_score(const char *text) {
  nlohmann::json document = nlohmann::json::parse(text);
  int base = document.at("base").get<int>();
  int bonus = document.at("bonus").get<int>();
  int score = base + bonus;
  return score;
}

int main() {
  return json_score(R"({"base": 35, "bonus": 7})");
}
