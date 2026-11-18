#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Blueprints and new projects — the same ids and fixtures as the Mac gallery's.
  enum BlueprintStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("blueprints/list", fixtures: GalleryFixtures.blueprints, setup: refresh) { BlueprintsView() },
        GalleryStory("blueprints/list/empty", fixtures: GalleryFixtures.noBlueprints, setup: refresh) {
          BlueprintsView()
        },
        GalleryStory("blueprints/editor", fixtures: GalleryFixtures.blueprints, setup: refresh) {
          BlueprintEditorView(blueprintId: GalleryFixtures.macAppBlueprintId)
        },
        GalleryStory("blueprints/new-project", fixtures: GalleryFixtures.blueprints, setup: refresh) {
          NewProjectView(blueprintId: GalleryFixtures.macAppBlueprintId)
        },
        GalleryStory(
          "blueprints/new-project/running",
          fixtures: GalleryFixtures.blueprints(onlyRun: GalleryFixtures.runningBlueprintRunId), setup: refresh
        ) {
          NewProjectView(
            blueprintId: GalleryFixtures.macAppBlueprintId, runId: GalleryFixtures.runningBlueprintRunId)
        },
        GalleryStory(
          "blueprints/new-project/failed",
          fixtures: GalleryFixtures.blueprints(onlyRun: GalleryFixtures.failedBlueprintRunId), setup: refresh
        ) {
          NewProjectView(
            blueprintId: GalleryFixtures.macAppBlueprintId, runId: GalleryFixtures.failedBlueprintRunId)
        },
        GalleryStory("blueprints/generate", fixtures: GalleryFixtures.blueprints, setup: refresh) {
          GenerateBlueprintView(picked: picked)
        },
        GalleryStory("blueprints/generate/drafting", fixtures: GalleryFixtures.blueprints, setup: refresh) {
          GenerateBlueprintView(picked: picked, drafting: true)
        },
      ]
    }

    private static let picked = ["Argus", "Grove", "Charon"].map { "/Users/dev/Projects/\($0)" }

    @MainActor
    private static func refresh(_ stage: GalleryStage) async {
      await stage.blueprints.refresh()
    }
  }
#endif
