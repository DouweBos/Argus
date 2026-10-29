import ArgusCore
import ArgusUI
import SwiftUI

/// `/issues[/<scope>][/<IDENTIFIER>]`: your open Linear issues as a board or
/// a list, or `/issues/search?q=` the whole workspace's matches; the issue in
/// the route opens as a full page, like Linear's, with previous/next following
/// the board or list.
struct IssuesScreen: View {
  @Environment(HostStore.self) private var store
  let scope: ArgusProtocol.LinearIssueScope
  let issueRef: String?
  let query: String?

  var body: some View {
    IssuesScreenContent(model: LinearIssuesModel(host: store), scope: scope, issueRef: issueRef, query: query)
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
  /// The field as typed; the route's `query` is what's searched, once typing settles.
  @State private var searchText: String
  @FocusState private var searchFocused: Bool
  let scope: ArgusProtocol.LinearIssueScope
  let issueRef: String?
  let query: String?

  init(model: LinearIssuesModel, scope: ArgusProtocol.LinearIssueScope, issueRef: String?, query: String?) {
    model.scope = scope
    model.query = query
    model.onSearched = { MacTelemetry.capture(.issueSearched(results: MacTelemetryEvent.countBucket($0))) }
    _model = State(initialValue: model)
    _searchText = State(initialValue: query ?? "")
    self.scope = scope
    self.issueRef = issueRef
    self.query = query
  }

  private var project: RemoteProject? {
    store.projects.first { $0.repoRoot == pickedRoot } ?? store.projects.first
  }

  var body: some View {
    page
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .refreshingLinearIssues(model)
      .onChange(of: scope, initial: true) { model.scope = scope }
      .onChange(of: query, initial: true) {
        model.query = query
        if LinearIssuesModel.term(searchText) != query { searchText = query ?? "" }
      }
      .task(id: searchText) { await search() }
      .navigationTitle(issueRef ?? "Issues")
      .navigationSubtitle(issueRef == nil ? subtitle : query.map { "Results for \u{201C}\($0)\u{201D}" } ?? scope.title)
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
        ref: issueRef, scope: scope, query: query, position: LinearIssueActivity.position(of: issueRef, in: order),
        canStart: store.hasControl && project != nil,
        onChange: { model.replace($0) }, onStart: { starting = $0 }
      )
      .id(issueRef)
    } else if store.linearConnected {
      content.overlay { LinearIssuesPlaceholder(model: model, connectHint: Self.connectHint) }
        .searchable(text: $searchText, placement: .toolbar, prompt: "Search all issues…")
        .searchFocused($searchFocused)
        .background { findShortcut }
    } else {
      content.overlay { LinearIssuesPlaceholder(model: model, connectHint: Self.connectHint) }
    }
  }

  /// ⌘F puts the cursor in the search field.
  private var findShortcut: some View {
    Button("Search Issues") { searchFocused = true }
      .keyboardShortcut("f", modifiers: .command)
      .opacity(0)
      .frame(width: 0, height: 0)
      .accessibilityHidden(true)
  }

  /// Once typing settles: a new term is one navigation, refining it replaces
  /// that step; clearing the field goes back to the scope at once.
  private func search() async {
    let term = LinearIssuesModel.term(searchText)
    guard term != query else { return }
    if term != nil {
      do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
    }
    desktop.navigate(.issues(scope: scope, query: term))
  }

  /// The identifiers as the board or list shows them, top to bottom.
  private var order: [String] {
    let issues = model.shownIssues ?? []
    switch layout {
    case .list:
      return LinearIssueBoard.listOrder(issues).map(\.identifier)
    case .board:
      let overrides = (try? JSONDecoder().decode([String: Bool].self, from: Data(columnsJSON.utf8))) ?? [:]
      let columns = LinearIssueBoard.columns(issues, states: model.workflowStates).filter { !LinearIssueBoard.isHidden($0, overrides: overrides) }
      return LinearIssueBoard.boardOrder(columns).map(\.identifier)
    }
  }

  private static let connectHint = "Connect Linear in Settings → Integrations to see your issues."

  private var content: some View {
    issues
      .safeAreaInset(edge: .top, spacing: 0) {
        if store.linearConnected, let issues = model.issues, !issues.isEmpty {
          IssueFilterBar(issues: issues, states: model.workflowStates, filters: $model.filters)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
      }
  }

  @ViewBuilder private var issues: some View {
    switch layout {
    case .board:
      IssuesBoard(issues: model.shownIssues ?? [], states: model.workflowStates, selected: issueRef, onOpen: open)
    case .list:
      LinearIssuesList(model: model, connectHint: Self.connectHint, selected: issueRef, onOpen: open)
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if store.linearConnected, issueRef == nil {
      ToolbarItemGroup {
        // No segment while searching: the results are the workspace's, not a scope's.
        Picker("Issues", selection: scopeSelection) {
          ForEach(ArgusProtocol.LinearIssueScope.all) { Text($0.title).tag(Optional($0)) }
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
    guard let issues = model.issues else { return query == nil ? "Open issues in Linear" : "Searching Linear" }
    let shown = model.shownIssues?.count ?? issues.count
    let count = shown == issues.count ? "\(issues.count)" : "\(shown) of \(issues.count)"
    if let query {
      return "\(count) \(issues.count == 1 ? "result" : "results") for \u{201C}\(query)\u{201D}"
    }
    return "\(count) open · \(scope.title.lowercased())"
  }

  /// One navigation per click: the issue's own URL, under the search when there is one.
  private func open(_ issue: HostStore.LinearIssue) {
    desktop.navigate(.issues(scope: scope, issue: issue.identifier, query: query))
  }

  private var scopeSelection: Binding<ArgusProtocol.LinearIssueScope?> {
    Binding(
      get: { query == nil ? scope : nil },
      set: { picked in picked.map { desktop.navigate(.issues(scope: $0)) } })
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
  let query: String?
  let position: LinearIssueActivity.Position?
  let canStart: Bool
  let onChange: (HostStore.LinearIssue) -> Void
  let onStart: (HostStore.LinearIssue) -> Void

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Breadcrumb([
          .init(id: 0, title: query == nil ? "Issues" : "Search", help: query == nil ? "Back to your issues" : "Back to the results") {
            desktop.navigate(.issues(scope: scope, query: query))
          },
          .init(id: 1, title: model?.issue.map { "\($0.identifier)  \($0.title)" } ?? ref),
        ])
        Spacer(minLength: 0)
        Button("Back to issues") { desktop.navigate(.issues(scope: scope, query: query)) }
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
          onOpenIssue: { desktop.navigate(.issues(scope: scope, issue: $0, query: query)) },
          onOpenDesign: { desktop.navigate(.design(url: $0)) },
          onPropertyMenu: { kind, byKey in
            MacTelemetry.capture(.issuePropertyMenuOpened(property: kind, via: byKey ? .shortcut : .click))
          })
      }
    }
    // Fill the window from the top, so the bar doesn't float mid-screen while loading.
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .task(id: ref) {
      if model == nil { model = LinearIssueDetailModel(ref: ref, host: store, onChange: onChange) }
    }
    .liveRefresh(enabled: store.connection == .ready, every: .seconds(120)) { await model?.load() }
  }
}
