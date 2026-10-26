import ArgusCore
import ArgusUI
import SwiftUI

/// What the sidebar list is narrowed to: a search, and one project. The
/// project pick is kept per Argus home; the search is for the moment.
@MainActor @Observable
final class SidebarFilter {
  private static let key = "sidebar.projectFilter"

  var search = "" {
    didSet {
      if oldValue.isEmpty, !search.isEmpty { MacTelemetry.capture(.sidebarFiltered(kind: .search)) }
    }
  }

  var project: String? {
    didSet { HomeDefaults.shared.set(project, forKey: Self.key) }
  }

  init() {
    project = HomeDefaults.shared.string(forKey: Self.key)
  }

  var query: String { search.trimmingCharacters(in: .whitespaces) }
  var isSearching: Bool { !query.isEmpty }
  var isActive: Bool { isSearching || project != nil }

  func matches(_ text: String) -> Bool {
    text.localizedCaseInsensitiveContains(query)
  }
}

/// The top of the sidebar: search, then project filter, add project and new session.
struct SidebarTopBar: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  @Bindable var filter: SidebarFilter
  let showsHosts: Bool

  var body: some View {
    HStack(spacing: 2) {
      ChromeSearchField(text: $filter.search)
      if showsHosts { MachinesMenu() }
      projectFilter
      addProject
      newSession
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 6)
    // A project that's gone leaves nothing to narrow to.
    .onChange(of: store.projects.map(\.repoRoot)) { _, roots in
      if let project = filter.project, store.projectsLoaded, !roots.contains(project) { filter.project = nil }
    }
  }

  private var projectFilter: some View {
    Menu {
      Button {
        pick(nil)
      } label: {
        checked(filter.project == nil, "All Projects")
      }
      Divider()
      ForEach(store.projects) { project in
        Button {
          pick(project.repoRoot)
        } label: {
          checked(filter.project == project.repoRoot, project.name)
        }
      }
      if let repo = filter.project {
        Divider()
        Button("Project Settings…") { model.projectSettingsRepo = repo }
      }
    } label: {
      Label(
        "Filter by Project",
        systemImage: filter.project == nil
          ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
    }
    .modifier(SidebarMenuStyle(selected: filter.project != nil))
    .help(filter.project.flatMap { root in store.projects.first { $0.repoRoot == root }?.name }
      .map { "Showing \($0) only" } ?? "Filter by project")
  }

  private var addProject: some View {
    Menu {
      Button("Add Project…") { model.addingProject = true }
      Button("Import Projects from Claude Code…") { model.importingCliProjects = true }
    } label: {
      Label("Add Project", systemImage: "folder.badge.plus")
    }
    .modifier(SidebarMenuStyle())
    .help("Add a project (⌘O)")
  }

  private var newSession: some View {
    Menu {
      ForEach(store.projects) { project in
        Button("New Session in \(project.name)…") { model.newSessionProject = project }
      }
      if !store.projects.isEmpty { Divider() }
      Button("New Scratch Pad") { Task { await model.newScratchPad() } }
    } label: {
      Label("New Session", systemImage: "square.and.pencil")
    } primaryAction: {
      if store.projects.isEmpty {
        Task { await model.newScratchPad() }
      } else {
        model.requestNewSession()
      }
    }
    .modifier(SidebarMenuStyle())
    .help("New session (⌘N) — hold for more")
  }

  private func pick(_ repoRoot: String?) {
    guard filter.project != repoRoot else { return }
    filter.project = repoRoot
    MacTelemetry.capture(.sidebarFiltered(kind: .project))
  }

  @ViewBuilder private func checked(_ on: Bool, _ title: String) -> some View {
    if on { Label(title, systemImage: Icon.check) } else { Text(title) }
  }
}

/// A menu drawn as a flat icon button.
struct SidebarMenuStyle: ViewModifier {
  var selected = false

  func body(content: Content) -> some View {
    content
      .menuStyle(.button)
      .menuIndicator(.hidden)
      .buttonStyle(FlatIconButtonStyle(selected: selected))
      .fixedSize()
  }
}
