import ArgusKit
import Foundation

/// The code view's blame for one line: the commit that last changed it at `HEAD`, or that the
/// buffer's line isn't committed. Lines are 0-based, as `LineDiff` has them.
public enum LineBlame: Equatable, Sendable {
  case committed(Commit)
  case uncommitted

  public struct Commit: Equatable, Sendable {
    public let sha: String
    public let author: String
    public let date: Date
    public let summary: String

    public init(sha: String, author: String, date: Date, summary: String) {
      self.sha = sha
      self.author = author
      self.date = date
      self.summary = summary
    }
  }

  /// Git's own words for a line no commit has yet.
  public static let uncommittedLabel = "Not committed yet"

  /// Buffer line `line` against `hunks` (base = `HEAD`): unchanged lines are blamed at their `HEAD` line,
  /// lines inside a hunk aren't committed. Nil while the `HEAD` blame hasn't arrived.
  public static func of(line: Int, hunks: [LineDiff.Hunk], index: BlameIndex?) -> LineBlame? {
    guard let base = baseLine(for: line, hunks: hunks) else { return .uncommitted }
    guard let index else { return nil }
    return index.commit(atLine: base).map(LineBlame.committed)
  }

  /// Where buffer line `line` sits at `HEAD`, or nil when an edit made it.
  public static func baseLine(for line: Int, hunks: [LineDiff.Hunk]) -> Int? {
    var shift = 0
    for hunk in hunks {
      if line < hunk.new.lowerBound { break }
      if hunk.new.contains(line) { return nil }
      shift += hunk.old.count - hunk.new.count
    }
    return line + shift
  }

  /// "Ada Lovelace, 3 days ago": the status bar's and the inline annotation's lead.
  public func byline(now: Date = .now, locale: Locale = .current) -> String {
    switch self {
    case .uncommitted: return Self.uncommittedLabel
    case .committed(let commit):
      let formatter = RelativeDateTimeFormatter()
      formatter.locale = locale
      formatter.unitsStyle = .full
      formatter.dateTimeStyle = .named
      // Clock skew between machines can put a commit a few seconds in the future.
      let when = formatter.localizedString(for: min(commit.date, now), relativeTo: now)
      return "\(commit.author), \(when)"
    }
  }

  /// The byline and, for a commit, its summary.
  public func label(now: Date = .now, locale: Locale = .current) -> String {
    switch self {
    case .uncommitted: byline(now: now, locale: locale)
    case .committed(let commit):
      commit.summary.isEmpty ? byline(now: now, locale: locale) : "\(byline(now: now, locale: locale)) · \(commit.summary)"
    }
  }
}

/// A file's `git_blame_file` chunks, looked up by 0-based line.
public struct BlameIndex: Sendable {
  private struct Run: Sendable {
    let start: Int
    let end: Int
    let commit: LineBlame.Commit
  }

  private let runs: [Run]

  public init(chunks: [ArgusProtocol.BlameChunk]) {
    runs = chunks.map { chunk in
      let start = Int(chunk.lineStart) - 1
      return Run(
        start: start, end: start + Int(chunk.lineCount),
        commit: .init(
          sha: chunk.commitHash, author: chunk.author, date: Date(timeIntervalSince1970: chunk.authorTime / 1000),
          summary: chunk.summary))
    }
    .sorted { $0.start < $1.start }
  }

  public func commit(atLine line: Int) -> LineBlame.Commit? {
    var low = 0
    var high = runs.count
    while low < high {
      let mid = (low + high) / 2
      if runs[mid].end <= line { low = mid + 1 } else { high = mid }
    }
    guard low < runs.count, runs[low].start <= line else { return nil }
    return runs[low].commit
  }
}
