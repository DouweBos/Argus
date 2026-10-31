import ArgusCore
import ArgusKit
import SwiftUI

/// A quick-open result: the file name, its directory, the matched letters in
/// accent, worded and set as the Mac's quick open.
public struct FuzzyFileRow: View {
  @Environment(\.theme) private var theme
  let match: FuzzyFileMatcher.Match

  public init(match: FuzzyFileMatcher.Match) {
    self.match = match
  }

  public var body: some View {
    let path = match.path
    let nameStart = path.utf16.count - SessionFilePaths.fileName(path).utf16.count
    HStack(spacing: 8) {
      FileTypeIcon(path: path)
      VStack(alignment: .leading, spacing: 2) {
        Text(highlighted(path, from: nameStart, to: path.utf16.count, base: theme.text))
          .font(.scaled(.body))
          .lineLimit(1)
        if nameStart > 0 {
          Text(highlighted(path, from: 0, to: nameStart - 1, base: theme.textSecondary))
            .font(.scaled(.caption))
            .lineLimit(1)
            .truncationMode(.head)
        }
      }
      Spacer(minLength: 4)
      if match.isBoosted {
        Text("Changed").font(.scaled(.caption)).foregroundStyle(theme.warning)
      }
    }
  }

  /// `path[from..<to]` (UTF-16) with the matched letters picked out.
  private func highlighted(_ path: String, from: Int, to: Int, base: Color) -> AttributedString {
    let units = Array(path.utf16)
    let hits = Set(match.indices)
    var out = AttributedString()
    var run: [UInt16] = []
    var runIsHit = false
    func flush() {
      guard !run.isEmpty else { return }
      var piece = AttributedString(String(decoding: run, as: UTF16.self))
      piece.foregroundColor = runIsHit ? theme.accent : base
      if runIsHit { piece.inlinePresentationIntent = .stronglyEmphasized }
      out += piece
      run = []
    }
    for index in from..<max(from, to) {
      let isHit = hits.contains(index)
      if isHit != runIsHit { flush() }
      runIsHit = isHit
      run.append(units[index])
    }
    flush()
    return out
  }
}

/// A worktree-search file group's header: the file's name, its directory and
/// how many hits it holds, as the Mac's search navigator heads them.
public struct FileSearchGroupHeader: View {
  @Environment(\.theme) private var theme
  let path: String
  let count: Int

  public init(path: String, count: Int) {
    self.path = path
    self.count = count
  }

  public var body: some View {
    let name = SessionFilePaths.fileName(path)
    let directory = String(path.dropLast(name.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    HStack(spacing: 6) {
      FileTypeIcon(path: path, size: 16)
      Text(name).font(.scaled(.subheadline).weight(.semibold)).foregroundStyle(theme.text).lineLimit(1)
      if !directory.isEmpty {
        Text(directory)
          .font(.scaled(.footnote)).foregroundStyle(theme.textSecondary)
          .lineLimit(1).truncationMode(.head)
      }
      Spacer(minLength: 6)
      Text(verbatim: "\(count)").font(.scaled(.footnote)).foregroundStyle(theme.textSecondary)
    }
    .textCase(nil)
  }
}

/// One worktree-search hit: its line number and the preview with the match picked out.
public struct FileSearchMatchRow: View {
  @Environment(\.theme) private var theme
  let match: ArgusProtocol.CodeSearchMatch

  public init(match: ArgusProtocol.CodeSearchMatch) {
    self.match = match
  }

  public var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(verbatim: "\(match.line)")
        .font(.scaled(size: 11, design: .monospaced))
        .foregroundStyle(theme.textMuted)
        .frame(minWidth: 28, alignment: .trailing)
      Text(preview)
        .font(.scaled(size: 12, design: .monospaced))
        .lineLimit(2)
    }
  }

  private var preview: AttributedString {
    let units = Array(match.preview.utf16)
    let start = min(max(0, match.column - match.previewOffset), units.count)
    let end = min(start + max(0, match.length), units.count)
    func piece(_ range: Range<Int>, hit: Bool) -> AttributedString {
      var text = AttributedString(String(decoding: units[range], as: UTF16.self))
      text.foregroundColor = hit ? theme.text : theme.textSecondary
      if hit { text.backgroundColor = theme.accentSoft }
      return text
    }
    let leading = String(decoding: units[0..<start], as: UTF16.self)
    let trimmed = leading.drop { $0 == " " || $0 == "\t" }.utf16.count
    return piece((start - trimmed)..<start, hit: false) + piece(start..<end, hit: true)
      + piece(end..<units.count, hit: false)
  }
}
