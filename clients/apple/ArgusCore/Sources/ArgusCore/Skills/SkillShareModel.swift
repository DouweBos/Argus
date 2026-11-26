import ArgusKit
import Foundation
import Observation

/// Share a skill as a gist or a new GitHub repository, through the computer's
/// `gh`; the link it returns is one Install Skill takes. Shared by the Mac and
/// the phone.
@MainActor
@Observable
public final class SkillShareModel: Identifiable {
  private typealias Methods = ArgusProtocol.Methods

  public enum Target: String, CaseIterable, Sendable {
    case gist, repo

    public var label: String { self == .gist ? "Gist" : "GitHub Repository" }
  }

  public let skill: ArgusProtocol.Skill
  public var target: Target = .gist
  public var isPublic = false
  /// Empty uses the skill's folder name.
  public var repoName = ""
  public internal(set) var sharing = false
  public internal(set) var error: String?
  /// The published gist or repository.
  public internal(set) var url: String?

  public let host: HostStore

  public init(skill: ArgusProtocol.Skill, host: HostStore) {
    self.skill = skill
    self.host = host
  }

  public nonisolated var id: String { skill.path }

  public var folderName: String { URL(fileURLWithPath: skill.path).lastPathComponent }

  public var visibilityLabel: (secret: String, open: String) {
    target == .gist ? ("Secret", "Public") : ("Private", "Public")
  }

  public var hint: String {
    switch target {
    case .gist:
      "A gist holds the skill's files but no folders. Anyone with a secret gist's link can install it."
    case .repo:
      "Creates the repository on your GitHub account with gh and pushes the skill's files to it."
    }
  }

  @discardableResult
  public func share() async -> Bool {
    guard let backend = host.backend, !sharing else { return false }
    sharing = true
    defer { sharing = false }
    let name = repoName.trimmingCharacters(in: .whitespaces)
    let input = ArgusProtocol.SkillShareInput(
      path: skill.path, target: .init(rawValue: target.rawValue), public: isPublic,
      repoName: target == .repo && !name.isEmpty ? name : nil)
    do {
      url = try await backend.request(Methods.SkillsShare.self, .init(input: input)).url
      error = nil
      return true
    } catch {
      self.error = HostStore.describe(error)
      host.hooks.errorReported(error, "skills")
      return false
    }
  }

  /// Saves the skill as a `.skill` file on the computer (the Mac's, where it can be picked).
  public static func export(_ skill: ArgusProtocol.Skill, to dest: String, host: HostStore) async -> String? {
    guard let backend = host.backend else { return "Not connected." }
    do {
      _ = try await backend.request(ArgusProtocol.Commands.SkillExport.self, .init(path: skill.path, dest: dest))
      return nil
    } catch {
      host.hooks.errorReported(error, "skills")
      return HostStore.describe(error)
    }
  }
}
