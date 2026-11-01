import ArgusCore
import ArgusKit
import SwiftUI

/// What a proposal card shows, whichever wire shape the proposal came in.
public struct ProposalCardContent {
  public enum Cta {
    case start(label: String)
    case cleanup(label: String, deletesSession: Bool, branch: String?, force: Bool)
    case open(label: String, url: URL)
  }

  public var title: String
  public var summary: String
  public var rationale: String
  public var confidence: Double
  /// What the run recommends; the phone's narrowed shape doesn't carry it.
  public var action: (label: String, tone: Tone)?
  public var project: String?
  /// The project's repo root, which colours its badge.
  public var projectKey: String?
  public var automationName: String?
  public var createdAt: Double
  public var cta: Cta?
  public var source: (label: String, url: URL)?
  public var revisionRequest: String?
  public var startStage: String?
  public var startError: String?
  public var isPending: Bool

  public init(_ proposal: RemoteProposal, projectKey: String? = nil) {
    title = proposal.title
    summary = proposal.summary
    rationale = proposal.rationale
    confidence = proposal.confidence
    project = proposal.project
    self.projectKey = projectKey
    automationName = proposal.automationName
    createdAt = proposal.createdAt
    cta = proposal.cta.flatMap {
      Self.cta(kind: $0.kind.rawValue, label: $0.label, url: $0.url, branch: $0.branch, force: $0.force)
    }
    source = proposal.sourceUrl.flatMap(URL.init(string:)).map { (proposal.sourceLabel ?? "Source", $0) }
    revisionRequest = proposal.revisionRequest
    startStage = proposal.startStage?.rawValue
    startError = proposal.startError
    isPending = proposal.status == .pending
  }

  /// The catalog's proposal carries no automation name; the caller resolves it.
  public init(_ proposal: ArgusProtocol.Proposal, automationName: String?) {
    title = proposal.title
    summary = proposal.summary
    rationale = proposal.rationale
    confidence = proposal.confidence
    action = (
      AutomationText.actionLabel(proposal.recommendedAction), AutomationText.actionTone(proposal.recommendedAction)
    )
    project = AutomationText.project(proposal.repoRoot)
    projectKey = proposal.repoRoot
    self.automationName = automationName
    createdAt = proposal.createdAt
    cta = proposal.cta.flatMap {
      Self.cta(kind: $0.kind.rawValue, label: $0.label, url: $0.url, branch: $0.branch, force: $0.force)
    }
    source = proposal.sourceRef.flatMap { ref in URL(string: ref.url).map { (ref.externalId, $0) } }
    revisionRequest = proposal.revisionRequest
    startStage = proposal.startStage?.rawValue
    startError = proposal.startError
    isPending = proposal.status == .pending
  }

  /// Both wire shapes share the raw values.
  private static func cta(kind: String, label: String, url: String?, branch: String?, force: Bool) -> Cta? {
    switch kind {
    case "start_session": .start(label: label)
    case "delete_branch": .cleanup(label: label, deletesSession: false, branch: branch, force: force)
    case "delete_session": .cleanup(label: label, deletesSession: true, branch: branch, force: force)
    default: url.flatMap(URL.init(string:)).map { .open(label: label, url: $0) }
    }
  }
}

/// Everything a proposal card can ask its owner to do.
public struct ProposalCardActions {
  public var start: (_ note: String?) -> Void
  public var requestRevision: (_ note: String) -> Void
  public var resolve: (_ note: String?) -> Void
  public var dismiss: (_ reason: String?) -> Void
  public var cleanup: () -> Void
  /// Nil when nobody said which run raised it.
  public var openRun: (() -> Void)?
  /// The proposal's own page; nil when the card already is it.
  public var openDetails: (() -> Void)?

  public init(
    start: @escaping (String?) -> Void, requestRevision: @escaping (String) -> Void,
    resolve: @escaping (String?) -> Void, dismiss: @escaping (String?) -> Void, cleanup: @escaping () -> Void,
    openRun: (() -> Void)? = nil, openDetails: (() -> Void)? = nil
  ) {
    self.start = start
    self.requestRevision = requestRevision
    self.resolve = resolve
    self.dismiss = dismiss
    self.cleanup = cleanup
    self.openRun = openRun
    self.openDetails = openDetails
  }
}

/// One proposal and everything you can do with it — start it (with or
/// without a note), ask for a better one, mark it done, dismiss it, follow its
/// CTA. The note is asked for inline, in place of the card's footer.
public struct ProposalCard: View {
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL

  let content: ProposalCardContent
  /// What became of it, once it can't be acted on any more.
  var decided: String?
  /// Dismiss, resolve or cleanup in flight — starting has its own row.
  var busy: Bool
  var starting: Bool
  /// The start request's own failure, which wins over the host's older one.
  var requestError: String?
  var canDecide: Bool
  let actions: ProposalCardActions

  @State private var compose: Compose?
  @State private var text = ""
  @State private var confirmingCleanup = false
  @FocusState private var composing: Bool

  public init(
    content: ProposalCardContent, decided: String? = nil, busy: Bool, starting: Bool,
    requestError: String? = nil, canDecide: Bool, actions: ProposalCardActions
  ) {
    self.content = content
    self.decided = decided
    self.busy = busy
    self.starting = starting
    self.requestError = requestError
    self.canDecide = canDecide
    self.actions = actions
  }

  enum Compose: String, Identifiable {
    case startNote, revise, resolve, dismiss

    var id: String { rawValue }

    var title: String {
      switch self {
      case .startNote: "Start with a note"
      case .revise: "Request a revision"
      case .resolve: "Mark as done"
      case .dismiss: "Dismiss"
      }
    }

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

    /// The phone's confirm: one word, so it fits beside the field.
    var confirm: String {
      switch self {
      case .startNote: "Start"
      case .revise: "Send"
      case .resolve: "Done"
      case .dismiss: "Dismiss"
      }
    }

    /// A revision is the one note that says nothing without its text.
    var needsText: Bool { self == .revise }
  }

  private var startFailure: String? { starting ? nil : requestError ?? content.startError }
  private var deciding: Bool { canDecide && content.isPending && !starting }

  public var body: some View {
    Card {
      header
      MarkdownView(text: content.summary, baseSize: 14).textSelection(.enabled)
      if !content.rationale.isEmpty { MutedText(content.rationale) }
      if let revision = content.revisionRequest, !revision.isEmpty {
        Banner(text: revision, tone: .accent, title: "You asked for a revision")
      }
      if let decided { Banner(text: decided, tone: .muted) }
      if starting {
        HStack(spacing: 8) {
          ProgressView().controlSize(.small)
          MutedText(AutomationText.stage(content.startStage))
        }
        .accessibilityElement(children: .combine)
      } else if let startFailure {
        Banner(text: startFailure, tone: .danger, title: "Couldn't start").textSelection(.enabled)
      }
      if let compose { composer(compose) } else { footer }
    }
    .opacity(busy ? 0.5 : 1)
    .alert(cleanupTitle, isPresented: $confirmingCleanup) {
      Button(cleanupLabel, role: .destructive, action: actions.cleanup)
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(cleanupWarning)
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let open = actions.openDetails {
        Button(action: open) {
          Text(content.title).font(.scaled(.headline)).foregroundStyle(theme.text)
            .multilineTextAlignment(.leading)
        }
        .buttonStyle(.argusPlain)
        .accessibilityHint("Opens the proposal")
      } else {
        Text(content.title).font(.scaled(.headline)).textSelection(.enabled)
      }
      FlowRow(spacing: 6, rowSpacing: 6, packed: true) {
        if let action = content.action { Badge(label: action.label, tone: action.tone) }
        Badge(
          label: "\(Int((content.confidence * 100).rounded()))% sure",
          tone: content.confidence >= 0.7 ? .success : .muted)
        if let project = content.project {
          HStack(spacing: 4) {
            ProjectBadge(project, key: content.projectKey, size: 14)
            Badge(label: project)
          }
        }
        if let name = content.automationName { Badge(label: name) }
        MutedText(Labels.timeAgo(content.createdAt))
      }
    }
  }

  /// The decisions, then the links out.
  private var footer: some View {
    #if os(macOS)
      HStack(spacing: 8) {
        if deciding { macDecisions }
        Spacer(minLength: 0)
        links
      }
    #else
      VStack(alignment: .leading, spacing: 10) {
        if deciding { phoneDecisions }
        HStack(spacing: 14) { links }.font(.scaled(.subheadline).weight(.medium))
      }
    #endif
  }

  @ViewBuilder
  private var links: some View {
    if let openRun = actions.openRun {
      Button("View Run", action: openRun).buttonStyle(.accentLink)
    }
    if let source = content.source {
      Button(source.label) { openURL(source.url) }.buttonStyle(.accentLink)
    }
  }

  #if os(macOS)
    @ViewBuilder
    private var macDecisions: some View {
      switch content.cta {
      case .start(let label):
        Button(startFailure == nil ? label : "Try Again") { actions.start(nil) }
          .buttonStyle(.borderedProminent)
        Button("Start with Note…") { begin(.startNote) }
      case .cleanup(let label, _, _, _):
        Button(label) { confirmingCleanup = true }
      case .open(let label, let url):
        Button(label) { openURL(url) }.buttonStyle(.borderedProminent)
      case nil:
        EmptyView()
      }
      Button("Request Revision…") { begin(.revise) }
      Button("Mark as Done…") { begin(.resolve) }
      Button("Dismiss…") { begin(.dismiss) }
    }

  #else
    /// The CTA, done and dismiss as buttons; the two that need a note behind a
    /// menu, since five labelled buttons don't fit a phone's width. The menu
    /// sits outside the flow so it stays on the first line instead of wrapping.
    private var phoneDecisions: some View {
      HStack(alignment: .top, spacing: 4) {
        FlowRow(spacing: 8) { phoneButtons }
        moreDecisions
      }
    }

    @ViewBuilder private var phoneButtons: some View {
      switch content.cta {
      case .start(let label):
        Btn(
          label: startFailure == nil ? label : "Try again", small: true,
          icon: startFailure == nil ? Icon.play : Icon.refresh
        ) { actions.start(nil) }
      case .cleanup(let label, _, _, _):
        Btn(label: label, tone: .danger, small: true) { confirmingCleanup = true }
      case .open(let label, let url):
        Btn(label: label, tone: .secondary, small: true) { openURL(url) }
      case nil:
        EmptyView()
      }
      Btn(label: "Mark as done", tone: content.cta == nil ? .primary : .secondary, small: true, icon: Icon.check) {
        begin(.resolve)
      }
      Btn(label: "Dismiss", tone: .ghost, small: true) { begin(.dismiss) }
    }

    private var moreDecisions: some View {
      Menu {
        if case .start = content.cta {
          Button("Start with a note…", systemImage: Icon.play) { begin(.startNote) }
        }
        Button("Request a revision…", systemImage: Icon.refresh) { begin(.revise) }
      } label: {
        Image(systemName: Icon.ellipsis)
          .font(.scaled(size: 14, weight: .semibold))
          .foregroundStyle(theme.textSecondary)
          .frame(width: 44, height: 32)
          .contentShape(.rect)
      }
      .accessibilityLabel("More decisions")
    }
  #endif

  private var blank: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  /// The note, in place of the footer; the field and its buttons share a row so
  /// scrolling the focused field above the keyboard brings them along.
  private func composer(_ mode: Compose) -> some View {
    #if os(macOS)
      HStack(spacing: 8) {
        TextField(mode.placeholder, text: $text, axis: .vertical)
          .textFieldStyle(.roundedBorder)
          .lineLimit(1...4)
          .focused($composing)
          .onAppear { composing = true }
          .onSubmit { submit(mode) }
        Button(mode.submit) { submit(mode) }
          .buttonStyle(.borderedProminent)
          .disabled(mode.needsText && blank)
        Button("Cancel") { compose = nil }
      }
    #else
      VStack(alignment: .leading, spacing: 6) {
        MutedText(mode.title)
        HStack(alignment: .bottom, spacing: 8) {
          ThemedTextField(placeholder: mode.placeholder, text: $text, multiline: true, lines: 1...4)
            .focused($composing)
            .onAppear { composing = true }
          Btn(label: mode.confirm, small: true, hugs: true) { submit(mode) }
            .fixedSize()
            .disabled(mode.needsText && blank)
          Button {
            composing = false
            compose = nil
          } label: {
            Image(systemName: Icon.close)
              .font(.scaled(size: 13, weight: .semibold))
              .foregroundStyle(theme.textSecondary)
              .frame(width: 32, height: 32)
              .contentShape(.rect)
          }
          .buttonStyle(.argusPlain)
          .accessibilityLabel("Cancel")
        }
      }
    #endif
  }

  private func begin(_ mode: Compose) {
    text = ""
    compose = mode
  }

  private func submit(_ mode: Compose) {
    let note = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let optional = note.isEmpty ? nil : note
    if mode.needsText, note.isEmpty { return }
    compose = nil
    text = ""
    switch mode {
    case .startNote: actions.start(optional)
    case .revise: actions.requestRevision(note)
    case .resolve: actions.resolve(optional)
    case .dismiss: actions.dismiss(optional)
    }
  }

  private var cleanupTitle: String {
    if case .cleanup(_, true, _, _) = content.cta { return "Delete this session?" }
    return "Delete this branch?"
  }

  private var cleanupLabel: String {
    if case .cleanup(let label, _, _, _) = content.cta { return label }
    return "Run Cleanup"
  }

  /// Spell out exactly what will happen — these are the destructive ones.
  private var cleanupWarning: String {
    guard case .cleanup(_, let deletesSession, let branch, let force) = content.cta else { return "" }
    if deletesSession {
      return "The worktree and anything uncommitted in it are deleted. The branch is left alone."
    }
    return "\(force ? "git branch -D" : "git branch -d") \(branch ?? "") — commits only on this branch are gone for good."
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
        .buttonStyle(.argusPlain)
        .accessibilityLabel("Close")
      }
      MutedText(proposal.title, lineLimit: 2)
      FlowRow(spacing: 8) {
        Btn(label: "Open agent", small: true, icon: Icon.agent, action: onOpen)
      }
    }
  }
}
