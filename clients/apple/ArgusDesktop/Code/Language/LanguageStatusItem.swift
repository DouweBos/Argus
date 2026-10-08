import AppKit
import ArgusCore
import ArgusEditor
import ArgusUI
import SwiftUI

/// The status bar's language items: the open files' problem counts (a click shows the list)
/// and the state of the active file's language server.
struct LanguageStatusItem: View {
  @Environment(\.theme) private var theme
  let client: LanguageClient
  let code: CodeSession
  let file: CodeFile

  static let installHelp = URL(string: "https://houwert.dev/argus/docs/language-servers")!

  var body: some View {
    HStack(spacing: 10) {
      if let language = client.language(of: file.path) {
        server(language)
      }
      if client.hasOpenDocuments {
        problems
      }
    }
  }

  private var problems: some View {
    let counts = Problems.counts(in: code)
    return Button {
      client.problemsExpanded.toggle()
    } label: {
      HStack(spacing: 6) {
        count(counts.errors, icon: "xmark.octagon.fill", tone: .danger)
        count(counts.warnings, icon: "exclamationmark.triangle.fill", tone: .warning)
        if counts.others > 0 { count(counts.others, icon: "info.circle.fill", tone: .accent) }
      }
    }
    .buttonStyle(.plain)
    .help(client.problemsExpanded ? "Hide problems" : "Show problems in open files")
  }

  private func count(_ value: Int, icon: String, tone: Tone) -> some View {
    HStack(spacing: 3) {
      Image(systemName: icon).foregroundStyle(value > 0 ? tone.color(theme) : theme.textMuted)
      Text("\(value)").monospacedDigit()
    }
  }

  @ViewBuilder private func server(_ language: LspDocumentLanguage) -> some View {
    let name = LspLanguageMap.displayName(language.server)
    let status = client.status(of: language.server)
    switch status?.state {
    case .ready?:
      Text(name).help(Self.readyHelp(status))
    case .missing?:
      HStack(spacing: 4) {
        Text("\(name) server not found").foregroundStyle(theme.warning)
        Link("How to install", destination: Self.installHelp)
      }
      .help(status?.message ?? "Argus didn't find a language server for \(name) on this machine")
    case .failed?:
      HStack(spacing: 4) {
        Text("\(name) server failed").foregroundStyle(theme.error)
        Button("Retry") { Task { await client.restart(language.server) } }
          .buttonStyle(.accentLink)
      }
      .help(status?.message ?? "The server crashed repeatedly")
    case .stopped?:
      Text("\(name) server stopped")
    default:
      HStack(spacing: 4) {
        ProgressView().controlSize(.mini)
        Text("\(name) starting…")
      }
    }
  }

  private static func readyHelp(_ status: ArgusProtocol.LspServerStatus?) -> String {
    switch status?.source {
    case .bundled?: "Language server bundled with Argus is running"
    case .toolchain?: "Language server from Xcode is running"
    case .path?: "Language server from your PATH is running"
    default: "Language server is running"
    }
  }
}

/// Diagnostics across a session's open files.
enum Problems {
  struct Counts: Equatable {
    var errors = 0
    var warnings = 0
    var others = 0
  }

  struct Row: Identifiable {
    let path: String
    let diagnostic: EditorDiagnostic
    var id: String { "\(path)#\(diagnostic.id)" }
  }

  @MainActor static func counts(in code: CodeSession) -> Counts {
    counts(code.files.values.flatMap { $0.document?.diagnostics ?? [] })
  }

  static func counts(_ diagnostics: [EditorDiagnostic]) -> Counts {
    var counts = Counts()
    for diagnostic in diagnostics {
      switch diagnostic.severity {
      case .error: counts.errors += 1
      case .warning: counts.warnings += 1
      case .info, .hint: counts.others += 1
      }
    }
    return counts
  }

  /// By file, then by position.
  @MainActor static func rows(in code: CodeSession) -> [Row] {
    code.files.values
      .sorted { $0.path < $1.path }
      .flatMap { file in
        (file.document?.diagnostics ?? [])
          .sorted { ($0.range.start, $0.severity) < ($1.range.start, $1.severity) }
          .map { Row(path: file.path, diagnostic: $0) }
      }
  }
}
