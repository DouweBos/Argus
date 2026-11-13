import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// Whether each panel's context card is collapsed to its switcher, remembered per panel.
enum ContextCardPreference {
  static func key(_ panel: SessionPanel) -> String { "argus:contextCard.collapsed.\(panel.rawValue)" }
  /// Agent opens with the card out; Code and Git keep it to its switcher so their own bars stay clear.
  static func collapsedByDefault(_ panel: SessionPanel) -> Bool { panel != .agents }
}

/// The session at a glance, at the top right of its panel: the Agent / Code /
/// Git switcher, then (unless collapsed) the machine it's on, opening it in an
/// editor, its run command, huddle and the agent's MCP servers, its ticket and
/// designs, its branch, pushing it, how much it has changed, and its recent chats.
struct SessionContextCard: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL
  let session: RemoteSession
  let panel: SessionPanel
  @AppStorage private var savedCollapsed: Bool
  /// Too narrow to stay open, the card folds; the chevron can still open it over the panel for a moment.
  let roomToOpen: Bool
  @State private var peeking = false
  @State private var path: String?
  @State private var editors: [ArgusProtocol.EditorDescriptor] = []
  /// In-flight git actions and offered PR links, by session: the card outlives a switch to another one.
  @State private var pushingIds: Set<String> = []
  @State private var pullingIds: Set<String> = []
  @State private var mergingIds: Set<String> = []
  @State private var pullRequestURLs: [String: URL] = [:]
  /// Why the host would refuse a merge into the base branch; empty means it would go through.
  @State private var mergeBlockers: [String] = []
  @State private var renamingBranch = false
  @State private var showingChats = false
  @State private var chatCount: Int?
  /// For the branch row's switcher; read while the card is open.
  @State private var localBranches: [String] = []
  @AppStorage("argus:contextCard.editor") private var lastEditor = ""

  init(session: RemoteSession, panel: SessionPanel, roomToOpen: Bool = true) {
    self.session = session
    self.panel = panel
    self.roomToOpen = roomToOpen
    _savedCollapsed = AppStorage(wrappedValue: ContextCardPreference.collapsedByDefault(panel), ContextCardPreference.key(panel))
  }

  private var hostId: HostId { model.host(ofSession: session.id) }
  private var isLocal: Bool { hostId == Hosts.local }
  private var git: RemoteGitStatus? { store.gitStatusBySession[session.id] }
  private var ready: Bool { session.status == .ready && !session.isUnavailable }
  private var collapsed: Bool { roomToOpen ? savedCollapsed : !peeking }
  private var pushing: Bool { pushingIds.contains(session.id) }
  private var pulling: Bool { pullingIds.contains(session.id) }
  private var merging: Bool { mergingIds.contains(session.id) }

  var body: some View {
    ContextCard(chrome: !collapsed) {
      switcher
      if !collapsed { details }
    }
    .onChange(of: roomToOpen) { peeking = false }
    .sheet(isPresented: $renamingBranch) { RenameBranchSheet(session: session) }
    .sheet(isPresented: $showingChats) {
      RecentChatsSheet(session: session) { Task { await loadChatCount() } }
    }
    .task(id: "\(session.id):\(session.status.rawValue)") { await loadPaths() }
    .task(id: SessionChats.reloadKey(session, store: store)) { await loadChatCount() }
    .task(id: collapsed || !ready || session.isOutsideProjects ? nil : "\(session.id):\(git?.branch ?? session.branch)") {
      guard !collapsed, ready, !session.isOutsideProjects else { return }
      localBranches = await model.localBranches(repoRoot: session.repoRoot) ?? localBranches
    }
    .liveRefresh(enabled: !collapsed && ready && !session.isOutsideProjects, every: .seconds(10)) {
      await store.loadGitStatus(sessionId: session.id)
    }
    .task(id: collapsed || !ready || session.kind != .worktree ? nil : "\(session.id):\(git?.dirtyCount ?? 0):\(git?.ahead ?? 0)") {
      guard !collapsed, ready, session.kind == .worktree else { return }
      mergeBlockers = await store.mergeBlockers(sessionId: session.id)
    }
  }

  @ViewBuilder private var details: some View {
    ContextCardDivider()
    if session.setupPending == true, !session.isUnavailable { SetupContextRow(session: session) }
    machineRow
    if isLocal, let path, let editor = preferredEditor { editorRow(path: path, editor: editor) }
    // Run and share belong to the agent view; Code and Git have their own tools.
    if ready, (model.sessionPanel ?? .agents) == .agents {
      RunControl(session: session, inCard: true)
      HuddleToolbarButton(sessionId: session.id, inCard: true)
        .buttonStyle(ContextRowButtonStyle())
      if let agent = model.agentInFront {
        McpContextRow(agentId: agent.agentId)
        if AppPreferences.shared.showUsageLimitsInDetails { UsageLimitsContextRows(runner: agent.runnerId) }
      }
    }
    // No branch to show or push in a scratch pad's or a run's folder.
    if !session.isOutsideProjects {
      ContextCardDivider()
      if let issue = session.linkedIssue { linkedIssueRow(issue) }
      ForEach(session.designRefs ?? [], id: \.url) { designRow($0) }
      branchRow
      if ready, (git?.behind ?? 0) > 0 || pulling { pullRow }
      if ready { pushRow }
      // Merged, the session's work is done: offer to clean it up instead.
      if store.mergedSessionIds.contains(session.id) {
        deleteRow
      } else if let pr = session.pullRequest, pr.isOpen {
        // An open PR is where the branch lands, so it replaces merging locally.
        pullRequestRow(pr)
      } else if ready, session.kind == .worktree, session.baseBranch != nil {
        mergeRow
      }
      if ready, session.kind == .worktree, session.compareGroup == nil, !store.mergedSessionIds.contains(session.id) {
        StackContextRows(session: session)
      }
      if ready { changesRow }
    }
    ContextCardDivider()
    chatsRow
  }

  // MARK: Switcher

  /// Agent, Code and Git (⌘1–⌘3), and the chevron that folds the card down to them.
  private var switcher: some View {
    ContextCardSegments(
      segments: SessionPanel.allCases.enumerated().map { index, panel in
        ContextCardSegment(id: panel, title: panel.title, symbol: panel.symbol, help: "\(panel.title) (⌘\(index + 1))")
      },
      selection: model.sessionPanel ?? panel
    ) { picked in
      model.show(picked, via: .card)
    } trailing: {
      Button {
        if roomToOpen { savedCollapsed.toggle() } else { peeking.toggle() }
        MacTelemetry.capture(.contextCardUsed(action: collapsed ? .collapse : .expand))
      } label: {
        Label(collapsed ? "Show Session Details" : "Hide Session Details", systemImage: collapsed ? "chevron.down" : "chevron.up")
      }
      .buttonStyle(FlatIconButtonStyle(size: 22))
      .help(collapsed ? "Show session details" : "Hide session details")
    }
  }

  // MARK: Chats

  private var chatsRow: some View {
    Button {
      showingChats = true
      MacTelemetry.capture(.contextCardUsed(action: .recentChats))
    } label: {
      ContextCardRow(icon: Icon.history, title: "Recent Chats", muted: chatCount == 0) {
        if let chatCount, chatCount > 0 {
          Text("\(chatCount)").font(.scaled(size: 11).monospacedDigit()).foregroundStyle(theme.textSecondary)
        }
      }
    }
    .buttonStyle(ContextRowButtonStyle())
    .help("Search, read and resume this session's past chats")
  }

  private func loadChatCount() async {
    if let entries = await store.chatHistory(for: session) { chatCount = entries.count }
  }

  // MARK: Machine and editor

  private var machineRow: some View {
    ContextSplitRow {
      reveal()
    } row: {
      ContextCardRow(icon: isLocal ? "laptopcomputer" : Icon.desktop, title: hosts.label(hostId)) {
        if !isLocal { StatusDot(tone: hosts.state(hostId).tone) }
      }
    } menu: {
      if isLocal, path != nil {
        ChromeMenuItem("Reveal in Finder", icon: AppIcons.finder) { reveal() }
      }
      if path != nil {
        ChromeMenuItem("Copy Path", icon: .symbol(Icon.copy)) { copyPath() }
      }
    }
    .help(path.map { isLocal ? "Reveal \(Self.tilde($0)) in Finder" : "\(Self.tilde($0)) on \(hosts.label(hostId))" } ?? "")
  }

  private func editorRow(path: String, editor: EditorChoice) -> some View {
    ContextSplitRow {
      open(editor, path: path)
    } row: {
      ContextCardRow(icon: editor.icon, title: "Open in \(editor.name)")
    } menu: {
      for choice in editorChoices {
        ChromeMenuItem(choice.name, icon: choice.icon) { open(choice, path: path) }
      }
    }
  }

  // MARK: Git

  /// The Linear issue the session was started from; opens it on the Issues screen.
  private func linkedIssueRow(_ issue: RemoteLinkedIssue) -> some View {
    ContextSplitRow {
      MacTelemetry.capture(.contextCardUsed(action: .linkedIssue))
      model.navigate(.issues(issue: issue.identifier))
    } row: {
      ContextCardRow(icon: Icon.issue, title: "\(issue.identifier) \(issue.title)")
    } menu: {
      if let url = URL(string: issue.url) {
        ChromeMenuItem("Open in Linear", icon: .symbol(Icon.openExternal)) { openURL(url) }
      }
      ChromeMenuItem("Copy Issue ID", icon: .symbol(Icon.copy)) { Clipboard.copy(issue.identifier) }
    }
    .help("Open \(issue.identifier)")
  }

  /// A Figma frame the session's work should match; opens it in the design viewer.
  private func designRow(_ design: RemoteDesignRef) -> some View {
    ContextSplitRow {
      MacTelemetry.capture(.contextCardUsed(action: .design))
      model.navigate(.design(url: design.url, sessionId: session.id))
    } row: {
      ContextCardRow(icon: Icon.design, title: design.name)
    } menu: {
      if let url = URL(string: design.url) {
        ChromeMenuItem("Open in Figma", icon: .symbol(Icon.openExternal)) { openURL(url) }
      }
      ChromeMenuItem("Copy Link", icon: .symbol(Icon.copy)) { Clipboard.copy(design.url) }
    }
    .help("Open the \(design.name) design")
  }

  private var branchRow: some View {
    ContextSplitRow {
      MacTelemetry.capture(.contextCardUsed(action: .branch))
      model.navigate(.sessionGit(id: session.id, view: session.kind == .worktree ? .branch : .history))
    } row: {
      ContextCardRow(icon: Icon.branch, title: git?.branch ?? session.branch)
    } menu: {
      ChromeMenuItem("Show Branch History", icon: .symbol(Icon.history)) {
        model.navigate(.sessionGit(id: session.id, view: .branches(git?.branch ?? session.branch)))
      }
      if session.kind == .worktree {
        ChromeMenuItem("Rename Branch…", icon: .symbol(Icon.pencil)) { renamingBranch = true }
      }
      ChromeMenuItem("Copy Branch Name", icon: .symbol(Icon.copy)) { Clipboard.copy(git?.branch ?? session.branch) }
      if localBranches.count > 1 {
        ChromeMenuEntry.header("Switch Branch")
        for branch in localBranches {
          ChromeMenuItem(branch, checked: branch == (git?.branch ?? session.branch)) {
            guard branch != (git?.branch ?? session.branch) else { return }
            MacTelemetry.capture(.contextCardUsed(action: .switchBranch))
            Task { await model.switchBranch(session, to: branch, theme: theme) }
          }
        }
      }
    }
    .help(session.baseBranch.map { "\(session.branch) from \($0)" } ?? session.branch)
  }

  private var pullRow: some View {
    let behind = git?.behind ?? 0
    return Button {
      pull()
    } label: {
      ContextCardRow(icon: "icloud.and.arrow.down", title: pulling ? "Pulling…" : "Pull") {
        if behind > 0 {
          Text("↓\(behind)").font(.scaled(size: 11).monospacedDigit()).foregroundStyle(theme.textSecondary)
        }
      }
    }
    .buttonStyle(ContextRowButtonStyle())
    .disabled(pulling)
    .help("Pull \(behind) commit\(behind == 1 ? "" : "s") from \(git?.upstream ?? "upstream")")
  }

  @ViewBuilder private var pushRow: some View {
    let ahead = Int(git?.ahead ?? 0)
    Button {
      push()
    } label: {
      ContextCardRow(icon: "icloud.and.arrow.up", title: pushing ? "Pushing…" : "Push", muted: ahead == 0) {
        if ahead > 0 {
          Text("↑\(ahead)").font(.scaled(size: 11).monospacedDigit()).foregroundStyle(theme.textSecondary)
        }
      }
    }
    .buttonStyle(ContextRowButtonStyle())
    .disabled(pushing)
    .help(git?.upstream.map { ahead > 0 ? "Push \(ahead) commit\(ahead == 1 ? "" : "s") to \($0)" : "Up to date with \($0)" }
      ?? "Publish the branch")
    if let pullRequestURL = pullRequestURLs[session.id] {
      Button {
        NSWorkspace.shared.open(pullRequestURL)
        pullRequestURLs[session.id] = nil
      } label: {
        ContextCardRow(icon: "arrow.triangle.pull", title: "Create Pull Request")
      }
      .buttonStyle(ContextRowButtonStyle())
    }
  }

  private var mergeRow: some View {
    let base = session.baseBranch ?? "base"
    return Button {
      Task { await merge(into: base) }
    } label: {
      ContextCardRow(icon: Icon.merge, title: merging ? "Merging…" : "Merge into \(base)", muted: !mergeBlockers.isEmpty)
    }
    .buttonStyle(ContextRowButtonStyle())
    .disabled(merging || !mergeBlockers.isEmpty)
    .help(mergeBlockers.isEmpty ? "Merge this branch into \(base)" : mergeBlockers.joined(separator: "\n"))
  }

  private var deleteRow: some View {
    Button {
      MacTelemetry.capture(.contextCardUsed(action: .deleteSession))
      model.deletingSession = session
    } label: {
      ContextCardRow(icon: Icon.trash, title: "Delete Session…")
    }
    .buttonStyle(ContextRowButtonStyle())
    .help("Merged into \(session.baseBranch ?? "base"). Delete the session and its worktree")
  }

  private func pullRequestRow(_ pr: RemoteSessionPullRequest) -> some View {
    ContextSplitRow {
      MacTelemetry.capture(.contextCardUsed(action: .pullRequest))
      if let url = URL(string: pr.url) { openURL(url) }
    } row: {
      ContextCardRow(icon: Icon.pullRequest, title: (PullRequestLabels.isGitLab(pr.url) ? "Merge Request " : "Pull Request ") + PullRequestLabels.ref(number: pr.number, url: pr.url)) {
        if pr.state == .draft {
          Text("Draft").font(.scaled(size: 11)).foregroundStyle(theme.textSecondary)
        }
      }
    } menu: {
      if let remote = model.sessionPullRequest(session) {
        ChromeMenuItem("Show in Argus", icon: .symbol(Icon.pullRequest)) {
          MacTelemetry.capture(.contextCardUsed(action: .pullRequest))
          model.navigate(.pullRequest(repo: remote.repo, number: remote.number))
        }
      }
      ChromeMenuItem("Copy Link", icon: .symbol(Icon.copy)) { Clipboard.copy(pr.url) }
    }
    .help("\(PullRequestLabels.openOn(pr.url)): \(PullRequestLabels.ref(number: pr.number, url: pr.url))")
  }

  private var changesRow: some View {
    Button {
      MacTelemetry.capture(.contextCardUsed(action: .changes))
      model.navigate(.sessionGit(id: session.id, view: .working))
    } label: {
      ContextCardRow(icon: Icon.file, title: "Changes") {
        if let additions = git?.diffAdditions, let deletions = git?.diffDeletions,
          ChangeCounts.hasChanges(additions: Int(additions), deletions: Int(deletions))
        {
          ChangeCounts(additions: Int(additions), deletions: Int(deletions))
        } else if let dirty = git?.dirtyCount, dirty > 0 {
          Text("\(Int(dirty))").font(.scaled(size: 11).monospacedDigit()).foregroundStyle(theme.textSecondary)
        }
      }
    }
    .buttonStyle(ContextRowButtonStyle())
    .help("Show the working copy")
  }

  // MARK: Actions

  private func push() {
    MacTelemetry.capture(.contextCardUsed(action: .push))
    let id = session.id
    pushingIds.insert(id)
    Task {
      let result = await store.push(sessionId: id)
      pushingIds.remove(id)
      pullRequestURLs[id] = result?.pr_url.flatMap(URL.init(string:))
    }
  }

  /// Fast-forwards when there's nothing local; otherwise rebases the unpushed commits onto upstream.
  private func pull() {
    MacTelemetry.capture(.contextCardUsed(action: .pull))
    let id = session.id
    pullingIds.insert(id)
    let strategy: HostStore.PullStrategy = (git?.ahead ?? 0) > 0 ? .rebase : .ffOnly
    Task {
      _ = await store.pullCurrent(sessionId: id, strategy: strategy)
      pullingIds.remove(id)
    }
  }

  /// Squashing rewrites the commits the agent wrote, so it's asked rather than assumed.
  private func merge(into base: String) async {
    guard
      let choice = await GitDialogs.choose(
        "Merge into \(base)?", message: "Uncommitted changes are committed first. A conflict stops the merge.",
        buttons: [HostStore.MergeStrategy.keep.label, HostStore.MergeStrategy.squash.label])
    else { return }
    MacTelemetry.capture(.contextCardUsed(action: .merge))
    let id = session.id
    mergingIds.insert(id)
    defer { mergingIds.remove(id) }
    _ = await store.mergeIntoBase(sessionId: id, strategy: choice == 0 ? .keep : .squash)
    await store.loadGitStatus(sessionId: id)
    let blockers = await store.mergeBlockers(sessionId: id)
    if id == session.id { mergeBlockers = blockers }
  }

  private func reveal() {
    guard let path else { return }
    if !isLocal { return copyPath() }
    MacTelemetry.capture(.contextCardUsed(action: .reveal))
    guard let backend = store.backend else { return }
    Task { _ = try? await backend.request(ArgusProtocol.Commands.RevealInFinder.self, .init(path: path)) }
  }

  private func copyPath() {
    guard let path else { return }
    MacTelemetry.capture(.contextCardUsed(action: .copyPath))
    Clipboard.copy(path)
  }

  private func open(_ editor: EditorChoice, path: String) {
    MacTelemetry.capture(.contextCardUsed(action: .openEditor))
    lastEditor = editor.id
    guard let backend = store.backend else { return }
    switch editor.kind {
    case .builtIn(let id):
      Task { _ = try? await backend.request(ArgusProtocol.Commands.OpenInEditor.self, .init(editorId: id, path: path)) }
    case .custom(let command):
      Task {
        _ = try? await backend.request(ArgusProtocol.Commands.OpenInCustomEditor.self, .init(command: command, path: path))
      }
    }
  }

  private func loadPaths() async {
    guard let backend = store.backend else { return }
    path = (try? await backend.request(ArgusProtocol.Commands.GetSession.self, .init(id: session.id)))??.path
    guard isLocal, editors.isEmpty else { return }
    editors = (try? await backend.request(ArgusProtocol.Commands.ListEditors.self, EmptyParams()))?
      .filter { $0.available && !["iterm", "terminal"].contains($0.id) } ?? []
  }

  // MARK: Editors

  struct EditorChoice: Identifiable {
    enum Kind {
      case builtIn(String)
      case custom(command: String)
    }
    let id: String
    let name: String
    let kind: Kind

    @MainActor var icon: ChromeIcon {
      switch kind {
      case .builtIn(let id): AppIcons.icon(editorId: id)
      case .custom: .symbol(Icon.openExternal)
      }
    }
  }

  private var editorChoices: [EditorChoice] {
    editors.map { EditorChoice(id: $0.id, name: $0.name, kind: .builtIn($0.id)) }
      + AppPreferences.shared.customEditors.map {
        EditorChoice(id: "custom:\($0.name)", name: $0.name, kind: .custom(command: $0.command))
      }
  }

  /// The editor last opened from a card, else the first one found.
  private var preferredEditor: EditorChoice? {
    editorChoices.first { $0.id == lastEditor } ?? editorChoices.first
  }

  static func tilde(_ path: String) -> String {
    let home = NSHomeDirectory()
    return path.hasPrefix(home) ? "~" + path.dropFirst(home.count) : path
  }
}

/// The context card at the top right of a session panel. Collapsed it sits
/// in the panel's top bar, which keeps `barReserve` clear for it; expanded it
/// hangs down over the panel from there.
struct SessionContextCardOverlay: ViewModifier {
  let session: RemoteSession?
  let panel: SessionPanel
  /// The top bar's height, to centre the collapsed card in it.
  var barHeight: CGFloat = ContextCardMetrics.collapsedHeight
  var roomToOpen = true

  static let margin: CGFloat = 8
  /// Narrower than this and the reading column couldn't step clear of the card.
  static let minWidth: CGFloat = 760
  /// What the reading column keeps clear of: the card, its margin and a gap.
  static var reserve: CGFloat { ContextCardMetrics.width + margin + 16 }
  /// What a panel's top bar leaves free at its trailing end for the card.
  static var barReserve: CGFloat { ContextCardMetrics.width + margin * 2 }

  func body(content: Content) -> some View {
    content.overlay(alignment: .topTrailing) {
      if let session {
        SessionContextCard(session: session, panel: panel, roomToOpen: roomToOpen)
          .padding(.top, max(0, (barHeight - ContextCardMetrics.collapsedHeight) / 2))
          .padding(.trailing, Self.margin)
      }
    }
  }
}

extension View {
  func sessionContextCard(
    _ session: RemoteSession?, panel: SessionPanel, barHeight: CGFloat? = nil, roomToOpen: Bool = true
  ) -> some View {
    modifier(
      SessionContextCardOverlay(
        session: session, panel: panel, barHeight: barHeight ?? ContextCardMetrics.collapsedHeight,
        roomToOpen: roomToOpen))
  }
}
