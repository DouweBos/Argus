import ArgusKit
import Foundation

/// Who wrote a line: an agent's edit tool call, or a person who changed it afterwards.
public enum LineAuthor: String, Hashable, Sendable {
  case agent, human
}

/// Marked lines of a session's files as the worktree has them now, by path, then 1-based line.
public struct LineAttribution: Hashable, Sendable {
  public var files: [String: [Int: LineAuthor]]

  public init(files: [String: [Int: LineAuthor]] = [:]) {
    self.files = files
  }

  init(_ wire: ArgusProtocol.LineAttribution) {
    var files: [String: [Int: LineAuthor]] = [:]
    for file in wire.files {
      var lines: [Int: LineAuthor] = [:]
      for range in file.ranges where range.start <= range.end {
        let author: LineAuthor = range.author == .human ? .human : .agent
        for line in range.start...range.end { lines[line] = author }
      }
      files[file.path] = lines
    }
    self.files = files
  }

  public func lines(_ path: String) -> [Int: LineAuthor] { files[path] ?? [:] }

  /// Runs of one author, 1-based and inclusive, for a file.
  public func ranges(_ path: String) -> [(lines: ClosedRange<Int>, author: LineAuthor)] {
    var runs: [(lines: ClosedRange<Int>, author: LineAuthor)] = []
    for (line, author) in lines(path).sorted(by: { $0.key < $1.key }) {
      if let last = runs.last, last.author == author, last.lines.upperBound == line - 1 {
        runs[runs.count - 1].lines = last.lines.lowerBound...line
      } else {
        runs.append((line...line, author))
      }
    }
    return runs
  }

  /// Only the working copy and the branch end at the tree as it is now, which is what the lines number.
  public static func applies(toDiffMode mode: String) -> Bool { mode == "working" || mode == "branch" }

  /// For telemetry: how many files carry marks, bucketed.
  public static func filesBucket(_ count: Int) -> String {
    switch count {
    case 0: "0"
    case 1: "1"
    case 2...5: "2-5"
    case 6...20: "6-20"
    default: "21+"
    }
  }
}

/// How many of a set of lines each author wrote.
public struct AttributionCounts: Hashable, Sendable {
  public var agent = 0
  public var human = 0

  public init(agent: Int = 0, human: Int = 0) {
    self.agent = agent
    self.human = human
  }

  public init(_ marks: [Int: LineAuthor], lines: some Sequence<Int>) {
    for line in lines {
      switch marks[line] {
      case .agent?: agent += 1
      case .human?: human += 1
      case nil: break
      }
    }
  }

  public var isEmpty: Bool { agent == 0 && human == 0 }
}

extension DiffFile {
  /// Its added lines' numbers on the new side, the ones attribution marks.
  public var addedLineNumbers: [Int] {
    hunks.flatMap(\.lines).compactMap { $0.kind == .add ? $0.newNumber : nil }
  }
}

extension HostStore {
  public func loadLineAttribution(sessionId: String) async throws -> LineAttribution {
    guard let backend else { return LineAttribution() }
    return LineAttribution(
      try await backend.request(ArgusProtocol.Methods.SessionsLineAttribution.self, .init(sessionId: sessionId)))
  }
}
