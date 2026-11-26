import ArgusKit
import Foundation
import Observation

/// The Skills screen: every skill folder the runners read on the connected
/// computer, and installing, updating and removing them. Shared by the Mac and
/// the phone.
@MainActor
@Observable
public final class SkillsModel {
  public typealias Skill = ArgusProtocol.Skill
  private typealias Methods = ArgusProtocol.Methods

  public internal(set) var skills: [Skill] = []
  public internal(set) var loaded = false
  public internal(set) var error: String?
  /// A short confirmation of the last action, e.g. "review is up to date."
  public internal(set) var notice: String?
  /// Skills with an update or removal in flight.
  public internal(set) var busy: Set<String> = []

  /// Held strongly: a screen can outlive the connection it was opened on.
  public let host: HostStore

  public init(host: HostStore) {
    self.host = host
  }

  public var phase: LoadPhase {
    LoadPhase(loaded: loaded, error: error, isEmpty: skills.isEmpty)
  }

  public func refresh() async {
    guard let backend = host.backend else { return }
    do {
      skills = try await backend.request(Methods.SkillsList.self, .init()).skills
      loaded = true
      error = nil
    } catch {
      if Task.isCancelled { return }
      loaded = true
      self.error = "Couldn't read skills: \(HostStore.describe(error))"
    }
  }

  // MARK: Sections

  public struct Section: Identifiable, Sendable {
    /// `user`, or the project's repo root.
    public let id: String
    public let title: String
    public let skills: [Skill]
  }

  /// Your skills first, then one section per project, each sorted by name.
  public var sections: [Section] {
    let byName: (Skill, Skill) -> Bool = {
      $0.name.localizedStandardCompare($1.name) == .orderedAscending
    }
    var out: [Section] = []
    let user = skills.filter { $0.scope == .user }
    if !user.isEmpty { out.append(Section(id: "user", title: "Your Skills", skills: user.sorted(by: byName))) }
    let projects = Dictionary(grouping: skills.filter { $0.scope == .project }) { $0.repoRoot ?? "" }
    for (root, list) in projects.sorted(by: { Self.projectTitle($0.value[0]) < Self.projectTitle($1.value[0]) }) {
      out.append(Section(id: root, title: Self.projectTitle(list[0]), skills: list.sorted(by: byName)))
    }
    return out
  }

  private static func projectTitle(_ skill: Skill) -> String {
    skill.projectName ?? skill.repoRoot.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "Project"
  }

  // MARK: Actions

  public func update(_ skill: Skill) async {
    guard let backend = host.backend, !busy.contains(skill.path) else { return }
    busy.insert(skill.path)
    defer { busy.remove(skill.path) }
    do {
      let result = try await backend.request(Methods.SkillsUpdate.self, .init(path: skill.path))
      replace(result.skill)
      notice = result.changed ? "Updated \(result.skill.name)." : "\(result.skill.name) is up to date."
      error = nil
    } catch {
      fail("Couldn't update \(skill.name)", error)
    }
  }

  @discardableResult
  public func remove(_ skill: Skill) async -> Bool {
    guard let backend = host.backend, !busy.contains(skill.path) else { return false }
    busy.insert(skill.path)
    defer { busy.remove(skill.path) }
    do {
      _ = try await backend.request(Methods.SkillsRemove.self, .init(path: skill.path))
      skills.removeAll { $0.path == skill.path }
      notice = "Removed \(skill.name)."
      error = nil
      return true
    } catch {
      fail("Couldn't remove \(skill.name)", error)
      return false
    }
  }

  /// Puts a freshly installed or updated skill in the list.
  func replace(_ skill: Skill) {
    if let index = skills.firstIndex(where: { $0.path == skill.path }) {
      skills[index] = skill
    } else {
      skills.append(skill)
    }
  }

  func installed(_ skill: Skill) {
    replace(skill)
    notice = "Installed \(skill.name)."
    error = nil
  }

  public func dismissNotice() { notice = nil }

  /// An outcome the screen worked out itself, such as an export.
  public func report(_ error: String? = nil, notice: String? = nil) {
    self.error = error
    self.notice = notice
  }

  private func fail(_ what: String, _ error: Error) {
    self.error = "\(what): \(HostStore.describe(error))"
    host.hooks.errorReported(error, "skills")
  }

  // MARK: Labels

  public static func runnerLabel(_ runner: ArgusProtocol.SkillRunner) -> String {
    switch runner {
    case .codex: "Codex"
    default: "Claude Code"
    }
  }

  public static func scopeLabel(_ skill: Skill) -> String {
    skill.scope == .user ? "Every project" : projectTitle(skill)
  }

  /// Where it was installed from, short enough for a row: `octo/skills`, `Gist`, a folder's name.
  public static func sourceLabel(_ source: ArgusProtocol.SkillSource?) -> String? {
    guard let source else { return nil }
    switch source.kind {
    case .gist: return "Gist"
    case .git:
      let trimmed = source.location.replacingOccurrences(of: #"\.git$"#, with: "", options: .regularExpression)
      if let url = URL(string: trimmed), let host = url.host() {
        let path = url.pathComponents.filter { $0 != "/" }.prefix(2).joined(separator: "/")
        return host == "github.com" ? path : "\(host)/\(path)"
      }
      return trimmed.replacingOccurrences(of: #"^[^@]+@[^:]+:"#, with: "", options: .regularExpression)
    default: return URL(fileURLWithPath: source.location).lastPathComponent
    }
  }

  /// One line under the name: description, else what kind of folder it is.
  public static func detail(_ skill: Skill) -> String {
    skill.description ?? "\(skill.fileCount) file\(skill.fileCount == 1 ? "" : "s")"
  }

  /// Whether Update has something to fetch from.
  public static func canUpdate(_ skill: Skill) -> Bool { skill.source != nil }
}
