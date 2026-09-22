import Foundation

/// The `AskUserQuestion` tool's payload, and the answer format the agent
/// expects back.
///
/// The answer travels as a **deny** carrying a message — there is no separate
/// answer channel — so its wording is a contract with the desktop and must
/// stay byte-identical.
public enum Questions {
  public struct Option: Sendable, Hashable, Identifiable {
    public var label: String
    public var description: String?
    public var id: String { label }
  }

  public struct Question: Sendable, Hashable, Identifiable {
    public var question: String
    public var header: String?
    public var options: [Option]
    public var multiSelect: Bool
    public var id: String { header ?? question }
  }

  /// The synthetic "type your own answer" row.
  public static let customKey = "__argus_custom__"

  public static func parse(_ input: [String: JSONValue]) -> [Question]? {
    guard let raw = input["questions"]?.arrayValue else { return nil }
    let questions: [Question] = raw.compactMap { entry in
      guard let object = entry.objectValue,
        let text = object["question"]?.stringValue
      else { return nil }
      let options = (object["options"]?.arrayValue ?? []).compactMap { option -> Option? in
        guard let fields = option.objectValue,
          let label = fields["label"]?.stringValue
        else { return nil }
        return Option(label: label, description: fields["description"]?.stringValue)
      }
      let multi: Bool
      if case .bool(let flag) = object["multiSelect"] ?? .null { multi = flag } else { multi = false }
      return Question(
        question: text, header: object["header"]?.stringValue,
        options: options, multiSelect: multi)
    }
    return questions.isEmpty ? nil : questions
  }

  /// Assemble the answer exactly as the desktop's QuestionForm does.
  public static func formatAnswer(
    questions: [Question], picks: [Int: [String]], custom: [Int: String]
  ) -> String {
    var lines = ["The user answered:"]
    for (index, question) in questions.enumerated() {
      let chosen = (picks[index] ?? []).filter { $0 != customKey }
      let usesCustom = (picks[index] ?? []).contains(customKey)
      let note = (custom[index] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

      var parts: [String] = []
      if !chosen.isEmpty { parts.append(chosen.joined(separator: ", ")) }
      if usesCustom, !note.isEmpty {
        parts.append(chosen.isEmpty ? note : "note: \(note)")
      }
      lines.append("- \(question.header ?? question.question): \(parts.joined(separator: " — "))")
    }
    return lines.joined(separator: "\n")
  }

  /// Recover the selections from a formatted answer, so an already-answered
  /// question renders as ticks rather than as raw text.
  public static func parseAnswer(_ text: String, questions: [Question])
    -> [Int: (picks: [String], note: String?)]
  {
    var result: [Int: (picks: [String], note: String?)] = [:]
    let lines = text.components(separatedBy: "\n").dropFirst()

    for line in lines {
      guard line.hasPrefix("- "), let colon = line.firstIndex(of: ":") else { continue }
      let header = String(line[line.index(line.startIndex, offsetBy: 2)..<colon])
        .trimmingCharacters(in: .whitespaces)
      guard let index = questions.firstIndex(where: { ($0.header ?? $0.question) == header })
      else { continue }

      var remainder = String(line[line.index(after: colon)...])
        .trimmingCharacters(in: .whitespaces)

      // Longest label first, so "Yes, always" isn't eaten by "Yes".
      var picks: [String] = []
      for option in questions[index].options.sorted(by: { $0.label.count > $1.label.count })
      where remainder.contains(option.label) {
        picks.append(option.label)
        remainder = remainder.replacingOccurrences(of: option.label, with: "")
      }

      let note = remainder
        .replacingOccurrences(of: "note:", with: "")
        .trimmingCharacters(in: CharacterSet(charactersIn: " ,—-"))
      result[index] = (
        picks: questions[index].options.map(\.label).filter { picks.contains($0) },
        note: note.isEmpty ? nil : note
      )
    }
    return result
  }
}

/// Canned replies the agent receives, kept byte-identical to the desktop so it
/// sees one wording no matter which client the user answered from.
public enum CannedReply {
  public static let cancelQuestion =
    "The user cancelled the question prompt without answering. Proceed with reasonable assumptions and note them."

  public static let keepPlanning =
    "The user rejected the plan and wants to keep refining it. Incorporate their feedback once provided."

  public static func planFeedback(_ feedback: String) -> String {
    """
    The user wants to refine the plan before approving it. Their feedback:

    \(feedback)

    Incorporate this feedback and propose an updated plan via ExitPlanMode.
    """
  }
}
