import ArgusUI
import SwiftUI

/// The hover card: diagnostics under the pointer, each with "Ask Agent to Fix", then the
/// language server's hover text.
struct HoverCard: View {
  var diagnostics: [EditorDiagnostic]
  var markdown: String?
  weak var actions: EditorActions?
  var afterAction: () -> Void = {}
  @Environment(\.theme) private var theme

  func onAskAgent(_ action: @escaping () -> Void) -> HoverCard {
    var copy = self
    copy.afterAction = action
    return copy
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(diagnostics) { diagnostic in
        diagnosticRow(diagnostic)
      }
      if let markdown, !markdown.isEmpty {
        if !diagnostics.isEmpty { Divider() }
        ScrollView {
          MarkdownView(text: markdown, baseSize: 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 260)
      }
    }
    .padding(12)
    .frame(width: 460, alignment: .leading)
    .fixedSize(horizontal: false, vertical: true)
  }

  private func diagnosticRow(_ diagnostic: EditorDiagnostic) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Circle()
        .fill(SeverityStyle.tone(diagnostic.severity).color(theme))
        .frame(width: 8, height: 8)
        .padding(.top, 4)
      VStack(alignment: .leading, spacing: 6) {
        Text(diagnostic.message)
          .font(.system(size: 12))
          .foregroundStyle(theme.text)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
        HStack(spacing: 8) {
          if let source = SeverityStyle.sourceLabel(diagnostic) {
            Text(source)
              .font(.system(size: 11))
              .foregroundStyle(theme.textMuted)
          }
          Spacer(minLength: 0)
          if let actions {
            Button("Ask Agent to Fix") {
              actions.askAgentToFix(diagnostic)
              afterAction()
            }
            .controlSize(.small)
          }
        }
      }
    }
  }
}

enum SeverityStyle {
  static func tone(_ severity: DiagnosticSeverity) -> Tone {
    switch severity {
    case .error: .danger
    case .warning: .warning
    case .info, .hint: .accent
    }
  }

  static func sourceLabel(_ diagnostic: EditorDiagnostic) -> String? {
    switch (diagnostic.source, diagnostic.code) {
    case let (source?, code?): "\(source) (\(code))"
    case let (source?, nil): source
    case let (nil, code?): code
    case (nil, nil): nil
    }
  }
}
