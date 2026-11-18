#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Blueprints, the new-project sheet and drafting — the same ids and
  /// fixtures as the iOS gallery's `BlueprintStories`.
  enum BlueprintStories {
    private static let sheet = CGSize(width: 560, height: 0)

    static var all: [GalleryStory] {
      [
        GalleryStory(
          "blueprints/list", size: CGSize(width: 1000, height: 640), chrome: true,
          fixtures: GalleryFixtures.blueprints, setup: load
        ) { BlueprintsScreen() },
        GalleryStory(
          "blueprints/list/empty", size: CGSize(width: 1000, height: 560), chrome: true,
          fixtures: GalleryFixtures.noBlueprints, setup: load
        ) { BlueprintsScreen() },
        GalleryStory(
          "blueprints/editor", size: CGSize(width: 1000, height: 2150), chrome: true,
          fixtures: GalleryFixtures.blueprints, setup: load
        ) { BlueprintScreen(blueprintId: GalleryFixtures.macAppBlueprintId) },
        GalleryStory(
          "blueprints/new-project", size: sheet, fixtures: GalleryFixtures.blueprints, setup: load
        ) { NewProjectSheet(blueprintId: GalleryFixtures.macAppBlueprintId) },
        GalleryStory(
          "blueprints/new-project/running", size: sheet,
          fixtures: GalleryFixtures.blueprints(onlyRun: GalleryFixtures.runningBlueprintRunId), setup: load
        ) {
          NewProjectSheet(
            blueprintId: GalleryFixtures.macAppBlueprintId, runId: GalleryFixtures.runningBlueprintRunId)
        },
        GalleryStory(
          "blueprints/new-project/failed", size: sheet,
          fixtures: GalleryFixtures.blueprints(onlyRun: GalleryFixtures.failedBlueprintRunId), setup: load
        ) {
          NewProjectSheet(
            blueprintId: GalleryFixtures.macAppBlueprintId, runId: GalleryFixtures.failedBlueprintRunId)
        },
        GalleryStory(
          "blueprints/generate", size: CGSize(width: 1000, height: 820), chrome: true,
          fixtures: GalleryFixtures.blueprints, setup: load
        ) { GenerateBlueprintScreen(selection: ["/Users/dev/Projects/Argus", "/Users/dev/Projects/Grove"]) },
        GalleryStory(
          "blueprints/generate/drafting", size: CGSize(width: 1000, height: 560), chrome: true,
          fixtures: GalleryFixtures.blueprints, setup: load
        ) { GenerateBlueprintScreen(drafting: true) },
        GalleryStory(
          "blueprints/revise", size: sheet, fixtures: GalleryFixtures.blueprints, setup: load
        ) { ReviseBlueprintStory() },
      ]
    }

    @MainActor
    private static func load(_ stage: GalleryStage) async {
      await stage.blueprints.refresh()
      await stage.host.loadRunners()
    }
  }

  /// The revise sheet over the fixture Mac-app blueprint.
  private struct ReviseBlueprintStory: View {
    @Environment(BlueprintsStore.self) private var store

    var body: some View {
      ReviseBlueprintSheet(
        form: store.blueprint(id: GalleryFixtures.macAppBlueprintId).map(BlueprintForm.init) ?? BlueprintForm()
      ) { _ in }
    }
  }
#endif
