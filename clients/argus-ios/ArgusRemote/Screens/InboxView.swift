import ArgusKit
import SwiftUI

/// What the computer's automations want you to decide.
///
/// The decisions are the half of the inbox worth having on a phone: they
/// arrive while nobody is looking, and answering one is a tap.
struct InboxView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router
  @Environment(ProposalsStore.self) private var proposals

  var body: some View {
    List {
      if let error = proposals.error {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }

      if !proposals.loaded {
        Loading(label: "Reading the inbox…")
          .listRowBackground(Color.clear)
      } else if proposals.proposals.isEmpty {
        EmptyState(
          icon: Icon.envelope,
          title: "Nothing needs you",
          body: "When an automation finds something worth deciding on, it shows up here.")
        .listRowBackground(Color.clear)
      } else {
        Section("Decide") {
          ForEach(proposals.proposals) { proposal in
            ProposalCard(
              proposal: proposal,
              busy: proposals.busy.contains(proposal.id),
              canDecide: app.hasControl,
              onAccept: { accept(proposal) },
              onCleanup: { Task { await proposals.performCleanup(id: proposal.id) } },
              onDismiss: { reason in
                Task { await proposals.dismiss(id: proposal.id, reason: reason) }
              },
              onResolve: { note in
                Task { await proposals.resolve(id: proposal.id, note: note) }
              })
          }
        }
      }
    }
    .navigationTitle("Inbox")
    .refreshable { await proposals.refresh() }
    .liveRefresh(enabled: app.connection == .ready) { await proposals.refresh() }
  }

  /// Accepting spawns the agent that does the work, so go and watch it.
  private func accept(_ proposal: RemoteProposal) {
    Task {
      guard let agentId = await proposals.accept(id: proposal.id) else { return }
      router.push(.agent(id: agentId, label: proposal.title))
    }
  }
}

struct ProposalCard: View {
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL

  let proposal: RemoteProposal
  let busy: Bool
  let canDecide: Bool
  let onAccept: () -> Void
  let onCleanup: () -> Void
  let onDismiss: (String?) -> Void
  let onResolve: (String?) -> Void

  @State private var dismissing = false
  @State private var resolving = false
  @State private var reason = ""
  @State private var done = ""
  @State private var confirmingCleanup = false

  var body: some View {
    Card {
      BodyText(proposal.title)
      MarkdownView(text: proposal.summary, baseSize: 14)
      if !proposal.rationale.isEmpty {
        MutedText(proposal.rationale)
      }

      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          Chip(
            label: "\(Int(proposal.confidence * 100))% sure",
            tone: proposal.confidence >= 0.7 ? .success : .muted)
          if let project = proposal.project { Chip(label: project, icon: Icon.folder) }
          Chip(label: proposal.automationName, icon: Icon.clock)
          Chip(label: Labels.timeAgo(proposal.createdAt))
        }
      }

      if dismissing {
        dismissForm
      } else if resolving {
        resolveForm
      } else {
        actions
      }
    }
    .opacity(busy ? 0.5 : 1)
    .confirmationDialog(
      cleanupTitle, isPresented: $confirmingCleanup, titleVisibility: .visible
    ) {
      Button("Run cleanup", role: .destructive, action: onCleanup)
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(cleanupWarning)
    }
  }

  @ViewBuilder
  private var actions: some View {
    HStack(spacing: 8) {
      if canDecide, let cta = proposal.cta {
        switch cta.kind {
        case .startSession:
          Btn(label: cta.label, small: true, icon: Icon.play, action: onAccept)
        case .deleteBranch, .deleteSession:
          Btn(label: cta.label, tone: .danger, small: true) { confirmingCleanup = true }
        case .openUrl:
          Btn(label: cta.label, tone: .secondary, small: true) {
            if let url = cta.url.flatMap(URL.init(string:)) { openURL(url) }
          }
        }
      }
      if canDecide {
        Btn(
          label: "Mark as done", tone: proposal.cta == nil ? .primary : .secondary,
          small: true, icon: Icon.check
        ) { resolving = true }
        Btn(label: "Dismiss", tone: .ghost, small: true) { dismissing = true }
      }
      Spacer()
      if let source = proposal.sourceUrl, let url = URL(string: source) {
        Link(proposal.sourceLabel ?? "Source", destination: url)
          .font(.system(size: 12))
          .foregroundStyle(theme.accent)
      }
    }
  }

  /// The reason is the training signal, so asking for it must cost nothing.
  private var dismissForm: some View {
    VStack(alignment: .leading, spacing: 8) {
      ThemedTextField(placeholder: "Why? (optional)", text: $reason) { submitDismiss() }
      HStack(spacing: 8) {
        Btn(label: "Dismiss", tone: .danger, small: true) { submitDismiss() }
        Btn(label: "Cancel", tone: .ghost, small: true) { dismissing = false }
      }
    }
  }

  /// The same bargain as the dismiss form: what you did, if you feel like
  /// saying — never a required field.
  private var resolveForm: some View {
    VStack(alignment: .leading, spacing: 8) {
      ThemedTextField(placeholder: "What did you do? (optional)", text: $done) {
        submitResolve()
      }
      HStack(spacing: 8) {
        Btn(label: "Mark as done", small: true, icon: Icon.check) { submitResolve() }
        Btn(label: "Cancel", tone: .ghost, small: true) { resolving = false }
      }
    }
  }

  private func submitResolve() {
    let trimmed = done.trimmingCharacters(in: .whitespacesAndNewlines)
    onResolve(trimmed.isEmpty ? nil : trimmed)
    resolving = false
    done = ""
  }

  private func submitDismiss() {
    let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
    onDismiss(trimmed.isEmpty ? nil : trimmed)
    dismissing = false
    reason = ""
  }

  private var cleanupTitle: String {
    proposal.cta?.kind == .deleteSession ? "Delete this session?" : "Delete this branch?"
  }

  /// Spell out exactly what will happen — these are the destructive ones.
  private var cleanupWarning: String {
    guard let cta = proposal.cta else { return "" }
    switch cta.kind {
    case .deleteBranch:
      let command = cta.force ? "git branch -D" : "git branch -d"
      return "Runs \(command) \(cta.branch ?? "") on the computer."
    case .deleteSession:
      return "Deletes the worktree and anything uncommitted in it."
    default:
      return ""
    }
  }
}
