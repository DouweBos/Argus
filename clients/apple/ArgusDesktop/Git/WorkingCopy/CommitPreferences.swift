import Foundation
import GroveKit

/// Commit templates and identity profiles, kept per machine like Grove keeps
/// them, so every repository's composer offers the same ones.
enum CommitPreferences {
  static let templatesKey = "git.commitTemplates"
  static let profilesKey = "git.identityProfiles"

  /// One store for every repository, so an edit shows in each composer.
  @MainActor static let templates = templateStore()

  @MainActor
  static func templateStore(_ defaults: UserDefaults = .standard) -> CommitTemplateStore {
    CommitTemplateStore(
      load: { decode([CommitTemplate].self, defaults.data(forKey: templatesKey)) },
      save: { defaults.set(try? JSONEncoder().encode($0), forKey: templatesKey) })
  }

  static func profiles(_ defaults: UserDefaults = .standard) -> [UserProfile] {
    decode([UserProfile].self, defaults.data(forKey: profilesKey)) ?? []
  }

  static func setProfiles(_ profiles: [UserProfile], _ defaults: UserDefaults = .standard) {
    defaults.set(try? JSONEncoder().encode(profiles), forKey: profilesKey)
  }

  private static func decode<T: Decodable>(_ type: T.Type, _ data: Data?) -> T? {
    data.flatMap { try? JSONDecoder().decode(type, from: $0) }
  }
}

/// Saving the identity a repository commits as, so it can be picked elsewhere.
@MainActor
enum IdentityProfiles {
  /// Adds `identity` as a profile unless one already matches it; the label
  /// defaults to the email's domain ("Work" for work.com reads better, but a
  /// domain is never wrong).
  static func adding(_ identity: CommitIdentity, label: String, to profiles: [UserProfile]) -> [UserProfile] {
    guard !profiles.contains(where: { $0.matches(identity) }) else { return profiles }
    let trimmed = label.trimmingCharacters(in: .whitespaces)
    let fallback = identity.email.split(separator: "@").last.map(String.init) ?? identity.email
    return profiles + [UserProfile(label: trimmed.isEmpty ? fallback : trimmed, userName: identity.name, email: identity.email)]
  }

  static func removing(_ id: UserProfile.ID, from profiles: [UserProfile]) -> [UserProfile] {
    profiles.filter { $0.id != id }
  }
}
