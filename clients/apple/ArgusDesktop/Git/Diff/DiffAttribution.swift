import ArgusCore
import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// Who wrote a diff's added lines, as the kit diff draws it: the kit's table has no per-line gutter
/// hook, so each run of one author gets a slim row under its last line, and the header a legend.
struct DiffAttribution {
  /// The file's marks by new-side line.
  let marks: [Int: LineAuthor]

  struct Run: Hashable {
    let author: LineAuthor
    let first: Int
    let last: Int
    /// Where the run's last line sits in the diff.
    let hunk: Int
    let line: Int
  }

  /// Consecutive added lines of one author, hunk by hunk.
  func runs(in diff: DiffResult) -> [Run] {
    var runs: [Run] = []
    for (h, hunk) in diff.hunks.enumerated() {
      var open: Run?
      for (i, line) in hunk.lines.enumerated() {
        guard line.type == .addition, let number = line.newLineNumber, let author = marks[number] else {
          if line.type != .deletion, let run = open {
            runs.append(run)
            open = nil
          }
          continue
        }
        if let run = open, run.author == author, run.last == number - 1 {
          open = Run(author: author, first: run.first, last: number, hunk: h, line: i)
        } else {
          if let run = open { runs.append(run) }
          open = Run(author: author, first: number, last: number, hunk: h, line: i)
        }
      }
      if let run = open { runs.append(run) }
    }
    return runs
  }

  func counts(in diff: DiffResult) -> AttributionCounts {
    let added = diff.hunks.flatMap(\.lines).compactMap { $0.type == .addition ? $0.newLineNumber : nil }
    return AttributionCounts(marks, lines: added)
  }

  /// The runs as annotation rows. AppKit hosts them, so they're handed the theme.
  @MainActor
  func annotations(in diff: DiffResult, theme: Theme) -> [GitDiffAnnotation] {
    runs(in: diff).map { run in
      GitDiffAnnotation(
        id: "attribution:\(run.first)", side: .new, revision: run,
        anchor: { $0.filePath == diff.filePath ? GitDiffLineAnchor(hunk: run.hunk, line: run.line) : nil },
        height: { _ in 18 },
        content: { _ in
          DiffAttributionRunLabel(run: run).environment(\.theme, theme)
        })
    }
  }
}

/// "Agent · lines 12–30" in the gutter's colours, under the run it names.
struct DiffAttributionRunLabel: View {
  @Environment(\.theme) private var theme
  let run: DiffAttribution.Run

  var body: some View {
    HStack(spacing: 5) {
      AttributionMark(run.author, height: 11)
      Text(run.author.label).foregroundStyle(run.author.color(theme))
      Text(run.first == run.last ? "line \(run.first)" : "lines \(run.first)–\(run.last)")
        .foregroundStyle(theme.textMuted)
    }
    .font(.scaled(size: 10.5, weight: .medium))
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

/// Loads a session's marks for a diff or the code view, and counts the first look per launch.
@MainActor
enum LineAttributionLoader {
  private static var seen: Set<String> = []

  static func load(
    _ store: HostStore, sessionId: String, surface: MacTelemetryEvent.LineAttributionSurface
  ) async -> LineAttribution? {
    guard let loaded = try? await store.loadLineAttribution(sessionId: sessionId) else { return nil }
    if !loaded.files.isEmpty, seen.insert("\(surface.rawValue):\(sessionId)").inserted {
      MacTelemetry.capture(.lineAttributionShown(surface: surface, files: loaded.files.count))
    }
    return loaded
  }
}
