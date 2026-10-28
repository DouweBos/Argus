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
/// editor, its run command and huddle, its branch, pushing it, how much it has
/// changed, and its recent chats.
struct SessionContextCard: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL
  let session: RemoteSession
  let panel: SessionPanel
  @AppStorage private var collapsed: Bool
  @State private var path: String?
  @State private var editors: [ArgusProtocol.EditorDescriptor] = []
  @State private var pushing = false
  @State private var pullRequestURL: URL?
  @State private var renamingBranch = false
  @State private var showingChats = false
  @State private var chatCount: Int?
  @AppStorage("argus:contextCard.editor") private var lastEditor = ""

  init(session: RemoteSession, panel: SessionPanel) {
    self.session = session
    self.panel = panel
    _collapsed = AppStorage(wrappedValue: ContextCardPreference.collapsedByDefault(panel), ContextCardPreference.key(panel))
  }

  private var hostId: HostId { model.host(ofSession: session.id) }
  private var isLocal: Bool { hostId == Hosts.local }
  private var git: RemoteGitStatus? { store.gitStatusBySession[session.id] }
  private var ready: Bool { session.status == .ready && !session.isUnavailable }

  var body: some View {
    ContextCard(chrome: !collapsed) {
      switcher
      if !collapsed { details }
    }
    .sheet(isPresented: $renamingBranch) { RenameBranchSheet(session: session) }
    .sheet(isPresented: $showingChats) {
      RecentChatsSheet(session: session) { Task { await loadChatCount() } }
    }
    .task(id: "\(session.id):\(session.status.rawValue)") { await loadPaths() }
    .task(id: SessionChats.reloadKey(session, store: store)) { await loadChatCount() }
    .liveRefresh(enabled: !collapsed && ready && !session.isOutsideProjects, every: .seconds(10)) {
      await store.loadGitStatus(sessionId: session.id)
    }
  }

  @ViewBuilder private var details: some View {
    ContextCardDivider()
    machineRow
    if isLocal, let path, let editor = preferredEditor { editorRow(path: path, editor: editor) }
    // Run and share belong to the agent view; Code and Git have their own tools.
    if ready, (model.sessionPanel ?? .agents) == .agents {
      RunControl(session: session, inCard: true)
      HuddleToolbarButton(sessionId: session.id, inCard: true)
        .buttonStyle(ContextRowButtonStyle())
    }
    // No branch to show or push in a scratch pad's or a run's folder.
    if !session.isOutsideProjects {
      ContextCardDivider()
      if let issue = session.linkedIssue { linkedIssueRow(issue) }
      branchRow
      if ready { pushRow }
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
        collapsed.toggle()
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
    if let entries = await SessionChats.load(session, store: store) { chatCount = entries.count }
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

  /// The Linear issue the session was started from; opens it.
  private func linkedIssueRow(_ issue: RemoteLinkedIssue) -> some View {
    Button {
      guard let url = URL(string: issue.url) else { return }
      MacTelemetry.capture(.contextCardUsed(action: .linkedIssue))
      openURL(url)
    } label: {
      ContextCardRow(icon: Icon.issue, title: "\(issue.identifier) \(issue.title)") {
        Image(systemName: Icon.openExternal).font(.scaled(size: 10)).foregroundStyle(theme.textSecondary)
      }
    }
    .buttonStyle(ContextRowButtonStyle())
    .help("Open \(issue.identifier) in Linear")
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
    }
    .help(session.baseBranch.map { "\(session.branch) from \($0)" } ?? session.branch)
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
    if let pullRequestURL {
      Button {
        NSWorkspace.shared.open(pullRequestURL)
        self.pullRequestURL = nil
      } label: {
        ContextCardRow(icon: "arrow.triangle.pull", title: "Create Pull Request")
      }
      .buttonStyle(ContextRowButtonStyle())
    }
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
    pushing = true
    Task {
      let result = await store.push(sessionId: session.id)
      pushing = false
      pullRequestURL = result?.pr_url.flatMap(URL.init(string:))
    }
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
        SessionContextCard(session: session, panel: panel)
          .padding(.top, max(0, (barHeight - ContextCardMetrics.collapsedHeight) / 2))
          .padding(.trailing, Self.margin)
      }
    }
  }
}

extension View {
  func sessionContextCard(_ session: RemoteSession?, panel: SessionPanel, barHeight: CGFloat? = nil) -> some View {
    modifier(
      SessionContextCardOverlay(
        session: session, panel: panel, barHeight: barHeight ?? ContextCardMetrics.collapsedHeight))
  }
}
