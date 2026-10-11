func doubledSum(_ values: [Int]) -> Int {
  var total = 0
  for value in values {
    total += value * 2
  }
  return total
}

let values = [1, 2, 3, 4]
let answer = doubledSum(values)
print("Swift array sum: \(answer)")
