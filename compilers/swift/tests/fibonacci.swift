func fibonacci(_ n: Int) -> Int {
  if n < 2 { return n }
  var previous = 0
  var current = 1
  var index = 2
  while index <= n {
    let next = previous + current
    previous = current
    current = next
    index += 1
  }
  return current
}

let n = 10
let answer = fibonacci(n)
print("Fibonacci(\(n)) = \(answer)")
