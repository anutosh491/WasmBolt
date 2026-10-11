import Foundation

func describe(_ startsAt: Date, durationMinutes: Int) {
  let endsAt = startsAt.addingTimeInterval(Double(durationMinutes * 60))
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone(secondsFromGMT: 0)
  formatter.dateFormat = "yyyy-MM-dd HH:mm 'UTC'"
  let now = Date()
  print("Now:", formatter.string(from: now))
  print("Starts:", formatter.string(from: startsAt))
  print("Ends:", formatter.string(from: endsAt))
}

describe(Date(timeIntervalSince1970: 1_700_000_000), durationMinutes: 45)
