@_cdecl("add")
public func add(_ left: Int32, _ right: Int32) -> Int32 {
  let sum = left + right
  return sum
}

let answer = add(19, 23)
print("Swift answer: \(answer)")
