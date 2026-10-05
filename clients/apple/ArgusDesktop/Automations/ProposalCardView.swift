import ArgusCore
import ArgusUI
import SwiftUI

/// One proposal and everything you can do with it — start it (with or
/// without a note), ask for a better one, mark it done, dismiss it, follow its
/// CTA. The inbox and the proposal's own page both use it.
struct ProposalCardView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL
  let proposal: ArgusProtocol.Proposal
  /// Set on the proposal's page once it can't be acted on any more.
  var decided: String?
  /// The inbox opens the proposal's page from its title.
  var openable = false
  /// Where the page goes after a dismissal or a "done".
  var afterDecision: (() -> Void)?

  @State private var compose: Compose?
  @State private var text = ""
  @State private var confirmingCleanup = false
  @FocusState private var composing: Bool

  private enum Compose {
    case startNote, revise, resolve, dismiss

    var placeholder: String {
      switch self {
      case .startNote: "Anything the agent should know before it starts?"
      case .revise: "What should the automation do differently?"
      case .resolve: "What did you do? (optional)"
      case .dismiss: "Why? (optional)"
      }
    }

    var submit: String {
      switch self {
      case .startNote: "Start"
      case .revise: "Ask for Revision"
      case .resolve: "Mark as Done"
      case .dismiss: "Dismiss"
      }
    }
  }

  private var inbox: InboxStore { model.inbox }
  private var pending: Bool { proposal.status == .pending && decided == nil }
  private var starting: Bool { proposal.startStage != nil || inbox.starting.contains(proposal.id) }
  private var startError: String? { starting ? nil : proposal.startError ?? inbox.refusals[proposal.id] }

  var body: some View {
    Card {
      header
      MarkdownView(text: proposal.summary, baseSize: 13).textSelection(.enabled)
      if !proposal.rationale.isEmpty { MutedText(proposal.rationale) }
      if let revision = proposal.revisionRequest, !revision.isEmpty {
        Banner(text: revision, tone: .accent, title: "You asked for a revision")
      }
      if let decided { Banner(text: decided, tone: .muted) }
      if starting {
        HStack(spacing: 8) {
          ProgressView().controlSize(.small)
          MutedText(AutomationText.stage(proposal.startStage))
        }
      } else if let startError {
        Banner(text: startError, tone: .danger, title: "Couldn't start.").textSelection(.enabled)
      }
      if let compose { composer(compose) } else { actions }
    }
    .opacity(inbox.busy.contains(proposal.id) ? 0.5 : 1)
    .alert(cleanupTitle, isPresented: $confirmingCleanup) {
      Button(proposal.cta?.label ?? "Run Cleanup", role: .destructive) {
        Task { await inbox.cleanup(id: proposal.id) }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(cleanupWarning)
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 6) {
      if openable {
        Button { model.navigate(.proposal(id: proposal.id)) } label: {
          Text(proposal.title).font(.scaled(.headline)).foregroundStyle(theme.text).multilineTextAlignment(.leading)
        }
        .buttonStyle(.plain)
      } else {
        Text(proposal.title).font(.scaled(.headline)).textSelection(.enabled)
      }
      HStack(spacing: 6) {
        Badge(
          label: AutomationText.actionLabel(proposal.recommendedAction),
          tone: AutomationText.actionTone(proposal.recommendedAction))
        Badge(
          label: "\(Int((proposal.confidence * 100).rounded()))% sure",
          tone: proposal.confidence >= 0.7 ? .success : .muted)
        if let project = AutomationText.project(proposal.repoRoot) { Badge(label: project) }
        if let name = automationName { Badge(label: name) }
        MutedText(Labels.timeAgo(proposal.createdAt))
      }
    }
  }

  private var automationName: String? {
    model.automations.automations.first { $0.id == proposal.automationId }?.name
  }

  private var actions: some View {
    HStack(spacing: 8) {
      if pending, !starting { decisions }
      Spacer(minLength: 0)
      Button("View Run") {
        AutomationActions.openRun(model, automationId: proposal.automationId, runId: proposal.runId)
      }
      .buttonStyle(.link)
      if let source = proposal.sourceRef, let url = URL(string: source.url) {
        Button(source.externalId) { openURL(url) }.buttonStyle(.link)
      }
    }
  }

  @ViewBuilder
  private var decisions: some View {
    if let cta = proposal.cta {
      switch cta.kind {
      case .startSession:
        Button(startError == nil ? cta.label : "Try Again") { start(note: nil) }
          .buttonStyle(.borderedProminent)
        Button("Start with Note…") { begin(.startNote) }
      case .deleteBranch, .deleteSession:
        Button(cta.label) { confirmingCleanup = true }
      default:
        if let url = cta.url.flatMap(URL.init(string:)) {
          Button(cta.label) { openURL(url) }.buttonStyle(.borderedProminent)
        }
      }
    }
    Button("Request Revision…") { begin(.revise) }
    Button("Mark as Done…") { begin(.resolve) }
    Button("Dismiss…") { begin(.dismiss) }
  }

  private func composer(_ mode: Compose) -> some View {
    HStack(spacing: 8) {
      TextField(mode.placeholder, text: $text, axis: .vertical)
        .textFieldStyle(.roundedBorder)
        .lineLimit(1...4)
        .focused($composing)
        .onAppear { composing = true }
        .onSubmit { submit(mode) }
      Button(mode.submit) { submit(mode) }
        .buttonStyle(.borderedProminent)
        .disabled(mode == .revise && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      Button("Cancel") { compose = nil }
    }
  }

  private func begin(_ mode: Compose) {
    text = ""
    compose = mode
  }

  private func submit(_ mode: Compose) {
    let note = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let optional = note.isEmpty ? nil : note
    compose = nil
    switch mode {
    case .startNote: start(note: optional)
    case .revise:
      guard !note.isEmpty else { return }
      Task { await inbox.requestRevision(id: proposal.id, note: note) }
    case .resolve:
      Task { if await inbox.resolve(id: proposal.id, note: optional) { afterDecision?() } }
    case .dismiss:
      Task { if await inbox.dismiss(id: proposal.id, reason: optional) { afterDecision?() } }
    }
  }

  /// The host builds the session and starts the agent; all that's left is to
  /// follow you to it. A slow start shows its stage here instead.
  private func start(note: String?) {
    Task {
      guard let result = await inbox.start(id: proposal.id, note: note) else { return }
      model.navigate(.session(id: result.sessionId, agentId: result.agentId))
    }
  }

  private var cleanupTitle: String {
    proposal.cta?.kind == .deleteSession ? "Delete this session?" : "Delete this branch?"
  }

  private var cleanupWarning: String {
    guard let cta = proposal.cta else { return "" }
    if cta.kind == .deleteBranch {
      return "\(cta.force ? "git branch -D" : "git branch -d") \(cta.branch ?? "") — commits only "
        + "on this branch are gone for good."
    }
    return "The worktree and anything uncommitted in it are deleted. The branch is left alone."
  }
}
