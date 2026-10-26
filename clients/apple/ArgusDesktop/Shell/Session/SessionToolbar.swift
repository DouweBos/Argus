import ArgusCore
import ArgusUI
import SwiftUI

/// A session's toolbar: where you are on the left ("Project / Session"), the
/// panels and the panel toggles as plain icons on the right.
struct SessionToolbar: ToolbarContent {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @AppStorage(ContextCardPreference.key) private var cardPreferred = true
  let session: RemoteSession?
  let sessionId: String
  /// The card carries the run command and huddle; without it they sit here.
  let cardShown: Bool

  var body: some ToolbarContent {
    ToolbarItem(placement: .navigation) {
      SessionBreadcrumb(session: session, sessionId: sessionId)
        .frame(maxWidth: max(160, model.toolbarLayout.detailWidth * 0.45), alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { model.toolbarLayout.leadingWidth = $0 }
    }
    .flatToolbarItem()
    ToolbarItem {
      HStack(spacing: 2) {
        if let session, session.status == .ready, !cardShown {
          HuddleToolbarButton(sessionId: session.id).buttonStyle(FlatIconButtonStyle())
          RunControl(session: session) { model.terminalPanelVisible = true }
            .buttonStyle(FlatIconButtonStyle())
          ToolbarSeparator()
        }
        panelSwitcher
        ToolbarSeparator()
        panelToggles
      }
      .labelStyle(.iconOnly)
      .fixedSize()
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { model.toolbarLayout.sessionToolsWidth = $0 }
    }
    .flatToolbarItem()
  }

  /// Home, Agents, Code and Git (⌘1–⌘4), the one on screen lit.
  private var panelSwitcher: some View {
    ForEach(Array(SessionPanel.allCases.enumerated()), id: \.element) { index, panel in
      Button {
        model.show(panel, via: .toolbar)
      } label: {
        Label(panel.title, systemImage: panel.symbol)
      }
      .buttonStyle(FlatIconButtonStyle(selected: model.sessionPanel == panel))
      .overlay(alignment: .topTrailing) {
        if panel == .git, let count = gitChangeCount, count > 0 { PillBadge(count).scaleEffect(0.8) }
      }
      .help("\(panel.title) (⌘\(index + 1))")
    }
  }

  @ViewBuilder private var panelToggles: some View {
    Button {
      cardPreferred.toggle()
      MacTelemetry.capture(.contextCardUsed(action: cardPreferred ? .show : .hide))
    } label: {
      Label("Session Details", systemImage: "list.bullet.rectangle")
    }
    .buttonStyle(FlatIconButtonStyle(selected: cardPreferred))
    .disabled(model.sessionPanel != .home && model.sessionPanel != .agents)
    .help(cardPreferred ? "Hide session details" : "Show session details")
    Button {
      model.terminalPanelVisible.toggle()
    } label: {
      Label("Terminal", systemImage: "rectangle.bottomthird.inset.filled")
    }
    .buttonStyle(FlatIconButtonStyle(selected: model.terminalPanelVisible))
    .disabled(session?.status != .ready)
    .help(model.terminalPanelVisible ? "Hide terminal (⇧⌘T)" : "Show terminal (⇧⌘T)")
    Button {
      model.toggleRuntimePanel(via: .button)
    } label: {
      Label("Device Panel", systemImage: "rectangle.righthalf.inset.filled")
    }
    .buttonStyle(FlatIconButtonStyle(selected: model.runtimePanelVisible))
    .help(model.runtimePanelVisible ? "Hide device panel (⌥⌘B)" : "Show device panel (⌥⌘B)")
  }

  /// The open repository's changed files, badged on the Git panel.
  private var gitChangeCount: Int? {
    model.git.workspace(sessionId)?.workingCopy.changedCount
  }
}

extension ToolbarContent {
  /// No glass capsule behind the item: the chrome stays flat, the icons plain.
  @ToolbarContentBuilder func flatToolbarItem() -> some ToolbarContent {
    if #available(macOS 26.0, *) {
      sharedBackgroundVisibility(.hidden)
    } else {
      self
    }
  }
}

/// A hairline between toolbar icon groups.
private struct ToolbarSeparator: View {
  @Environment(\.theme) private var theme

  var body: some View {
    Rectangle().fill(theme.border).frame(width: 1, height: 14).padding(.horizontal, 4)
  }
}

/// "Project / Session", and the agent when one is in front with a name of its own.
struct SessionBreadcrumb: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let session: RemoteSession?
  let sessionId: String

  var body: some View {
    Breadcrumb(steps)
  }

  private var steps: [Breadcrumb.Step] {
    guard let session else { return [.init(id: 0, title: "Session")] }
    let title = SessionView.title(session)
    var steps: [Breadcrumb.Step] = []
    if session.kind == .scratchPad {
      steps.append(.init(id: 0, title: "Scratch pad"))
    } else {
      let project = store.projects.first { $0.repoRoot == session.repoRoot }
      let name = project?.name ?? URL(fileURLWithPath: session.repoRoot).lastPathComponent
      let root = store.sessionsByRepo[session.repoRoot]?.first { $0.kind == .projectRoot }
      var openRoot: (() -> Void)?
      if let root, root.id != session.id {
        openRoot = { [model] in model.navigate(.sessionHome(id: root.id)) }
      }
      steps.append(.init(id: 0, title: name, badge: name, help: session.repoRoot, action: openRoot))
    }
    let onAgents = model.sessionPanel == .agents
    steps.append(
      .init(
        id: 1, title: title, help: SessionView.subtitle(session).isEmpty ? title : "\(title) — \(session.branch)",
        action: model.sessionPanel == .home ? nil : { [model] in model.navigate(.sessionHome(id: session.id)) }))
    if onAgents, let agent = agentInFront, let agentTitle = agent.title, !agentTitle.isEmpty, agentTitle != title {
      steps.append(.init(id: 2, title: agentTitle))
    }
    return steps
  }

  private var agentInFront: RemoteAgentStatus? {
    let agents = model.agents(inSession: sessionId)
    let id = model.focusedAgentId(inSession: sessionId, agents: agents)
    return agents.first { $0.agentId == id }
  }
}
