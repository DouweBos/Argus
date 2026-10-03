import ArgusCore
import ArgusKit
import Foundation
import Observation

/// What Argus, not git, knows about a project's branches: pinned and archived
/// (host state) and protected (`.argus.json`). One per repo root, shared by
/// the sidebar and the toolbar.
@MainActor
@Observable
final class GitRefMarks {
  var pinned: [String] = []
  var archived: [String] = []
  private(set) var protected: [String] = []
  private(set) var defaultBase: String?

  private static var byRoot: [String: GitRefMarks] = [:]

  static func marks(for repoRoot: String) -> GitRefMarks {
    if let existing = byRoot[repoRoot] { return existing }
    let marks = GitRefMarks()
    byRoot[repoRoot] = marks
    return marks
  }

  func isPinned(_ name: String) -> Bool { pinned.contains(name) }
  func isArchived(_ name: String) -> Bool { archived.contains(name) }
  func isProtected(_ name: String) -> Bool { protected.contains(name) }

  /// Re-reads all three; a failed read keeps what was there.
  func load(repoRoot: String, backend: (any HostBackend)?) async {
    guard let backend else { return }
    async let pins = try? backend.request(ArgusProtocol.Commands.GitListPinnedBranches.self, .init(repoRoot: repoRoot))
    async let archives = try? backend.request(
      ArgusProtocol.Commands.GitListArchivedBranches.self, .init(repoRoot: repoRoot))
    async let config = try? backend.request(ArgusProtocol.Commands.ReadArgusConfig.self, .init(repoRoot: repoRoot))
    let (pinList, archiveList, argus) = await (pins, archives, config)
    if let pinList, pinList != pinned { pinned = pinList }
    if let archiveList, archiveList != archived { archived = archiveList }
    if let argus {
      if argus.protectedBranches != protected { protected = argus.protectedBranches }
      defaultBase = argus.defaultBaseBranch
    }
  }
}
