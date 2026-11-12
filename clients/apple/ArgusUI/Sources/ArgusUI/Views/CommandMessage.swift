import ArgusCore
import SwiftUI

/// A runner slash command at the head of its message, set apart from the text as a pill.
public struct CommandChip: View {
  @Environment(\.theme) private var theme

  let command: RemoteMessageCommand
  let size: CGFloat

  public init(command: RemoteMessageCommand, size: CGFloat = 12) {
    self.command = command
    self.size = size
  }

  public var body: some View {
    HStack(spacing: 4) {
      Image(systemName: Icon.slashCommand)
        .font(.scaled(size: size - 1, weight: .semibold))
      Text(command.label)
        .font(.scaled(size: size, weight: .semibold, design: .monospaced))
        .lineLimit(1)
    }
    .foregroundStyle(theme.accent)
    .padding(.horizontal, 8)
    .padding(.vertical, 3)
    .background(Capsule().fill(theme.bg))
    .overlay(Capsule().stroke(theme.accentBorder, lineWidth: 1))
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Command \(command.label)")
  }
}
