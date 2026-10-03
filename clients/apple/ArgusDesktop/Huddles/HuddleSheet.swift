import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// Start a share, hand over the link, and keep the room while it's live. One
/// sheet for both halves: the engineer pastes the link, then comes straight
/// back here to let people in.
struct HuddleSheet: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openSettings) private var openSettings
  @Environment(\.theme) private var theme
  let agentId: String
  let sessionId: String

  @State private var starting = false
  @State private var blocker: ArgusProtocol.ShareErrorPayload?
  @State private var gitName: String?
  @State private var copied = false

  private var huddles: HuddleStore { model.huddles }
  private var room: ArgusProtocol.HuddleRoomModel? { huddles.room(forAgent: agentId) }
  private var deviceKey: String { huddles.shareableDeviceKey(sessionId: sessionId) }
  private var hostName: String { Huddles.hostName(configured: HuddleDisplayName.value, gitName: gitName) }
  private var agentTitle: String {
    store.live?.conversation(for: agentId)?.title ?? store.statusByAgent[agentId]?.title ?? ""
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(room == nil ? "Share This Agent" : "Huddle").font(.title2.weight(.semibold))
      if let room {
        live(room)
      } else {
        start
      }
    }
    .padding(24)
    .frame(width: 520)
    .task {
      gitName = await huddles.gitName(sessionId: sessionId)
      if room == nil { blocker = await huddles.readiness() }
    }
  }

  // MARK: Start

  @ViewBuilder
  private var start: some View {
    HuddleDisclosure(deviceName: huddles.deviceName(deviceKey))
    if deviceKey.isEmpty {
      Label(
        "No device is open, so the huddle is chat only. Open one before sharing if you want guests to drive it.",
        systemImage: "info.circle"
      )
      .foregroundStyle(theme.textSecondary)
    }
    if let blocker {
      ShareBlockerView(blocker: blocker) {
        Button("Check Again") { Task { self.blocker = await huddles.readiness() } }
        Button("Open Remote Settings") {
          model.settingsTab = .remote
          openSettings()
        }
      }
    }
    HStack {
      Spacer()
      Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
      Button {
        starting = true
        blocker = nil
        Task {
          blocker = await huddles.start(agentId: agentId, deviceKey: deviceKey, hostLabel: hostName)
          starting = false
        }
      } label: {
        if starting {
          HStack(spacing: 6) {
            ProgressView().controlSize(.small)
            Text("Getting a link…")
          }
        } else {
          Text("Start Sharing")
        }
      }
      .keyboardShortcut(.defaultAction)
      .disabled(starting)
    }
  }

  // MARK: Live

  @ViewBuilder
  private func live(_ room: ArgusProtocol.HuddleRoomModel) -> some View {
    let invite = Huddles.inviteText(name: hostName, agentTitle: agentTitle, url: room.url ?? "")
    VStack(alignment: .leading, spacing: 8) {
      Text("Send this to them").font(.headline)
      if let url = room.url {
        HStack(alignment: .top, spacing: 12) {
          VStack(alignment: .leading, spacing: 8) {
            Text(invite).textSelection(.enabled)
              .fixedSize(horizontal: false, vertical: true)
              .padding(10)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(theme.bgTertiary, in: .rect(cornerRadius: 6))
            Button(copied ? "Copied" : "Copy Invite") {
              NSPasteboard.general.clearContents()
              NSPasteboard.general.setString(invite, forType: .string)
              copied = true
              MacTelemetry.capture(.huddleUsed(action: .copyInvite, hasDevice: !room.deviceKey.isEmpty))
            }
            .accessibilityHint(url)
          }
          QRCodeView(payload: url, size: 96)
        }
      } else {
        HStack(spacing: 6) {
          ProgressView().controlSize(.small)
          Text("Getting a link…").foregroundStyle(theme.textSecondary)
        }
      }
      Text("The link alone gets nobody in — you approve each person here.")
        .font(.callout).foregroundStyle(theme.textSecondary)
    }
    VStack(alignment: .leading, spacing: 8) {
      Label("People", systemImage: "person.2").font(.headline)
      let guests = room.guests.filter { $0.state != .denied }
      if guests.isEmpty {
        Text("Nobody has opened the link yet.").foregroundStyle(theme.textSecondary)
      }
      ForEach(guests, id: \.devStaticPub) { guest in
        HuddleGuestRow(guest: guest, huddles: huddles, room: room)
      }
    }
    HuddleDisclosure(deviceName: huddles.deviceName(room.deviceKey))
    HStack {
      Spacer()
      Button("End Huddle", role: .destructive) {
        huddles.stop(room)
        dismiss()
      }
      Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
    }
  }
}
