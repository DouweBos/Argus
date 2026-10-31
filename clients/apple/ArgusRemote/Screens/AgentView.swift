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
  @State private var showingMcp = false
  @State private var viewingToken: Int?

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
      AgentTranscriptView(agentKey: agentId, isLive: !isGone) { working in
        Telemetry.capture(.transcriptWorkLogOpened(working: working))
      }
      if isGone {
        MutedText("This agent has stopped, so it can't take new messages.")
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(theme.space)
          .background(theme.bgSecondary)
          .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 1) }
      } else if host.hasControl {
        ChatInputView(agentId: agentId, sessionId: sessionId) { affordance in
          Telemetry.capture(affordance == .followUp ? .followUpUsed : .inputUsed(affordance: affordance.rawValue))
        }
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
    .environment(\.openFileLink, fileLinkAction)
    .navigationTitle(label)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        if let session = sessionId.flatMap(host.loadedSession(id:)), SessionReferences.any(in: session) {
          SessionReferencesMenu(session: session)
        }
        if let sessionId {
          IconBtn(systemName: Icon.branch, label: "View changes") {
            router.push(.changes(sessionId: sessionId, label: label))
          }
          if host.hasControl {
            Menu {
              Button("Open File…", systemImage: Icon.file) {
                router.push(.quickOpen(sessionId: sessionId, label: label))
              }
              Button("Search Files…", systemImage: Icon.search) {
                router.push(.fileSearch(sessionId: sessionId, label: label))
              }
            } label: {
              Image(systemName: Icon.search)
            }
            .accessibilityLabel("Files")
          }
        }
        IconBtn(systemName: Icon.simulator, label: "Devices") { openDevices() }
        if !isGone {
          IconBtn(systemName: Icon.mcp, label: "MCP servers") {
            Telemetry.capture(.mcpServersOpened)
            showingMcp = true
          }
        }
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
      // The session's ticket and designs, when it was reached without its project.
      if let sessionId, host.loadedSession(id: sessionId) == nil {
        for project in host.projects { await host.loadSessions(repoRoot: project.repoRoot) }
      }
      // Fetched once, not polled: this only decides where the device button goes.
      if host.connection == .ready { await host.refreshDevices() }
    }
    // The computer keeps a warm agent in the session on screen, so the next start there is instant.
    .task(id: sessionId) {
      guard host.hasControl, let sessionId else { return }
      viewingToken = await host.reportViewing(sessionId: sessionId)
    }
    .onDisappear {
      guard let viewingToken else { return }
      Task { await host.stopViewing(token: viewingToken) }
    }
    .sheet(isPresented: $showingMcp) {
      NavigationStack {
        AgentMcpServersView(agentId: agentId)
          .frame(maxHeight: .infinity, alignment: .top)
          .background(theme.bg.ignoresSafeArea())
          .navigationTitle("MCP Servers")
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button("Done") { showingMcp = false }
            }
          }
      }
      .presentationDetents([.medium, .large])
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

  /// File paths in the transcript open the viewer; reading needs control.
  private var fileLinkAction: OpenFileLinkAction? {
    guard let sessionId, host.hasControl else { return nil }
    return OpenFileLinkAction { [router] ref in
      router.push(.file(sessionId: sessionId, path: ref.path, line: ref.line, source: .chatLink))
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
