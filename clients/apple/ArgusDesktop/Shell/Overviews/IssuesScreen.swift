import ArgusCore
import ArgusUI
import SwiftUI

/// `/issues[/<scope>][/<IDENTIFIER>]`: your open Linear issues as a board or
/// a list, with the issue in the route open in the inspector — the desktop's
/// Issues screen.
struct IssuesScreen: View {
  @Environment(HostStore.self) private var store
  let scope: ArgusProtocol.LinearIssueScope
  let issueRef: String?

  var body: some View {
    IssuesScreenContent(model: LinearIssuesModel(host: store), scope: scope, issueRef: issueRef)
  }
}

private struct IssuesScreenContent: View {
  enum Layout: String { case board, list }

  @Environment(DesktopModel.self) private var desktop
  @Environment(HostStore.self) private var store
  @AppStorage("issues.layout") private var layout = Layout.board
  @State private var model: LinearIssuesModel
  @State private var pickedRoot: String?
  @State private var starting: HostStore.LinearIssue?
  let scope: ArgusProtocol.LinearIssueScope
  let issueRef: String?

  init(model: LinearIssuesModel, scope: ArgusProtocol.LinearIssueScope, issueRef: String?) {
    model.scope = scope
    _model = State(initialValue: model)
    self.scope = scope
    self.issueRef = issueRef
  }

  private var project: RemoteProject? {
    store.projects.first { $0.repoRoot == pickedRoot } ?? store.projects.first
  }

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .overlay { LinearIssuesPlaceholder(model: model, connectHint: Self.connectHint) }
      .refreshingLinearIssues(model)
      .onChange(of: scope, initial: true) { model.scope = scope }
      .navigationTitle("Issues")
      .navigationSubtitle(subtitle)
      .toolbar { toolbar }
      .inspector(isPresented: inspectorShown) {
        if let issueRef {
          IssueInspector(
            ref: issueRef, canStart: store.hasControl && project != nil,
            onChange: { model.replace($0) }, onStart: { starting = $0 },
            onClose: { desktop.navigate(.issues(scope: scope)) }
          )
          .id(issueRef)
          .inspectorColumnWidth(min: 340, ideal: 440, max: 640)
        }
      }
      .sheet(item: $starting) { issue in
        if let project {
          NewSessionSheet(project: project, issues: [issue]) { session in
            desktop.openAgents(session: session.id)
          }
        }
      }
  }

  private static let connectHint = "Connect Linear in Settings → Integrations to see your issues."

  private var content: some View {
    issues
      .safeAreaInset(edge: .top, spacing: 0) {
        if store.linearConnected, let issues = model.issues, !issues.isEmpty {
          IssueFilterBar(issues: issues, filters: $model.filters)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
      }
  }

  @ViewBuilder private var issues: some View {
    switch layout {
    case .board:
      IssuesBoard(issues: model.shownIssues ?? [], selected: issueRef, onOpen: open)
    case .list:
      LinearIssuesList(model: model, connectHint: Self.connectHint, selected: issueRef, onOpen: open)
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if store.linearConnected {
      ToolbarItemGroup {
        Picker("Issues", selection: scopeSelection) {
          ForEach(ArgusProtocol.LinearIssueScope.all) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .fixedSize()
        .help("Whose issues to show")
        Picker("Layout", selection: $layout) {
          Label("Board", systemImage: "rectangle.split.3x1").tag(Layout.board)
          Label("List", systemImage: "list.bullet").tag(Layout.list)
        }
        .pickerStyle(.segmented)
        .labelStyle(.iconOnly)
        .fixedSize()
        .help("Show issues as a board or a list")
        if store.projects.count > 1 {
          Picker("Start in", selection: projectSelection) {
            ForEach(store.projects) { Text("Start in \($0.name)").tag(String?.some($0.repoRoot)) }
          }
          .fixedSize()
          .help("The project new agents start in")
        }
        Button {
          Task { await model.refresh() }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .disabled(model.refreshing)
        .help("Ask Linear again")
      }
    }
  }

  private var subtitle: String {
    guard let issues = model.issues else { return "Open issues in Linear" }
    let shown = model.shownIssues?.count ?? issues.count
    let count = shown == issues.count ? "\(issues.count)" : "\(shown) of \(issues.count)"
    return "\(count) open · \(scope.title.lowercased())"
  }

  /// One navigation per click: the issue's own URL.
  private func open(_ issue: HostStore.LinearIssue) {
    desktop.navigate(.issues(scope: scope, issue: issue.identifier))
  }

  private var inspectorShown: Binding<Bool> {
    Binding(
      get: { issueRef != nil },
      set: { if !$0, issueRef != nil { desktop.navigate(.issues(scope: scope)) } })
  }

  private var scopeSelection: Binding<ArgusProtocol.LinearIssueScope> {
    Binding(get: { scope }, set: { desktop.navigate(.issues(scope: $0)) })
  }

  private var projectSelection: Binding<String?> {
    Binding(get: { project?.repoRoot }, set: { pickedRoot = $0 })
  }
}

/// The issue open beside the board: everything about it, editable with control.
private struct IssueInspector: View {
  @Environment(DesktopModel.self) private var desktop
  @Environment(HostStore.self) private var store
  @State private var model: LinearIssueDetailModel?
  let ref: String
  let canStart: Bool
  let onChange: (HostStore.LinearIssue) -> Void
  let onStart: (HostStore.LinearIssue) -> Void
  let onClose: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Spacer()
        Button(action: onClose) {
          Image(systemName: Icon.close).font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.argusBorderless)
        .help("Close the issue")
        .keyboardShortcut(.cancelAction)
      }
      .padding(.horizontal, 12)
      .padding(.top, 8)
      if let model {
        LinearIssueDetailView(
          model: model, canEdit: store.hasControl, canStart: canStart,
          onOpenSession: { desktop.open(session: $0.id) }, onStart: onStart,
          onOpenDesign: { desktop.navigate(.design(url: $0)) })
      }
    }
    .task(id: ref) {
      if model == nil { model = LinearIssueDetailModel(ref: ref, host: store, onChange: onChange) }
    }
    .liveRefresh(enabled: store.connection == .ready, every: .seconds(120)) { await model?.load() }
  }
}
