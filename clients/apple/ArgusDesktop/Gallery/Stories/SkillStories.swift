#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Skills and Install Skill — the same ids and fixtures as the iOS gallery's.
  enum SkillStories {
    private static let sheet = CGSize(width: 560, height: 0)

    static var all: [GalleryStory] {
      [
        GalleryStory("skills/list", size: CGSize(width: 1000, height: 1180), chrome: true, fixtures: GalleryFixtures.skillsList) {
          SkillsScreen()
        },
        GalleryStory("skills/list/empty", size: CGSize(width: 1000, height: 560), chrome: true, fixtures: GalleryFixtures.skillsEmpty) {
          SkillsScreen()
        },
        GalleryStory("skills/install", size: sheet, fixtures: GalleryFixtures.skillsList, setup: projects) {
          InstallStory()
        },
        GalleryStory("skills/install/project", size: sheet, fixtures: GalleryFixtures.skillsList, setup: projects) {
          InstallStory(project: true)
        },
        GalleryStory("skills/install/replace", size: sheet, fixtures: GalleryFixtures.skillInstallConflict, setup: projects) {
          InstallStory(conflict: true)
        },
        GalleryStory("skills/share", size: sheet, fixtures: GalleryFixtures.skillShared) { ShareStory() },
        GalleryStory("skills/share/published", size: sheet, fixtures: GalleryFixtures.skillShared) {
          ShareStory(published: true)
        },
      ]
    }

    private static func projects(_ stage: GalleryStage) async { await stage.host.refreshProjects() }
  }

  /// The sheet over its own models, filled in as the story asks.
  private struct InstallStory: View {
    @Environment(DesktopModel.self) private var model
    var project = false
    var conflict = false
    @State private var install: SkillInstallModel?

    var body: some View {
      Group {
        if let install { SkillInstallSheet(install: install) } else { Color.clear.frame(width: 560, height: 540) }
      }
      .task {
        let next = SkillInstallModel(
          skills: SkillsModel(host: model.store), url: "https://github.com/houwert/skills/tree/main/code-review")
        if project {
          next.scope = .project
          next.repoRoot = next.projects.first?.repoRoot
        }
        if conflict { await next.install() }
        install = next
      }
    }
  }

  /// The share sheet for the first fixture skill, published when the story asks.
  private struct ShareStory: View {
    @Environment(DesktopModel.self) private var model
    var published = false
    @State private var share: SkillShareModel?

    var body: some View {
      Group {
        if let share { SkillShareSheet(share: share) } else { Color.clear.frame(width: 520, height: 400) }
      }
      .task {
        let skills = SkillsModel(host: model.store)
        await skills.refresh()
        guard let skill = skills.skills.first else { return }
        let next = SkillShareModel(skill: skill, host: model.store)
        if published { await next.share() }
        share = next
      }
    }
  }
#endif
