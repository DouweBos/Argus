#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Skills and Install Skill — the same ids and fixtures as the Mac gallery's.
  enum SkillStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("skills/list", fixtures: GalleryFixtures.skillsList) { SkillsView() },
        GalleryStory("skills/list/empty", fixtures: GalleryFixtures.skillsEmpty) { SkillsView() },
        GalleryStory("skills/install", fixtures: GalleryFixtures.skillsList, setup: projects) { InstallStory() },
        GalleryStory("skills/install/project", fixtures: GalleryFixtures.skillsList, setup: projects) {
          InstallStory(project: true)
        },
        GalleryStory("skills/install/replace", fixtures: GalleryFixtures.skillInstallConflict, setup: projects) {
          InstallStory(conflict: true)
        },
        GalleryStory("skills/share", fixtures: GalleryFixtures.skillShared) { ShareStory() },
        GalleryStory("skills/share/published", fixtures: GalleryFixtures.skillShared) { ShareStory(published: true) },
      ]
    }

    @MainActor
    private static func projects(_ stage: GalleryStage) async { await stage.host.refreshProjects() }
  }

  /// The install screen over its own models, filled in as the story asks.
  private struct InstallStory: View {
    @Environment(HostStore.self) private var host
    var project = false
    var conflict = false
    @State private var install: SkillInstallModel?

    var body: some View {
      Group {
        if let install { SkillInstallView(install: install) } else { Color.clear }
      }
      .task {
        let next = SkillInstallModel(
          skills: SkillsModel(host: host), url: "https://github.com/houwert/skills/tree/main/code-review")
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
    @Environment(HostStore.self) private var host
    var published = false
    @State private var share: SkillShareModel?

    var body: some View {
      Group {
        if let share { SkillShareView(share: share) } else { Color.clear }
      }
      .task {
        let skills = SkillsModel(host: host)
        await skills.refresh()
        guard let skill = skills.skills.first else { return }
        let next = SkillShareModel(skill: skill, host: host)
        if published { await next.share() }
        share = next
      }
    }
  }
#endif
