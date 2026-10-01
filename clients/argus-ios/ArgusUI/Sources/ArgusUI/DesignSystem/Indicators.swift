import ArgusKit
import SwiftUI

/// A fixed-size dot in every state, on purpose.
///
/// It lives in a nav bar, where a label that grows to "Connecting" leaves dead
/// space behind forever. The words belong in the in-screen banner instead.
public struct ConnectionBadge: View {
  @Environment(\.theme) private var theme
  let state: Transport.State

  public init(state: Transport.State) {
    self.state = state
  }

  public var body: some View {
    StatusDot(tone: tone, pulse: state != .ready)
      .padding(.horizontal, 8)
      .accessibilityLabel(label)
  }

  private var tone: Tone {
    switch state {
    case .ready: .success
    case .offline: .warning
    case .connecting, .handshaking: .muted
    }
  }

  private var label: String {
    switch state {
    case .ready: "Connected"
    case .offline: "Reconnecting"
    case .connecting: "Connecting"
    case .handshaking: "Securing"
    }
  }
}

/// Three dots bouncing in sequence — the "still working" tell, shared by the
/// transcript's thinking row and anything waiting on the network.
public struct ThinkingDots: View {
  @Environment(\.theme) private var theme
  var size: CGFloat = 4
  var tint: Color?

  @State private var bouncing = false

  private var lift: CGFloat { size * 0.9 }

  public init(size: CGFloat = 4, tint: Color? = nil) {
    self.size = size
    self.tint = tint
  }

  public var body: some View {
    HStack(spacing: size * 0.75) {
      ForEach(0..<3, id: \.self) { index in
        Circle()
          .fill(tint ?? theme.textMuted)
          .frame(width: size, height: size)
          .offset(y: bouncing ? -lift : 0)
          .animation(
            .easeInOut(duration: 0.38)
              .repeatForever(autoreverses: true)
              // The stagger is the whole effect; without it they pulse as one.
              .delay(Double(index) * 0.13),
            value: bouncing)
      }
    }
    // Reserve the travel, or the bounce clips against the row above.
    .frame(height: size + lift * 2, alignment: .center)
    .onAppear { bouncing = true }
    .accessibilityHidden(true)
  }
}

/// The context-window fill ring.
public struct ContextMeter: View {
  @Environment(\.theme) private var theme
  let tokens: Int
  let limit: Int

  private static let ring: CGFloat = 2.5

  private var fraction: Double {
    guard limit > 0 else { return 0 }
    return min(1, Double(tokens) / Double(limit))
  }

  private var tone: Tone {
    if fraction > 0.9 { return .danger }
    if fraction > 0.7 { return .warning }
    return .accent
  }

  public init(tokens: Int, limit: Int) {
    self.tokens = tokens
    self.limit = limit
  }

  public var body: some View {
    HStack(spacing: 5) {
      ZStack {
        // `strokeBorder` and the matching inset keep the ring inside its
        // frame — a centred stroke bleeds half its width and gets clipped.
        Circle().strokeBorder(theme.bgHover, lineWidth: Self.ring)
        Circle()
          .inset(by: Self.ring / 2)
          .trim(from: 0, to: fraction)
          .stroke(tone.color(theme), style: StrokeStyle(lineWidth: Self.ring, lineCap: .round))
          .rotationEffect(.degrees(-90))
      }
      .frame(width: 18, height: 18)
      Text(ContextWindow.format(tokens))
        .font(.system(size: 11))
        .foregroundStyle(theme.textMuted)
        .fixedSize()
    }
    .accessibilityLabel("Context \(Int(fraction * 100)) percent full")
  }
}

/// What the agent is doing right now, or nothing at all when it is idle.
public struct WorkingIndicator: View {
  @Environment(\.theme) private var theme
  let status: RemoteAgentState?
  let pendingToolName: String?
  let pendingToolInput: [String: JSONValue]?
  let hasPendingPermission: Bool

  /// One whimsical verb per thinking episode. Re-rolling it on every redraw
  /// makes the row flicker, so it is keyed to the episode instead.
  @State private var verb = Activity.randomSpinnerVerb()

  private var description: Activity.Description {
    Activity.derive(
      status: status,
      pendingToolName: pendingToolName,
      pendingToolInput: pendingToolInput,
      hasPendingPermission: hasPendingPermission)
  }

  private var isThinking: Bool { description.text == "Thinking" }

  public init(
    status: RemoteAgentState? = nil,
    pendingToolName: String? = nil,
    pendingToolInput: [String: JSONValue]? = nil,
    hasPendingPermission: Bool
  ) {
    self.status = status
    self.pendingToolName = pendingToolName
    self.pendingToolInput = pendingToolInput
    self.hasPendingPermission = hasPendingPermission
  }

  public var body: some View {
    if description.state == .working || description.state == .blocked {
      HStack(spacing: 8) {
        StatusDot(tone: description.state == .blocked ? .warning : .accent, pulse: true)
        Text(isThinking ? verb : description.text)
          .font(.system(size: 13))
          .foregroundStyle(theme.textSecondary)
        ThinkingDots()
      }
      .padding(.vertical, 6)
      .onChange(of: isThinking) { _, nowThinking in
        if nowThinking { verb = Activity.randomSpinnerVerb() }
      }
    }
  }
}
