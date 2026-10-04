import ArgusCore
import ArgusUI
import SwiftUI

/// The one line everyone reads, and what would otherwise surprise them —
/// approving a tool call runs code on this Mac — one click away.
struct HuddleDisclosure: View {
  @Environment(\.theme) private var theme
  let deviceName: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(
        deviceName.map {
          "Anyone you let in can watch this agent and drive it — and \($0) — with you, until you end the huddle."
        } ?? "Anyone you let in can watch this agent and drive it with you, until you end the huddle.")
      DisclosureGroup("What a guest can do") {
        VStack(alignment: .leading, spacing: 4) {
          bullet(
            "Read the whole conversation — every message you send, the agent's replies, and the files and commands it touches."
          )
          bullet("Send messages to this agent, exactly like you can.")
          bullet("Approve the agent's tool calls, which runs code on this Mac.")
          bullet(
            deviceName.map { "Drive \($0) — tap, type, and take control from you." }
              ?? "Drive the device you have open, if you open one.")
          bullet(
            "Nothing else. Your other agents, sessions and projects stay out of reach, and a guest's access dies with the huddle."
          )
        }
        .padding(.top, 4)
      }
    }
    .font(.callout)
    .foregroundStyle(theme.textSecondary)
  }

  private func bullet(_ text: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Text("•")
      Text(text).fixedSize(horizontal: false, vertical: true)
    }
  }
}

/// A share blocker walked through rather than printed: what went wrong, why,
/// the steps, the command to run, and an alternative.
struct ShareBlockerView<Actions: View>: View {
  @Environment(\.theme) private var theme
  let blocker: ArgusProtocol.ShareErrorPayload
  @ViewBuilder let actions: () -> Actions

  private var tone: Color { blocker.kind == .quickTunnelFailed ? theme.warning : theme.error }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label(blocker.message, systemImage: "exclamationmark.triangle.fill")
        .font(.headline).foregroundStyle(tone)
      Text(blocker.explanation).foregroundStyle(theme.textSecondary)
      ForEach(Array(blocker.steps.enumerated()), id: \.offset) { index, step in
        Text("\(index + 1). \(step)").fixedSize(horizontal: false, vertical: true)
      }
      if let command = blocker.command {
        Text(command).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
          .padding(8).frame(maxWidth: .infinity, alignment: .leading)
          .background(theme.bgTertiary, in: .rect(cornerRadius: 6))
      }
      if let alternative = blocker.alternative {
        Text(alternative).font(.callout).foregroundStyle(theme.textSecondary)
      }
      if let detail = blocker.detail {
        Text(detail).font(.system(.caption, design: .monospaced)).foregroundStyle(theme.textMuted)
          .textSelection(.enabled)
      }
      HStack { actions() }
    }
    .padding(12)
    .background(tone.opacity(0.1), in: .rect(cornerRadius: 8))
  }
}

/// A guest: who, whether they're here, typing or waiting, and the decision.
struct HuddleGuestRow: View {
  @Environment(\.theme) private var theme
  let guest: ArgusProtocol.HuddleGuestModel
  let huddles: HuddleStore
  let room: ArgusProtocol.HuddleRoomModel

  var body: some View {
    HStack {
      StatusDot(tone: guest.connected ? .success : .muted)
      Text(guest.label)
      if guest.state == .approved, huddles.drivers(of: room).holder == guest.label {
        Label(status, systemImage: "hand.tap.fill").font(.caption).foregroundStyle(theme.accent)
      } else {
        Text(status).font(.caption).foregroundStyle(theme.textSecondary)
      }
      Spacer()
      if guest.state == .pending {
        Button("Deny") { huddles.deny(room, guest.devStaticPub) }
        Button("Allow") { huddles.approve(room, guest.devStaticPub) }.buttonStyle(.borderedProminent)
      } else {
        Button("Remove") { huddles.remove(room, guest.devStaticPub) }
      }
    }
  }

  private var status: String { Huddles.guestStatus(guest, drivers: huddles.drivers(of: room)) }
}
