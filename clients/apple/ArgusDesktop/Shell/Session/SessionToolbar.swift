import ArgusCore
import ArgusUI
import SwiftUI

/// A session's toolbar: where you are on the left ("Project / Session"), the
/// side panel toggle on the right. The panels switch from the context card.
struct SessionToolbar: ToolbarContent {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let session: RemoteSession?
  let sessionId: String
  /// The card carries the run command and huddle; folded, they sit here.
  let cardCollapsed: Bool

  var body: some ToolbarContent {
    ToolbarItem(placement: .navigation) {
      SessionBreadcrumb(session: session, sessionId: sessionId)
        .frame(maxWidth: max(160, model.toolbarLayout.detailWidth * 0.45), alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { model.toolbarLayout.leadingWidth = $0 }
    }
    .flatToolbarItem()
    // The split view's detail toolbar packs items after the breadcrumb; the
    // spacer pushes the rest to the window's trailing edge.
    if #available(macOS 26.0, *) {
      ToolbarSpacer(.flexible)
    }
    if let session, session.status == .ready, cardCollapsed, (model.sessionPanel ?? .agents) == .agents {
      ToolbarItem {
        PillGroup {
          HuddleToolbarButton(sessionId: session.id)
          RunControl(session: session)
        }
        .environment(\.pillItemsInGlass, true)
        .measured(slot: 0, in: model.toolbarLayout)
      }
    }
    ToolbarItem {
      sidePanelToggle
        .measured(slot: 1, in: model.toolbarLayout)
    }
  }

  /// A native toggle, so the toolbar's glass draws its hover, press and on state.
  private var sidePanelToggle: some View {
    Toggle(
      isOn: Binding(get: { model.sidePanelVisible }, set: { _ in model.toggleSidePanel(via: .button) })
    ) {
      Label("Side Panel", systemImage: "rectangle.righthalf.inset.filled")
    }
    .toggleStyle(.button)
    .labelStyle(.iconOnly)
    .help(model.sidePanelVisible ? "Hide side panel (⌘J)" : "Show side panel (⌘J)")
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

private extension View {
  /// Reports a capsule's width, so the git panel's actions know what's left.
  func measured(slot: Int, in layout: ToolbarLayout) -> some View {
    onGeometryChange(for: CGFloat.self) { $0.size.width } action: { layout.sessionGroupWidths[slot] = $0 }
      .onDisappear { layout.sessionGroupWidths[slot] = nil }
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
        openRoot = { [model] in model.openAgents(session: root.id) }
      }
      steps.append(.init(id: 0, title: name, badge: name, badgeKey: session.repoRoot, help: session.repoRoot, action: openRoot))
    }
    let onAgents = model.sessionPanel == .agents
    steps.append(
      .init(
        id: 1, title: title, help: SessionView.subtitle(session).isEmpty ? title : "\(title) — \(session.branch)",
        action: onAgents ? nil : { [model] in model.openAgents(session: session.id) }))
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
