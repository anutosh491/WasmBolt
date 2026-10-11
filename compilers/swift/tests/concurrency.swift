actor Scoreboard {
  private var score = 0

  func add(_ points: Int) { score += points }
  func total() -> Int { score }
}

func report(_ result: Int) {
  print("Async sum of squares:", result)
}

let scoreboard = Scoreboard()
await withTaskGroup(of: Void.self) { group in
  for number in 1...5 {
    group.addTask { await scoreboard.add(number * number) }
  }
}
let total = await scoreboard.total()
report(total)
