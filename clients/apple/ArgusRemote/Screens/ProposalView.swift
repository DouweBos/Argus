import ArgusUI
import SwiftUI

/// `/inbox/proposals/:proposalId` — one proposal in full. A pending one can
/// be started with a note or sent back for a revision; a decided one still
/// reads here, with what became of it.
struct ProposalView: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(ProposalsStore.self) private var proposals

  let proposalId: String
  @State private var looked = false
  @State private var note = ""
  @State private var revision = ""
  @State private var revisionSent: Bool?

  private var proposal: RemoteProposal? { proposals.detailById[proposalId] }

  var body: some View {
    Screen {
      if let error = proposals.error {
        Banner(text: error, tone: .danger)
      }
      if let proposal {
        if let decided = Self.decidedNote(proposal) {
          Banner(text: decided, tone: .muted)
        }
        ProposalCard(
          proposal: proposal,
          busy: proposals.busy.contains(proposal.id),
          starting: proposals.isStarting(proposal),
          requestError: proposals.requestErrors[proposal.id],
          canDecide: host.hasControl && proposal.status == .pending,
          onAccept: { accept(note: nil) },
          onCleanup: { Task { await act { await proposals.performCleanup(id: proposalId) } } },
          onDismiss: { reason in
            Task { await act { await proposals.dismiss(id: proposalId, reason: reason) } }
          },
          onResolve: { done in
            Task { await act { await proposals.resolve(id: proposalId, note: done) } }
          },
          onOpenRun: proposal.runId.map { runId in
            { router.push(.run(id: runId, label: proposal.automationName)) }
          })
        if let asked = proposal.revisionRequest {
          Banner(
            text: "You asked for a revision: \(asked). The next run picks it up.",
            tone: .muted)
        }
        if host.hasControl, proposal.status == .pending, !proposals.isStarting(proposal) {
          if proposal.cta?.kind == .startSession { startWithNote }
          requestRevision
        }
        links(proposal)
      } else if looked {
        EmptyState(
          icon: Icon.envelope, title: "This proposal is gone",
          body: "The computer no longer has it.")
      } else {
        Loading(label: "Reading the proposal…")
      }
    }
    .navigationTitle(proposal?.title ?? "Proposal")
    .navigationBarTitleDisplayMode(.inline)
    .refreshable { await proposals.load(id: proposalId) }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(5)) {
      await proposals.load(id: proposalId)
      looked = true
    }
  }

  /// Goes into the agent's brief, as the desktop's "Start with a note".
  private var startWithNote: some View {
    Card {
      BodyText("Start with a note")
      MutedText("Added to the agent's brief.")
      ThemedTextField(placeholder: "What should it know?", text: $note, multiline: true)
      Btn(label: "Start with note", small: true, icon: Icon.play) {
        accept(note: note)
      }
      .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
  }

  private var requestRevision: some View {
    Card {
      BodyText("Ask for a revision")
      MutedText("The automation reworks it on its next run, which replaces this one.")
      ThemedTextField(placeholder: "What should change?", text: $revision, multiline: true)
      Btn(label: "Request revision", tone: .secondary, small: true, icon: Icon.refresh) {
        let text = revision
        Task {
          revisionSent = await proposals.requestRevision(id: proposalId, note: text)
          if revisionSent != nil { revision = "" }
        }
      }
      .disabled(revision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      if let revisionSent {
        MutedText(
          revisionSent
            ? "A run is reworking it now." : "Saved — the next run picks it up.")
      }
    }
  }

  @ViewBuilder
  private func links(_ proposal: RemoteProposal) -> some View {
    if let agentId = proposal.agentId {
      Btn(label: "Open the agent working on it", tone: .ghost, small: true, icon: Icon.agent) {
        router.push(.agent(id: agentId, label: proposal.title))
      }
    }
    if let replacement = proposal.supersededBy {
      Btn(label: "The proposal that replaced it", tone: .ghost, small: true) {
        router.push(.proposal(id: replacement))
      }
    }
  }

  private func accept(note: String?) {
    Task {
      guard let agentId = await proposals.accept(id: proposalId, note: note) else {
        await proposals.load(id: proposalId)
        return
      }
      self.note = ""
      router.push(.agent(id: agentId, label: proposal?.title ?? "Agent"))
    }
  }

  private func act(_ action: () async -> Void) async {
    await action()
    await proposals.load(id: proposalId)
  }

  /// What happened to a proposal nobody can act on any more, as the desktop says it.
  static func decidedNote(_ proposal: RemoteProposal) -> String? {
    let by = proposal.automationName
    let cleared = proposal.clearedReason.map { ": \($0)" }
    switch proposal.status {
    case .pending: return nil
    case .accepted:
      return proposal.acceptedNote.map { "You started this, with the note: \($0)" }
        ?? "You started this."
    case .autoStarted: return "Argus started this itself — the guardrails allowed it."
    case .dismissed:
      return proposal.dismissedReason.map { "You dismissed this: \($0)" } ?? "You dismissed this."
    case .resolved:
      return proposal.resolvedNote.map { "You marked this done: \($0)" }
        ?? "You marked this done — you handled it yourself."
    case .superseded: return "A later run of \(by) proposed the same work again\(cleared ?? ".")"
    case .withdrawn:
      return "\(by) withdrew this\(cleared ?? " — the signal behind it went away.")"
    }
  }
}
