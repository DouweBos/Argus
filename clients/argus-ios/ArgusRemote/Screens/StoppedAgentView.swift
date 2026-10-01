import ArgusUI
import SwiftUI

/// A finished agent's transcript, read back from the computer's saved history.
///
/// Read-only — the process is gone — but a control device can pick the
/// conversation back up in a fresh agent.
struct StoppedAgentView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  let historyId: String
  let repoRoot: String
  let label: String
  let branch: String
  let runnerSessionId: String

  @State private var resuming = false

  private var key: String {
    HostStore.stoppedKey(repoRoot: repoRoot, historyId: historyId)
  }

  /// Resuming needs somewhere to run: the session still on this branch. Once
  /// that worktree is gone there is nothing to resume into.
  private var session: RemoteSession? {
    (host.sessionsByRepo[repoRoot] ?? []).first { $0.branch == branch }
  }

  var body: some View {
    VStack(spacing: 0) {

      AgentTranscriptView(agentKey: key, isLive: false)

      VStack(alignment: .leading, spacing: 6) {
        if host.hasControl, let session {
          Btn(
            label: resuming ? "Resuming…" : "Resume in a new agent",
            icon: Icon.plus
          ) {
            resume(session)
          }
          .disabled(resuming)
        } else {
          MutedText(
            host.hasControl
              ? "This agent's session is gone, so there's nothing to resume into."
              : "This agent has stopped. Ask the desktop for control to resume it.")
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(theme.space)
      .background(theme.bgSecondary)
      .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 1) }
    }
    .background(theme.bg.ignoresSafeArea())
    .navigationTitle(label)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        if let session {
          IconBtn(systemName: Icon.branch, label: "View changes") {
            router.push(.changes(sessionId: session.id, label: branch))
          }
        }
      }
    }
    .task { await host.loadSessions(repoRoot: repoRoot) }
  }

  private func resume(_ session: RemoteSession) {
    resuming = true
    Task {
      let agent = await host.spawnAgent(
        sessionId: session.id, resumeSessionId: runnerSessionId)
      resuming = false
      guard let agent else { return }
      router.push(.agent(id: agent.agentId, label: label))
    }
  }
}
