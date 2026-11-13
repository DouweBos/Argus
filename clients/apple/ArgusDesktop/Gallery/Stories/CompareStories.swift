#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// A compare run of four slots: its screen, its keep sheet and its rows in the sidebar.
  enum CompareStories {
    static var all: [GalleryStory] {
      [
        GalleryStory(
          "compare/run", size: CGSize(width: 1240, height: 720), chrome: true, fixtures: GalleryFixtures.compare,
          setup: load
        ) {
          CompareRunView(groupId: GalleryFixtures.compareGroupId)
        },
        GalleryStory(
          "compare/sidebar", size: CGSize(width: 280, height: 0), fixtures: GalleryFixtures.compare, setup: load
        ) {
          SidebarStory()
        },
        GalleryStory("compare/keep", size: CGSize(width: 400, height: 0)) {
          KeepStory()
        },
      ]
    }

    @MainActor private static func load(_ stage: GalleryStage) async {
      await stage.host.reloadRunners()
      await stage.host.loadSessions(repoRoot: GalleryFixtures.argusRoot)
      stage.model.navigate(.compareRun(groupId: GalleryFixtures.compareGroupId))
    }

    private struct SidebarStory: View {
      @Environment(HostStore.self) private var host

      var body: some View {
        if let project = host.projects.first {
          ProjectSidebarSection(
            project: project, showsHost: false, shown: nil, collapsed: .constant(false),
            folds: SidebarCollapse(key: "gallery.sidebar.folds"))
            .padding(8)
        }
      }
    }

    /// The sheet's form as "Keep this one" opens it.
    private struct KeepStory: View {
      @State private var landing = CompareLanding.merge
      @State private var deleteOthers = true

      var body: some View {
        CompareKeepForm(landing: $landing, deleteOthers: $deleteOthers, runner: "Claude Code", others: 3)
          .padding(20)
      }
    }
  }
#endif
