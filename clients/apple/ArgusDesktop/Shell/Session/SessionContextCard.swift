import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// Whether sessions show their context card; the toolbar's details button flips it.
enum ContextCardPreference {
  static let key = "argus:contextCard.visible"
}

/// The session at a glance, floating at the top right of its panel: the
/// machine it's on, opening it in an editor, its run command and huddle, then
/// its branch, pushing it, and how much it has changed.
struct SessionContextCard: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(\.theme) private var theme
  let session: RemoteSession
  @State private var path: String?
  @State private var editors: [ArgusProtocol.EditorDescriptor] = []
  @State private var pushing = false
  @State private var pullRequestURL: URL?
  @State private var renamingBranch = false
  @AppStorage("argus:contextCard.editor") private var lastEditor = ""

  private var hostId: HostId { model.host(ofSession: session.id) }
  private var isLocal: Bool { hostId == Hosts.local }
  private var git: RemoteGitStatus? { store.gitStatusBySession[session.id] }
  private var ready: Bool { session.status == .ready && !session.isUnavailable }

  var body: some View {
    ContextCard {
      machineRow
      if isLocal, let path, let editor = preferredEditor { editorRow(path: path, editor: editor) }
      if ready {
        RunControl(session: session, inCard: true) { model.terminalPanelVisible = true }
        HuddleToolbarButton(sessionId: session.id, inCard: true)
          .buttonStyle(ContextRowButtonStyle())
      }
      if session.kind != .scratchPad {
        ContextCardDivider()
        branchRow
        if ready { pushRow }
        if ready { changesRow }
      }
    }
    .sheet(isPresented: $renamingBranch) { RenameBranchSheet(session: session) }
    .task(id: "\(session.id):\(session.status.rawValue)") { await loadPaths() }
    .liveRefresh(enabled: ready && session.kind != .scratchPad, every: .seconds(10)) {
      await store.loadGitStatus(sessionId: session.id)
    }
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
        Button("Reveal in Finder") { reveal() }
      }
      if path != nil {
        Button("Copy Path") { copyPath() }
      }
    }
    .help(path.map { isLocal ? "Reveal \(Self.tilde($0)) in Finder" : "\(Self.tilde($0)) on \(hosts.label(hostId))" } ?? "")
  }

  private func editorRow(path: String, editor: EditorChoice) -> some View {
    ContextSplitRow {
      open(editor, path: path)
    } row: {
      ContextCardRow(icon: Icon.openExternal, title: "Open in \(editor.name)")
    } menu: {
      ForEach(editorChoices) { choice in
        Button(choice.name) { open(choice, path: path) }
      }
    }
  }

  // MARK: Git

  private var branchRow: some View {
    ContextSplitRow {
      MacTelemetry.capture(.contextCardUsed(action: .branch))
      model.navigate(.sessionGit(id: session.id, view: session.kind == .worktree ? .branch : .history))
    } row: {
      ContextCardRow(icon: Icon.branch, title: git?.branch ?? session.branch)
    } menu: {
      Button("Show Branch History") {
        model.navigate(.sessionGit(id: session.id, view: .branches(git?.branch ?? session.branch)))
      }
      if session.kind == .worktree {
        Button("Rename Branch…") { renamingBranch = true }
      }
      Button("Copy Branch Name") { Clipboard.copy(git?.branch ?? session.branch) }
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
        if let additions = git?.diffAdditions, let deletions = git?.diffDeletions {
          ChangeCounts(additions: additions, deletions: deletions)
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

/// The context card over a session panel; nil shows none.
struct SessionContextCardOverlay: ViewModifier {
  let session: RemoteSession?

  /// Narrower than this and the reading column couldn't step clear of the card.
  static let minWidth: CGFloat = 760
  /// What the reading column keeps clear of: the card, its margin and a gap.
  @MainActor static var reserve: CGFloat { TextScale.shared(236) + 12 + 16 }

  func body(content: Content) -> some View {
    content.overlay(alignment: .topTrailing) {
      if let session {
        SessionContextCard(session: session)
          .padding(.top, 10)
          .padding(.trailing, 12)
      }
    }
  }
}

extension View {
  func sessionContextCard(_ session: RemoteSession?) -> some View {
    modifier(SessionContextCardOverlay(session: session))
  }
}
