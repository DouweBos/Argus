import ArgusUI
import SwiftUI

/// One agent: its transcript, and the input that drives it.
struct AgentView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(\.dismiss) private var dismiss

  let agentId: String
  let label: String

  @State private var confirmingStop = false

  private var sessionId: String? { host.statusByAgent[agentId]?.sessionId }

  /// Nothing to hand over until the session behind the agent is known — the
  /// desktop addresses screens by session, not by agent.
  private var handoff: Handoff? {
    guard let sessionId, let identity = app.identity else { return nil }
    let status = host.statusByAgent[agentId]

    return Handoff(
      hostKey: ArgusBase64.encodeURL(identity.desktopStaticKey ?? Data()),
      sessionId: sessionId,
      agentId: agentId,
      label: label,
      projectName: status?.projectName,
      repoRoot: nil)
  }
  private var isRunning: Bool { host.statusByAgent[agentId]?.status == .running }
  private var isGone: Bool {
    host.goneAgents.contains(agentId) || host.statusByAgent[agentId]?.status == .stopped
  }

  var body: some View {
    VStack(spacing: 0) {
      AgentTranscriptView(agentKey: agentId, isLive: !isGone)
      if isGone {
        MutedText("This agent has stopped, so it can't take new messages.")
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(theme.space)
          .background(theme.bgSecondary)
          .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 1) }
      } else if host.hasControl {
        ChatInputView(agentId: agentId, sessionId: sessionId)
      }
    }
    .background(theme.bg.ignoresSafeArea())
    // Handoff: the Mac this agent runs on offers to take it back over.
    .userActivity(Handoff.activityType, isActive: handoff != nil) { activity in
      guard let handoff else { return }
      activity.title = label
      activity.isEligibleForHandoff = true
      activity.addUserInfoEntries(from: handoff.userInfo)
    }
    .navigationTitle(label)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        if let sessionId {
          IconBtn(systemName: Icon.branch, label: "View changes") {
            router.push(.changes(sessionId: sessionId, label: label))
          }
        }
        IconBtn(systemName: Icon.simulator, label: "Devices") { openDevices() }
        if host.hasControl, !isGone {
          IconBtn(systemName: Icon.stop, label: "Shut down agent") {
            confirmingStop = true
          }
        }
      }
    }
    .task {
      // Always asked, not only when the session is unknown: a cached status
      // can belong to an agent that has since been shut down.
      await host.loadAgentStatus(agentId: agentId)
      // Fetched once, not polled: this only decides where the device button goes.
      if host.connection == .ready { await host.refreshDevices() }
    }
    .confirmationDialog(
      "Shut down this agent?", isPresented: $confirmingStop, titleVisibility: .visible
    ) {
      Button("Shut down", role: .destructive) {
        Task {
          await host.stopAgent(agentId: agentId)
          dismiss()
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        isRunning
          ? "It stops mid-turn and anything still queued for it is discarded."
          : "Its process ends and anything still queued for it is discarded.")
    }
  }

  /// Straight to the screen when there is only one device to mean; otherwise
  /// the list, which is also what explains an empty one.
  private func openDevices() {
    if host.devices.count == 1, let only = host.devices.first {
      router.push(
        .device(id: only.id, platform: only.platform, name: only.name, isTv: only.isTv))
    } else {
      router.push(.devices)
    }
  }
}
