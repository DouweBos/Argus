import ArgusKit
import Foundation

/// The Skills screen and Install Skill, for both galleries.
extension GalleryFixtures {
  private static let skillsHome = "/Users/dev"
  private static let skillsProjects = ["Argus", "react-native-client", "houwert.dev"]

  private static func skill(
    _ name: String, _ description: String?, runner: String = "claude-code", project: String? = nil,
    source: [String: Any]? = nil, files: Int = 1
  ) -> [String: Any] {
    let root =
      project.map { "/Users/dev/Projects/\($0)/\(runner == "codex" ? ".codex" : ".claude")/skills" }
      ?? (runner == "codex" ? "\(skillsHome)/.codex/skills" : "\(skillsHome)/.claude/skills")
    return [
      "path": "\(root)/\(name)", "name": name, "description": description as Any? ?? NSNull(),
      "scope": project == nil ? "user" : "project", "runner": runner,
      "repo_root": project.map { "/Users/dev/Projects/\($0)" } as Any? ?? NSNull(),
      "project_name": project as Any? ?? NSNull(), "source": source as Any? ?? NSNull(), "file_count": files,
    ]
  }

  private static func source(_ kind: String, _ location: String, subpath: String? = nil) -> [String: Any] {
    let now = Date().timeIntervalSince1970 * 1000
    return [
      "kind": kind, "location": location, "subpath": subpath as Any? ?? NSNull(), "ref": NSNull(),
      "commit": kind == "git" || kind == "gist" ? "3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39" : NSNull(),
      "installed_at": now - 86_400_000 * 9, "updated_at": now - 86_400_000 * 2,
    ]
  }

  private static var someSkills: [[String: Any]] {
    [
      skill(
        "code-review", "Reviews a diff for correctness bugs and suggests the smallest fix.",
        source: source("git", "https://github.com/houwert/skills/tree/main/code-review", subpath: "code-review"),
        files: 4),
      skill(
        "release-notes", "Drafts release notes from merged pull requests since the last tag.",
        source: source("gist", "https://gist.github.com/houwert/aa5a315d61ae9438b18d")),
      skill("pdf", "Reads, fills and merges PDF files.", files: 12),
      skill(
        "commit-messages", "Writes Conventional Commits subjects from the staged diff.",
        source: source("folder", "/Users/dev/Shared/skills/commit-messages")),
      skill(
        "triage", "Labels and prioritises new issues.", runner: "codex",
        source: source("git", "git@github.com:houwert/codex-skills.git", subpath: "triage"), files: 2),
      skill("deploy-checklist", nil, runner: "codex", files: 3),
      skill(
        "swiftui-previews", "Adds gallery stories for new SwiftUI screens, both themes.", project: "Argus",
        source: source("archive", "/Users/dev/Downloads/swiftui-previews.skill"), files: 5),
      skill("changesets", "Writes a changeset for every user-visible change.", project: "Argus"),
      skill("telemetry-events", "Adds and documents the telemetry events a feature needs.", project: "Argus", files: 2),
      skill(
        "android-release", "Bumps the versionCode and ships to the internal track.", runner: "codex",
        project: "react-native-client", files: 3),
      skill("metro-debugging", "Finds why the Metro bundler won't start.", project: "react-native-client"),
      skill(
        "blog-post", "Turns release notes into a post for the site.", project: "houwert.dev",
        source: source("git", "https://github.com/houwert/skills", subpath: "blog-post")),
    ]
  }

  private static func skills(_ list: [[String: Any]]) -> [String: String] {
    [
      ArgusProtocol.Methods.SkillsList.name: GalleryJSON.encode(["skills": list]),
      RemoteMethod.projectsList.rawValue: GalleryJSON.projects(skillsProjects),
    ]
  }

  /// A dozen skills across both runners, your own and three projects'.
  public static var skillsList: [String: String] { skills(someSkills) }

  /// Nothing installed yet.
  public static var skillsEmpty: [String: String] { skills([]) }

  /// Install Skill over a skill that's already there.
  public static var skillInstallConflict: [String: String] {
    var fixtures = skillsList
    fixtures[ArgusProtocol.Methods.SkillsInstall.name] = GalleryJSON.encode([
      "status": "exists", "name": "code-review", "skill": NSNull(),
    ])
    return fixtures
  }

  /// Share, published.
  public static var skillShared: [String: String] {
    var fixtures = skillsList
    fixtures[ArgusProtocol.Methods.SkillsShare.name] = GalleryJSON.encode([
      "url": "https://gist.github.com/houwert/aa5a315d61ae9438b18d"
    ])
    return fixtures
  }
}
