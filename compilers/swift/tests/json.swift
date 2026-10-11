import FoundationEssentials

struct Meeting: Codable {
  let title: String
  let attendees: [String]
}

func roundTrip(_ meeting: Meeting) throws {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  let data = try encoder.encode(meeting)
  let decoded = try JSONDecoder().decode(Meeting.self, from: data)
  print("Meeting:", decoded.title)
  print("Attendees:", decoded.attendees.joined(separator: ", "))
  print("JSON:\n" + String(decoding: data, as: UTF8.self))
}

try roundTrip(Meeting(title: "Swift in your browser", attendees: ["Ada", "Grace", "Linus"]))
