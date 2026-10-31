import AppKit
import ArgusUI
import SwiftUI

/// What a message's hover bar opens: the edit or fork sheet for it.
enum TranscriptMessageAction: Identifiable {
  case edit(RemoteMessage)
  case fork(RemoteMessage)

  var id: String {
    switch self {
    case .edit(let message): "edit:\(message.id)"
    case .fork(let message): "fork:\(message.id)"
    }
  }
}

extension EnvironmentValues {
  /// Edit and fork act on a live conversation; a saved chat only copies.
  @Entry var transcriptActionsEnabled = false
}

/// The buttons a message shows on hover, as on the desktop: copy for every
/// message, edit for your own, fork for both while the agent is live.
struct MessageHoverBar: View {
  @Environment(\.theme) private var theme
  @Environment(TranscriptModel.self) private var model
  @Environment(\.transcriptActionsEnabled) private var actionsEnabled

  let message: RemoteMessage

  private var role: MacTelemetryEvent.MessageRole { message.role == .user ? .user : .assistant }

  var body: some View {
    HStack(spacing: 2) {
      IconBtn(systemName: Icon.copy, label: "Copy message", size: 11) { copy() }
      if actionsEnabled {
        if message.role == .user {
          IconBtn(systemName: Icon.pencil, label: "Edit message", size: 11) { model.messageAction = .edit(message) }
        }
        IconBtn(systemName: Icon.branch, label: "Fork workspace and chat from here", size: 11) {
          model.messageAction = .fork(message)
        }
      }
    }
    .padding(.horizontal, 3)
    .padding(.vertical, 2)
    .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.border, lineWidth: 1))
  }

  /// The message's own words, blocks a blank line apart, without the linked-projects preamble.
  private func copy() {
    guard let text = message.copyText else { return NSSound.beep() }
    TranscriptSystem.copy(text)
    MacTelemetry.capture(.messageAction(action: .copy, role: role, success: true))
  }
}

/// A row's hover bar: a small hosting view the cell shows while the pointer
/// is on it, the same for plain text and hosted rows.
final class TranscriptHoverBarHost {
  private var host: NSHostingView<AnyView>?
  private weak var cell: NSView?

  init(cell: NSView) {
    self.cell = cell
  }

  @MainActor
  func show(_ message: RemoteMessage, model: TranscriptModel, environment: EnvironmentValues, in frame: NSRect) {
    guard let cell else { return }
    let root = AnyView(
      MessageHoverBar(message: message)
        .environment(model)
        .environment(\.self, environment)
        .fixedSize())
    let host = self.host ?? NSHostingView(rootView: root)
    host.rootView = root
    if host.superview !== cell { cell.addSubview(host) }
    let size = host.fittingSize
    host.frame = NSRect(x: frame.maxX - size.width, y: frame.minY, width: size.width, height: size.height)
    host.isHidden = false
    self.host = host
  }

  @MainActor
  func hide() {
    host?.isHidden = true
  }

  #if DEBUG
    /// Where the bar is in window coordinates, when it's showing.
    @MainActor var shownFrame: NSRect? {
      guard let host, !host.isHidden, host.superview != nil else { return nil }
      return host.convert(host.bounds, to: nil)
    }
  #endif
}
