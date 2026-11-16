import ArgusCore
import SwiftUI

extension EnvironmentValues {
  /// Shows an Artifact where the platform views them: the Mac's side panel,
  /// the phone's sheet. Unset, the card opens it in the browser.
  @Entry public var openArtifact: (@MainActor (ArtifactLink) -> Void)?
}

/// An Artifact the agent published or opened, shown as the page it is: its
/// title, what the agent said it is, and a way to look at it.
struct ArtifactCard: View {
  @Environment(\.theme) private var theme
  @Environment(\.openArtifact) private var openArtifact
  @Environment(\.openURL) private var openURL

  let link: ArtifactLink
  let call: RemoteToolCall

  private var detail: String? {
    call.input["description"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
  }

  var body: some View {
    Button(action: open) {
      HStack(spacing: 10) {
        Image(systemName: Icon.artifact)
          .font(.scaled(size: 16, weight: .medium))
          .foregroundStyle(theme.accent)
          .frame(width: 32, height: 32)
          .background(theme.bg, in: .rect(cornerRadius: theme.radiusSmall))
        VStack(alignment: .leading, spacing: 2) {
          Text(link.title)
            .font(.scaled(size: 14, weight: .semibold))
            .foregroundStyle(theme.text)
            .lineLimit(1)
          Text(detail ?? (link.action == .publish ? "Artifact published" : "Artifact opened"))
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textSecondary)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 4)
        Text("Open")
          .font(.scaled(size: 12, weight: .medium))
          .foregroundStyle(theme.accent)
      }
      .padding(9)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(theme.accentSoft)
      .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      .overlay(
        RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.accentBorder, lineWidth: 1))
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
    .help(link.url.absoluteString)
    .accessibilityLabel("Open artifact \(link.title)")
  }

  private func open() {
    if let openArtifact { openArtifact(link) } else { openURL(link.url) }
  }
}
