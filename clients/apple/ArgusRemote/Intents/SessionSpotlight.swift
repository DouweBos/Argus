import ArgusCore
import CoreSpotlight
import Foundation
import SwiftUI

/// Sessions in Spotlight, one domain per computer so a computer's sessions
/// are replaced as a set and dropped with it when it is unpaired.
@MainActor
enum SessionSpotlight {
  static func entities(_ host: HostStore, hostId: String) -> [SessionEntity] {
    let names = Dictionary(host.projects.map { ($0.repoRoot, $0.name) }, uniquingKeysWith: { a, _ in a })
    return host.sessionsByRepo.values.joined()
      .filter { $0.status != .deleting }
      .map { session in
        SessionEntity(
          id: ScopedId.make(hostId, session.id), name: SessionActivity.title(session),
          project: names[session.repoRoot] ?? URL(fileURLWithPath: session.repoRoot).lastPathComponent,
          branch: session.branch)
      }
  }

  /// Re-index what the store holds for the connected computer.
  static func index(_ host: HostStore, hostId: String) async {
    let items = entities(host, hostId: hostId).map { entity in
      let item = CSSearchableItem(
        uniqueIdentifier: entity.id, domainIdentifier: hostId, attributeSet: entity.attributeSet)
      item.associateAppEntity(entity, priority: 1)
      return item
    }
    let index = CSSearchableIndex.default()
    try? await index.deleteSearchableItems(withDomainIdentifiers: [hostId])
    try? await index.indexSearchableItems(items)
  }

  static func forget(hostId: String) {
    CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [hostId])
  }

  /// A tapped Spotlight result, by the id it was indexed under.
  static func location(forItem identifier: String) -> (hostId: String, route: ArgusRoute)? {
    guard let scoped = ScopedId.split(identifier) else { return nil }
    return (scoped.hostId, .session(id: scoped.id, agentId: nil))
  }
}

/// Keeps Spotlight and Siri's project and session names in step with what the
/// connected computer has listed, a moment after it settles.
struct SpotlightIndexing: ViewModifier {
  @Environment(AppStore.self) private var app

  private struct Snapshot: Equatable {
    let hostId: String?
    let projects: [RemoteProject]
    let sessions: [String: [RemoteSession]]
  }

  func body(content: Content) -> some View {
    content.task(id: Snapshot(hostId: app.activeHostId, projects: app.host.projects, sessions: app.host.sessionsByRepo)) {
      guard let hostId = app.activeHostId, app.host.projectsLoaded else { return }
      try? await Task.sleep(for: .seconds(2))
      guard !Task.isCancelled else { return }
      ArgusShortcuts.updateAppShortcutParameters()
      // Empty is a computer just switched to, not one with no sessions.
      guard !app.host.sessionsByRepo.isEmpty else { return }
      await SessionSpotlight.index(app.host, hostId: hostId)
    }
  }
}
