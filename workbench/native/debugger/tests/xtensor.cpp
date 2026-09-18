#include <xtensor/containers/xarray.hpp>
#include <xtensor/core/xmath.hpp>
#include <xtensor/core/xoperation.hpp>

extern "C" int xtensor_broadcast_sum(int scale) {
  xt::xarray<int> values = {{1, 2, 3}, {4, 5, 6}};
  xt::xarray<int> offsets = {10, 20, 30};
  auto shifted = values + offsets;
  int total = static_cast<int>(xt::sum(shifted)());
  int result = total * scale;
  return result;
}

int main() {
  int scale = 2;
  int result = xtensor_broadcast_sum(scale);
  return result;
}
