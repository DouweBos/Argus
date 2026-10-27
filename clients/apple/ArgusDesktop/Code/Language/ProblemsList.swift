import ArgusEditor
import ArgusUI
import SwiftUI

/// The Problems strip above the status bar: every diagnostic in the session's open files.
/// A row opens its line; "Ask Agent to Fix" hands it to the session's agent.
struct ProblemsList: View {
  @Environment(\.theme) private var theme
  let client: LanguageClient
  let code: CodeSession

  var body: some View {
    let rows = Problems.rows(in: code)
    VStack(spacing: 0) {
      HStack {
        Text("Problems").font(.scaled(size: 11, weight: .semibold))
        Text("Open files").font(.scaled(size: 11)).foregroundStyle(theme.textMuted)
        Spacer()
        Button {
          client.problemsExpanded = false
        } label: {
          Image(systemName: "xmark")
        }
        .buttonStyle(.argusPlain)
        .help("Hide problems")
      }
      .foregroundStyle(theme.textSecondary)
      .padding(.horizontal, 10)
      .frame(height: 24)
      Divider()
      if rows.isEmpty {
        Text("No problems in the open files.")
          .font(.scaled(size: 11))
          .foregroundStyle(theme.textMuted)
          .frame(maxWidth: .infinity, minHeight: 48)
      } else {
        ScrollView {
          LazyVStack(spacing: 0) {
            ForEach(rows) { row in
              ProblemRow(row: row, ask: code.files[row.path]?.actions) {
                code.navigate(to: row.path, line: row.diagnostic.range.start.line + 1, source: .diagnostic)
              }
            }
          }
        }
        .frame(maxHeight: 180)
      }
    }
    .background(theme.bg)
  }
}

private struct ProblemRow: View {
  @Environment(\.theme) private var theme
  let row: Problems.Row
  let ask: CodeEditorActions?
  let open: () -> Void
  @State private var hovering = false

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: icon)
        .foregroundStyle(tone.color(theme))
        .frame(width: 14)
      Text(location)
        .foregroundStyle(theme.textSecondary)
        .monospacedDigit()
      Text(row.diagnostic.message)
        .foregroundStyle(theme.text)
        .lineLimit(1)
        .truncationMode(.tail)
        .help(row.diagnostic.message)
      if let source = row.diagnostic.source {
        Text(source).foregroundStyle(theme.textMuted)
      }
      Spacer(minLength: 8)
      if let ask, hovering {
        Button("Ask Agent to Fix") { ask.askAgentToFix(row.diagnostic) }
          .controlSize(.mini)
      }
    }
    .font(.scaled(size: 11))
    .padding(.horizontal, 10)
    .frame(height: 22)
    .background(hovering ? theme.bgHover : .clear)
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .onTapGesture(perform: open)
    .clickable()
  }

  private var location: String {
    "\((row.path as NSString).lastPathComponent):\(row.diagnostic.range.start.line + 1)"
  }

  private var icon: String {
    switch row.diagnostic.severity {
    case .error: "xmark.octagon.fill"
    case .warning: "exclamationmark.triangle.fill"
    case .info, .hint: "info.circle.fill"
    }
  }

  private var tone: Tone {
    switch row.diagnostic.severity {
    case .error: .danger
    case .warning: .warning
    case .info, .hint: .accent
    }
  }
}
