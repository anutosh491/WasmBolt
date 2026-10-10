import { startSwiftRepl, evaluateSwiftRepl, stopSwiftRepl } from '/compilers/swift/repl.js';

export async function checkRepl() {
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  try {
    const initialized = await startSwiftRepl();
    check(initialized.code === 0, JSON.stringify(initialized));
    const cells = [
      ['var counter = 1'], ['counter += 1'], ['print(counter)', '2'],
      ['counter', /2/], ['print("Hello, 🌐!")', 'Hello, 🌐!'],
      ['func fib(_ n: Int) -> Int {', null, true],
      ['if n < 2 { return n }', null, true],
      ['return fib(n - 1) + fib(n - 2)', null, true], ['}'],
      ['print(fib(10))', '55'], ['let numbers = [1, 2, 3]'],
      ['print(numbers.map { $0 * 2 })', '[2, 4, 6]'],
      ['let broken: Int = "no"', null, false, 1], ['print(counter)', '2'],
      ['let broken: Int = 9'], ['print(broken)', '9'],
      ['struct Point { var x: Int; var y: Int }'],
      ['let point = Point(x: 2, y: 3)'], ['print(point.x + point.y)', '5'],
      ['print("Answer: \\(fib(10))")', 'Answer: 55'],
      ['func identity<T>(_ value: T) -> T { value }'], ['print(identity(42))', '42'],
      ['class Counter { var value: Int; init(_ value: Int) { self.value = value }; func next() -> Int { value += 1; return value } }'],
      ['let box = Counter(10)'], ['print(box.next())', '11'],
      ['enum Choice { case left(Int), right }'], ['let choice = Choice.left(7)'],
      ['if case let .left(value) = choice { print(value) }', '7']
    ];
    for (const [source, expected, incomplete = false, code = 0] of cells) {
      const result = await evaluateSwiftRepl(source);
      results.push({ source, ...result });
      console.log(JSON.stringify(results.at(-1)));
      check(result.code === code, JSON.stringify(result));
      check(Boolean(result.incomplete) === incomplete, `Incomplete input: ${source}`);
      if (expected instanceof RegExp)
        check(expected.test(result.stdout.join('\n')), `Output: ${source}`);
      else if (expected != null)
        check(result.stdout.join('\n') === expected, `Output: ${source}`);
    }
    stopSwiftRepl();
    check((await startSwiftRepl()).code === 0, 'Reset initialization');
    const cleared = await evaluateSwiftRepl('print(counter)');
    check(cleared.code === 1, 'Reset must discard previous definitions');
    const fresh = await evaluateSwiftRepl('print(42)');
    check(fresh.code === 0 && fresh.stdout.join('\n') === '42', 'Fresh session');
    return { success: true, results, cleared, fresh };
  } catch (error) {
    return { success: false, message: error.message, results };
  } finally {
    stopSwiftRepl();
  }
}
