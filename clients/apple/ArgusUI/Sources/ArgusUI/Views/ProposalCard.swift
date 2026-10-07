import ArgusCore
import SwiftUI

public struct ProposalCard: View {
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL

  let proposal: RemoteProposal
  /// Dismiss, resolve or cleanup in flight — starting has its own row.
  let busy: Bool
  let starting: Bool
  /// The accept request's own failure, which wins over the host's older one.
  let requestError: String?
  let canDecide: Bool
  let onAccept: () -> Void
  let onCleanup: () -> Void
  let onDismiss: (String?) -> Void
  let onResolve: (String?) -> Void
  /// Nil when the computer didn't say which run raised it.
  var onOpenRun: (() -> Void)?
  /// The proposal's own screen; nil when the card already is it.
  var onOpenDetails: (() -> Void)?

  @State private var dismissing = false
  @State private var resolving = false
  @State private var reason = ""
  @State private var done = ""
  @State private var confirmingCleanup = false

  public init(
    proposal: RemoteProposal,
    busy: Bool,
    starting: Bool,
    requestError: String? = nil,
    canDecide: Bool,
    onAccept: @escaping () -> Void,
    onCleanup: @escaping () -> Void,
    onDismiss: @escaping (String?) -> Void,
    onResolve: @escaping (String?) -> Void,
    onOpenRun: (() -> Void)? = nil,
    onOpenDetails: (() -> Void)? = nil
  ) {
    self.proposal = proposal
    self.busy = busy
    self.starting = starting
    self.requestError = requestError
    self.canDecide = canDecide
    self.onAccept = onAccept
    self.onCleanup = onCleanup
    self.onDismiss = onDismiss
    self.onResolve = onResolve
    self.onOpenRun = onOpenRun
    self.onOpenDetails = onOpenDetails
  }

  public var body: some View {
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

      if starting {
        startProgress
      } else if let startFailure {
        Banner(text: startFailure, tone: .danger, title: "Couldn't start")
          .textSelection(.enabled)
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
    VStack(alignment: .leading, spacing: 8) {
      if !starting { decisions }
      HStack(spacing: 14) {
        if let onOpenDetails {
          Button("Details", action: onOpenDetails)
            .buttonStyle(.plain)
            .font(.scaled(size: 12))
            .foregroundStyle(theme.accent)
        }
        if let onOpenRun {
          Button("View run", action: onOpenRun)
            .buttonStyle(.plain)
            .font(.scaled(size: 12))
            .foregroundStyle(theme.accent)
        }
        if let source = proposal.sourceUrl, let url = URL(string: source) {
          Link(proposal.sourceLabel ?? "Source", destination: url)
            .font(.scaled(size: 12))
            .buttonStyle(.accentLink)
        }
      }
    }
  }

  /// Three decisions with real labels do not fit one phone-width row, and
  /// squeezing them wraps the text inside the buttons instead.
  private var decisions: some View {
    FlowRow(spacing: 8) {
      if canDecide, let cta = proposal.cta {
        switch cta.kind {
        case .startSession:
          Btn(
            label: startFailure == nil ? cta.label : "Try again", small: true,
            icon: startFailure == nil ? Icon.play : Icon.refresh, action: onAccept)
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
    }
  }

  private var startProgress: some View {
    HStack(spacing: 8) {
      ProgressView().controlSize(.small)
      MutedText(stageLabel)
    }
    .accessibilityElement(children: .combine)
  }

  private var stageLabel: String {
    switch proposal.startStage {
    case .creatingWorktree: "Creating worktree…"
    case .settingUp: "Running setup…"
    case .startingAgent: "Starting agent…"
    case nil: "Starting…"
    }
  }

  private var startFailure: String? {
    starting ? nil : requestError ?? proposal.startError
  }

  /// The reason is the training signal, so asking for it must cost nothing.
  private var dismissForm: some View {
    VStack(alignment: .leading, spacing: 8) {
      ThemedTextField(placeholder: "Why? (optional)", text: $reason) { submitDismiss() }
      FlowRow(spacing: 8) {
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
      FlowRow(spacing: 8) {
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

/// A start from this phone that finished after the request answered: the
/// agent is running, so offer the way to it instead of just vanishing.
public struct StartedProposalCard: View {
  @Environment(\.theme) private var theme

  let proposal: RemoteProposal
  let onOpen: () -> Void
  let onClose: () -> Void

  public init(
    proposal: RemoteProposal,
    onOpen: @escaping () -> Void,
    onClose: @escaping () -> Void
  ) {
    self.proposal = proposal
    self.onOpen = onOpen
    self.onClose = onClose
  }

  public var body: some View {
    Card(tone: .success) {
      HStack(spacing: 8) {
        Image(systemName: Icon.check)
          .font(.scaled(size: 13, weight: .semibold))
          .foregroundStyle(theme.success)
        BodyText("Agent started")
        Spacer(minLength: 4)
        Button(action: onClose) {
          Image(systemName: Icon.close)
            .font(.scaled(size: 12, weight: .semibold))
            .foregroundStyle(theme.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close")
      }
      MutedText(proposal.title, lineLimit: 2)
      FlowRow(spacing: 8) {
        Btn(label: "Open agent", small: true, icon: Icon.agent, action: onOpen)
      }
    }
  }
}
