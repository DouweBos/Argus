import ArgusKit
import Foundation
import Observation

/// Install Skill: where from (a URL on every client; a folder or a `.skill`
/// file only on the Mac, which can pick them), and which skills folder it lands
/// in. Stops to ask before replacing a skill of the same name.
@MainActor
@Observable
public final class SkillInstallModel {
  private typealias Methods = ArgusProtocol.Methods

  public enum From: String, CaseIterable, Sendable {
    case url, folder, archive

    public var label: String {
      switch self {
      case .url: "URL"
      case .folder: "Folder"
      case .archive: "File"
      }
    }
  }

  // Any edit names a different install, so the replace question no longer applies.
  public var from: From = .url { didSet { conflict = nil } }
  /// The URL typed, or the folder or file picked.
  public var location = "" { didSet { conflict = nil } }
  /// A folder inside the repository; empty for its root or the link's folder.
  public var subpath = "" { didSet { conflict = nil } }
  public var scope: ArgusProtocol.SkillScope = .user { didSet { conflict = nil } }
  public var runner: ArgusProtocol.SkillRunner = .claudeCode { didSet { conflict = nil } }
  public var repoRoot: String? { didSet { conflict = nil } }
  public internal(set) var installing = false
  public internal(set) var error: String?
  /// Set when a skill of this name is already there; Replace installs over it.
  public internal(set) var conflict: String?
  public internal(set) var installed: ArgusProtocol.Skill?

  public let skills: SkillsModel

  public init(skills: SkillsModel, url: String? = nil) {
    self.skills = skills
    if let url { location = url }
  }

  public var projects: [RemoteProject] { skills.host.projects }

  public var canInstall: Bool {
    !installing && !location.trimmingCharacters(in: .whitespaces).isEmpty
      && (scope == .user || repoRoot != nil)
  }

  /// Where it will land, for the footer.
  public var destinationHint: String {
    let folder = runner == .codex ? ".codex/skills" : ".claude/skills"
    if scope == .user {
      return runner == .codex ? "Installs into ~/.codex/skills, for every project." : "Installs into ~/.claude/skills, for every project."
    }
    let name = projects.first { $0.repoRoot == repoRoot }?.name ?? "the project"
    return "Installs into \(folder) in \(name), so it's checked in with the project."
  }

  public static let urlHint =
    "A git repository, a GitHub link to the folder holding SKILL.md, or a gist."

  @discardableResult
  public func install(overwrite: Bool = false) async -> Bool {
    guard let backend = skills.host.backend, canInstall else { return false }
    installing = true
    defer { installing = false }
    let trimmedSubpath = subpath.trimmingCharacters(in: .whitespaces)
    let input = ArgusProtocol.SkillInstallInput(
      from: .init(rawValue: from.rawValue), location: location.trimmingCharacters(in: .whitespaces),
      subpath: trimmedSubpath.isEmpty ? nil : trimmedSubpath,
      target: .init(scope: scope, runner: runner, repoRoot: scope == .project ? repoRoot : nil),
      overwrite: overwrite)
    do {
      let result = try await backend.request(Methods.SkillsInstall.self, .init(input: input))
      if result.status == .exists {
        conflict = result.name
        return false
      }
      conflict = nil
      error = nil
      if let skill = result.skill {
        installed = skill
        skills.installed(skill)
      }
      return true
    } catch {
      self.error = HostStore.describe(error)
      skills.host.hooks.errorReported(error, "skills")
      return false
    }
  }
}
