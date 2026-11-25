import ArgusKit
import Foundation

/// What voice mode says aloud and how it reads what it hears back. Pure, so it's tested without audio.
public enum SpokenText {
  /// Replies past this are cut at a sentence and the rest left on screen.
  static let replyLimit = 1200

  /// A reply as speech: code and tables skipped, markdown dropped, links named rather than spelled out.
  public static func reply(_ markdown: String) -> String {
    var sentences: [String] = []
    var inFence = false
    var skippedCode = false
    var skippedTable = false
    for raw in markdown.components(separatedBy: .newlines) {
      let line = raw.trimmingCharacters(in: .whitespaces)
      if line.hasPrefix("```") || line.hasPrefix("~~~") {
        if !inFence, !skippedCode {
          sentences.append("Code is on screen.")
          skippedCode = true
        }
        inFence.toggle()
        continue
      }
      if inFence { continue }
      if line.hasPrefix("|") {
        if !skippedTable { sentences.append("A table is on screen.") }
        skippedTable = true
        continue
      }
      skippedTable = false
      let spoken = inline(stripBlockMarkers(line))
      guard !spoken.isEmpty else { continue }
      // A list item or heading reads as its own sentence.
      sentences.append(spoken.last.map { ".!?:".contains($0) } == true ? spoken : spoken + ".")
    }
    return truncated(sentences.joined(separator: " "))
  }

  /// A permission prompt, ending in the question voice mode listens for the answer to.
  public static func permission(name: String, input: [String: JSONValue]) -> String {
    "The agent wants to \(action(name: name, input: input)). Allow or deny?"
  }

  /// A prompt voice mode can't answer: a question, a plan or a secret.
  public static func onScreen(_ title: String) -> String { "\(title). It's on screen." }

  public static let repeatAnswer = "Say allow or deny."

  // MARK: Hearing

  public enum Answer: Equatable, Sendable {
    case allow, deny
  }

  private static let allowWords: Set<String> = [
    "allow", "allowed", "yes", "yeah", "yep", "approve", "approved", "ok", "okay", "sure", "go ahead", "do it",
    "allow it", "yes please", "accept",
  ]
  private static let denyWords: Set<String> = [
    "deny", "denied", "no", "nope", "reject", "don't", "dont", "do not", "decline", "stop", "deny it", "no thanks",
    "cancel",
  ]

  /// The whole utterance must be the answer, so a sentence that merely contains "no" isn't one.
  public static func answer(_ transcript: String) -> Answer? {
    let said = words(transcript).joined(separator: " ")
    if allowWords.contains(said) { return .allow }
    if denyWords.contains(said) { return .deny }
    return nil
  }

  /// The words heard that the speaker didn't just say: with no echo cancellation the microphone hears the reply too.
  public static func novelWords(in transcript: String, spoken: String) -> [String] {
    let echo = Set(words(spoken))
    return words(transcript).filter { !echo.contains($0) }
  }

  /// How many of the transcript's first words are the reply's own, heard back through the microphone.
  public static func echoLength(_ transcript: String, spoken: String) -> Int {
    let echo = Set(words(spoken))
    let parts = transcript.split(whereSeparator: \.isWhitespace)
    return parts.firstIndex { !echo.contains(normalized($0)) } ?? parts.count
  }

  /// The transcript past its first `count` words.
  public static func dropping(_ count: Int, wordsOf transcript: String) -> String {
    transcript.split(whereSeparator: \.isWhitespace).dropFirst(count).joined(separator: " ")
  }

  // MARK: Internals

  static func words(_ text: String) -> [String] {
    text.split(whereSeparator: \.isWhitespace).map(normalized).filter { !$0.isEmpty }
  }

  private static func normalized(_ word: Substring) -> String {
    word.lowercased().replacingOccurrences(of: "\u{2019}", with: "'")
      .trimmingCharacters(in: CharacterSet.punctuationCharacters.subtracting(["'"]))
  }

  private static func action(name: String, input: [String: JSONValue]) -> String {
    func file() -> String {
      (input["file_path"]?.stringValue ?? input["notebook_path"]?.stringValue)
        .map { URL(fileURLWithPath: $0).lastPathComponent } ?? "a file"
    }
    switch name {
    case "Bash":
      guard let command = input["command"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
        !command.isEmpty
      else { return "run a command" }
      return command.count <= 80 && !command.contains("\n") ? "run \(command)" : "run a long command"
    case "Edit", "MultiEdit", "NotebookEdit": return "edit \(file())"
    case "Write": return "write \(file())"
    case "Read": return "read \(file())"
    case "WebFetch": return "fetch a web page"
    case "WebSearch": return "search the web"
    default:
      // `mcp__server__tool` reads as its tool.
      let tool = name.hasPrefix("mcp__") ? String(name.split(separator: "_").last ?? "") : name
      return "use \(tool.isEmpty ? name : tool)"
    }
  }

  private static func stripBlockMarkers(_ line: String) -> String {
    var line = Substring(line)
    while let first = line.first, "#>".contains(first) { line = line.dropFirst() }
    if line.hasPrefix("- [ ] ") || line.hasPrefix("- [x] ") {
      line = line.dropFirst(6)
    } else if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") {
      line = line.dropFirst(2)
    }
    if let dot = line.firstIndex(of: "."), line[..<dot].allSatisfy(\.isNumber), !line[..<dot].isEmpty {
      line = line[line.index(after: dot)...]
    }
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    // A horizontal rule says nothing.
    return trimmed.allSatisfy { "-*_".contains($0) } ? "" : trimmed
  }

  private static func inline(_ text: String) -> String {
    var text = text
    // [label](url) reads as its label; a bare URL as "a link".
    text = text.replacingOccurrences(of: #"!?\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
    text = text.replacingOccurrences(of: #"https?://\S+"#, with: "a link", options: .regularExpression)
    text = text.replacingOccurrences(of: #"(\*\*|__|\*|_|~~|`)"#, with: "", options: .regularExpression)
    return text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespaces)
  }

  private static func truncated(_ text: String) -> String {
    guard text.count > replyLimit else { return text }
    let head = text.prefix(replyLimit)
    let cut = head.lastIndex(where: { ".!?".contains($0) }).map { head[...$0] } ?? head
    return cut + " The rest is on screen."
  }
}
