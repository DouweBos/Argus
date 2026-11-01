import ArgusCore
import SwiftUI

/// A turn's work folded into one quiet line that opens in place. A decision
/// waiting inside keeps it open.
struct WorkLogRow: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let agentKey: String
  let log: WorkLog
  @Binding var expanded: Bool
  /// Opened by hand; says whether the agent was still on that turn.
  var onOpen: (Bool) -> Void = { _ in }

  /// The newest thing in the chat while the agent is still at it.
  /// Still at it: the newest thing in a running chat, or a background agent it launched is.
  private var working: Bool {
    log.stillRunning != nil || (log.ended == nil && host.statusByAgent[agentKey]?.status == .running)
  }

  private var awaitsDecision: Bool {
    log.messages.contains { message in
      message.toolCalls.contains { host.hasPendingCall(agentKey: agentKey, in: $0) }
    }
  }

  private var open: Bool { expanded || awaitsDecision }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      summary
      if open {
        ForEach(log.messages) { message in
          TranscriptMessageView(agentKey: agentKey, message: message)
        }
      }
      Rectangle().fill(theme.borderSubtle).frame(height: 1)
    }
  }

  private var summary: some View {
    Button {
      expanded.toggle()
      if expanded { onOpen(working) }
    } label: {
      HStack(spacing: 4) {
        if working {
          TimelineView(.periodic(from: .now, by: 1)) { context in
            Text(log.label(working: true, now: context.date))
          }
        } else {
          Text(log.label(working: false, now: .now))
        }
        Image(systemName: Icon.chevronRight)
          .font(.scaled(size: 9, weight: .semibold))
          .rotationEffect(.degrees(open ? 90 : 0))
        Spacer(minLength: 0)
      }
      .font(.scaled(size: 12))
      .foregroundStyle(theme.textMuted)
      .frame(minHeight: 28)
      .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .disabled(awaitsDecision)
    .accessibilityLabel(log.label(working: working, now: .now))
    .accessibilityHint(log.callCountLabel)
    .accessibilityValue(open ? "expanded" : "collapsed")
  }
}
