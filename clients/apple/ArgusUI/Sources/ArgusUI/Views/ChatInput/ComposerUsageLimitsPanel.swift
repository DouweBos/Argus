import ArgusCore
import SwiftUI

/// What `/usage-limits` opens above the composer: what's left in each plan
/// window of the agent's runner, until dismissed or the next send.
public struct ComposerUsageLimitsPanel: View {
  @Environment(\.theme) private var theme
  let groups: [UsageLimitGroup]
  let onDismiss: () -> Void

  public init(groups: [UsageLimitGroup], onDismiss: @escaping () -> Void) {
    self.groups = groups
    self.onDismiss = onDismiss
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 6) {
        Label("Usage limits", systemImage: Icon.usage)
          .font(.scaled(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
        Spacer(minLength: 8)
        Button(action: onDismiss) {
          Label("Close", systemImage: Icon.close)
        }
        .buttonStyle(FlatIconButtonStyle(size: 22))
        .help("Close")
      }
      // The countdowns move while the panel sits open.
      TimelineView(.periodic(from: .now, by: 30)) { context in
        VStack(alignment: .leading, spacing: 12) {
          ForEach(groups) { group in
            VStack(alignment: .leading, spacing: 8) {
              if groups.count > 1 {
                Text(group.label)
                  .font(.scaled(size: 11, weight: .medium))
                  .foregroundStyle(theme.textSecondary)
                  .lineLimit(1)
                  .truncationMode(.middle)
              }
              ForEach(group.windows, id: \.id) { UsageMeterLine(window: $0, now: context.date) }
            }
          }
        }
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.bgSecondary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.border, lineWidth: 1))
  }
}
