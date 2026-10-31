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
  @Environment(\.dismiss) private var dismiss

  let historyId: String
  let repoRoot: String
  let label: String
  let branch: String
  let runnerSessionId: String

  @State private var resuming = false
  @State private var confirmingDelete = false

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

      AgentTranscriptView(agentKey: key, isLive: false) { working in
        Telemetry.capture(.transcriptWorkLogOpened(working: working))
      }
      // A saved chat only copies; there is no live conversation to edit or fork.
      .environment(
        \.messageMenu,
        MessageMenu(canChange: false) { action, message in
          guard action == .copy, let text = message.copyText else { return }
          Clipboard.copy(text)
          Telemetry.capture(
            .messageAction(action: .copy, role: message.role == .user ? .user : .assistant, success: true))
        })

      TranscriptFooterNote {
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
              : "This agent has stopped. Grant this phone control in Argus on your computer to resume it.")
        }
      }
    }
    .background(theme.bg.ignoresSafeArea())
    .navigationTitle(label)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        if let session {
          IconBtn(systemName: Icon.branch, label: "View changes") {
            router.push(.changes(sessionId: session.id, label: branch))
          }
        }
        if host.hasControl {
          IconBtn(systemName: Icon.trash, label: "Delete chat") { confirmingDelete = true }
        }
      }
    }
    .confirmationDialog("Delete this saved chat?", isPresented: $confirmingDelete, titleVisibility: .visible) {
      Button("Delete", role: .destructive, action: delete)
      Button("Cancel", role: .cancel) {}
    }
    .task { await host.loadSessions(repoRoot: repoRoot) }
  }

  private func resume(_ session: RemoteSession) {
    resuming = true
    Task {
      // The runner it ran on, when the list has it; older hosts don't say.
      let agent =
        if let chat = host.stoppedChat(repoRoot: repoRoot, historyId: historyId) {
          await host.resumeChat(chat, sessionId: session.id)
        } else {
          await host.spawnAgent(sessionId: session.id, resumeSessionId: runnerSessionId)
        }
      resuming = false
      guard let agent else { return }
      router.push(.agent(id: agent.agentId, label: label))
    }
  }

  private func delete() {
    Task {
      await host.deleteChatHistory(repoRoot: repoRoot, historyIds: [historyId])
      Telemetry.capture(.chatHistoryUsed(action: .delete))
      dismiss()
    }
  }
}
