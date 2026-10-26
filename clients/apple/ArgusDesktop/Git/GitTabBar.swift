import ArgusUI
import SwiftUI

/// The git panel's views as Grove's pill bar, with the rest in a More menu.
/// It sits atop the panel because the toolbar's centre holds the session switcher.
struct GitTabBar: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let view: GitRoute

  private var isProject: Bool { workspace.isProjectRoot }
  private var current: GitTab { GitTab(route: view) }

  var body: some View {
    // Titles while they fit, then icons only, as Grove's toolbar narrows.
    ViewThatFits(in: .horizontal) {
      bar(iconsOnly: false)
      bar(iconsOnly: true)
    }
    .frame(maxWidth: .infinity)
  }

  private func bar(iconsOnly: Bool) -> some View {
    PillTabBar(
      tabs: tabs.map {
        PillTab(
          id: $0, title: $0.title, symbol: $0.symbol,
          badge: $0 == .changes ? workspace.workingCopy.changedCount : nil,
          indicator: $0 == .conflicts && !workspace.workingCopy.conflictedFiles.isEmpty)
      },
      selection: current, compact: true, iconsOnly: iconsOnly, framed: true
    ) {
      pick($0, via: .tabs)
    } trailing: {
      moreMenu(iconsOnly: iconsOnly)
    }
    .fixedSize()
  }

  /// The primary tabs, Conflicts while an operation needs it, and whichever other view is open.
  private var tabs: [GitTab] {
    var tabs = GitTab.primary(isProject: isProject)
    if current == .conflicts || workspace.workingCopy.isInOperation || !workspace.workingCopy.conflictedFiles.isEmpty {
      tabs.append(.conflicts)
    }
    if !tabs.contains(current) { tabs.append(current) }
    return tabs
  }

  private func moreMenu(iconsOnly: Bool) -> some View {
    Menu {
      ForEach(GitTab.secondary(isProject: isProject), id: \.self) { tab in
        Button { pick(tab, via: .more) } label: { Label(tab.title, systemImage: tab.symbol) }
      }
    } label: {
      if iconsOnly {
        Image(systemName: "ellipsis.circle")
      } else {
        Label("More", systemImage: "ellipsis.circle").labelStyle(.titleAndIcon)
      }
    }
    .menuStyle(.button)
    .menuIndicator(.hidden)
    .fixedSize()
    .help("More git views")
    .accessibilityLabel("More git views")
  }

  private func pick(_ tab: GitTab, via: MacTelemetryEvent.GitViewSource) {
    // History stays lit on a ref's history; picking it again shows all of it.
    guard let route = tab.route, route != view, tab != current || tab == .history else { return }
    MacTelemetry.capture(.gitViewPicked(view: route.segment, via: via))
    model.navigate(.sessionGit(id: workspace.sessionId, view: route))
  }
}
