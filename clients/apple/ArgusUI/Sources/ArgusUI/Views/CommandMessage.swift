import ArgusCore
import SwiftUI

extension EnvironmentValues {
  /// Opens a Linear issue, by identifier, on the app's issue screen.
  @Entry public var openIssue: (@MainActor (String) -> Void)?
  /// Heard when a command's playbook is opened, for the app's telemetry.
  @Entry public var playbookOpened: (@MainActor (RemoteMessageCommand) -> Void)?
}

/// A command message's lead: the command as a pill, and its argument beside it,
/// linked when it names a Linear issue or a web page.
public struct CommandChip: View {
  @Environment(\.theme) private var theme
  @Environment(\.openIssue) private var openIssue
  @Environment(\.openURL) private var openURL

  let command: RemoteMessageCommand
  let size: CGFloat

  public init(command: RemoteMessageCommand, size: CGFloat = 12) {
    self.command = command
    self.size = size
  }

  public var body: some View {
    HStack(spacing: 8) {
      pill
      argument
    }
  }

  private var pill: some View {
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

  @ViewBuilder
  private var argument: some View {
    if let label = command.argumentLabel {
      if let id = command.issueIdentifier, let openIssue {
        link(label, icon: Icon.issue, help: "Open \(id)") { openIssue(id) }
      } else if let url = command.argumentURL {
        link(label, icon: Icon.openExternal, help: url.absoluteString) { openURL(url) }
      } else {
        Text(label)
          .font(.scaled(size: size, weight: .medium, design: .monospaced))
          .foregroundStyle(theme.text)
          .lineLimit(1)
          .truncationMode(.middle)
      }
    }
  }

  private func link(_ label: String, icon: String, help: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: 3) {
        Image(systemName: icon).font(.scaled(size: size - 2, weight: .medium))
        Text(label)
          .font(.scaled(size: size, weight: .medium, design: .monospaced))
          .underline()
          .lineLimit(1)
          .truncationMode(.middle)
      }
      .foregroundStyle(theme.accent)
      .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .help(help)
  }
}

/// "Show playbook": the prompt an Argus command expanded into, folded under the
/// message like a turn's work log until it's asked for.
public struct PlaybookDisclosure<Content: View>: View {
  @Environment(\.theme) private var theme
  @Environment(\.playbookOpened) private var playbookOpened
  @Environment(\.toolCardExpansion) private var expansion

  let command: RemoteMessageCommand
  let messageId: String
  let content: Content

  @State private var localExpanded = false

  public init(command: RemoteMessageCommand, messageId: String, @ViewBuilder content: () -> Content) {
    self.command = command
    self.messageId = messageId
    self.content = content()
  }

  /// The list's open state when it keeps one (a recycled row has none), as tool cards do.
  private var isExpanded: Bool {
    get { expansion.map { $0.expanded[Self.key(messageId)] ?? false } ?? localExpanded }
    nonmutating set {
      if let expansion { expansion.expanded[Self.key(messageId)] = newValue } else { localExpanded = newValue }
    }
  }

  /// Where a message's playbook keeps its open state in a `ToolCardExpansion`.
  public static func key(_ messageId: String) -> String { "playbook:\(messageId)" }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      toggle
      if isExpanded {
        content
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(10)
          .background(theme.bg)
          .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
          .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.borderSubtle, lineWidth: 1))
      }
    }
  }

  private var toggle: some View {
    Button {
      isExpanded.toggle()
      if isExpanded { playbookOpened?(command) }
    } label: {
      HStack(spacing: 4) {
        Image(systemName: Icon.fold).font(.scaled(size: 11))
        Text(isExpanded ? "Hide playbook" : "Show playbook")
        Image(systemName: Icon.chevronRight)
          .font(.scaled(size: 9, weight: .semibold))
          .rotationEffect(.degrees(isExpanded ? 90 : 0))
      }
      .font(.scaled(size: 12))
      .foregroundStyle(theme.textMuted)
      .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .help("The prompt the agent received for \(command.label)")
    .accessibilityValue(isExpanded ? "expanded" : "collapsed")
  }
}
