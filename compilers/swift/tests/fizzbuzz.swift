func fizzBuzz(through limit: Int) {
  var number = 1
  while number <= limit {
    if number % 15 == 0 {
      print("FizzBuzz")
    } else if number % 3 == 0 {
      print("Fizz")
    } else if number % 5 == 0 {
      print("Buzz")
    } else {
      print(number)
    }
    number += 1
  }
}

print("Hello, 🌐!")
fizzBuzz(through: 20)
