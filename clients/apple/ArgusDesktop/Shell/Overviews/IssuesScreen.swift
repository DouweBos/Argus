import ArgusCore
import ArgusUI
import SwiftUI

/// `/issues[/<scope>][/<IDENTIFIER>]`: your open Linear issues as a board or
/// a list; the issue in the route opens as a full page, like Linear's, with
/// previous/next following the board or list.
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
  /// The board's hidden columns, so previous/next skips what the board hides.
  @AppStorage("issues.columns") private var columnsJSON = "{}"
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
    page
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .refreshingLinearIssues(model)
      .onChange(of: scope, initial: true) { model.scope = scope }
      .navigationTitle(issueRef ?? "Issues")
      .navigationSubtitle(issueRef == nil ? subtitle : scope.title)
      .toolbar { toolbar }
      .sheet(item: $starting) { issue in
        if let project {
          NewSessionSheet(project: project, issues: [issue]) { session in
            desktop.openAgents(session: session.id)
          }
        }
      }
  }

  @ViewBuilder private var page: some View {
    if let issueRef {
      IssuePage(
        ref: issueRef, scope: scope, position: LinearIssueActivity.position(of: issueRef, in: order),
        canStart: store.hasControl && project != nil,
        onChange: { model.replace($0) }, onStart: { starting = $0 }
      )
      .id(issueRef)
    } else {
      content.overlay { LinearIssuesPlaceholder(model: model, connectHint: Self.connectHint) }
    }
  }

  /// The identifiers as the board or list shows them, top to bottom.
  private var order: [String] {
    let issues = model.shownIssues ?? []
    switch layout {
    case .list:
      return LinearIssueBoard.listOrder(issues).map(\.identifier)
    case .board:
      let overrides = (try? JSONDecoder().decode([String: Bool].self, from: Data(columnsJSON.utf8))) ?? [:]
      let columns = LinearIssueBoard.columns(issues).filter { !LinearIssueBoard.isHidden($0, overrides: overrides) }
      return LinearIssueBoard.boardOrder(columns).map(\.identifier)
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
    if store.linearConnected, issueRef == nil {
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

  private var scopeSelection: Binding<ArgusProtocol.LinearIssueScope> {
    Binding(get: { scope }, set: { desktop.navigate(.issues(scope: $0)) })
  }

  private var projectSelection: Binding<String?> {
    Binding(get: { project?.repoRoot }, set: { pickedRoot = $0 })
  }
}

/// The issue as a full page: back to the list, previous/next, everything
/// about it, editable with control.
private struct IssuePage: View {
  @Environment(\.theme) private var theme
  @Environment(DesktopModel.self) private var desktop
  @Environment(HostStore.self) private var store
  @State private var model: LinearIssueDetailModel?
  let ref: String
  let scope: ArgusProtocol.LinearIssueScope
  let position: LinearIssueActivity.Position?
  let canStart: Bool
  let onChange: (HostStore.LinearIssue) -> Void
  let onStart: (HostStore.LinearIssue) -> Void

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Breadcrumb([
          .init(id: 0, title: "Issues", help: "Back to your issues") { desktop.navigate(.issues(scope: scope)) },
          .init(id: 1, title: model?.issue.map { "\($0.identifier)  \($0.title)" } ?? ref),
        ])
        Spacer(minLength: 0)
        Button("Back to issues") { desktop.navigate(.issues(scope: scope)) }
          .keyboardShortcut(.cancelAction)
          .opacity(0)
          .frame(width: 0, height: 0)
          .accessibilityHidden(true)
      }
      .padding(.horizontal, 16)
      .frame(height: 36)
      Divider().overlay(theme.borderSubtle)
      if let model {
        LinearIssueDetailView(
          model: model, canEdit: store.hasControl, canStart: canStart, position: position,
          onOpenSession: { desktop.open(session: $0.id) }, onStart: onStart,
          onOpenIssue: { desktop.navigate(.issues(scope: scope, issue: $0)) },
          onOpenDesign: { desktop.navigate(.design(url: $0)) })
      }
    }
    .task(id: ref) {
      if model == nil { model = LinearIssueDetailModel(ref: ref, host: store, onChange: onChange) }
    }
    .liveRefresh(enabled: store.connection == .ready, every: .seconds(120)) { await model?.load() }
  }
}
