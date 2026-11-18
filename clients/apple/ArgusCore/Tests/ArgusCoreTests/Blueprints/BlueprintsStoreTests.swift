import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@MainActor
struct BlueprintsStoreTests {
  private func store(_ fixtures: [String: String] = GalleryFixtures.blueprints) async -> BlueprintsStore {
    let host = HostStore()
    await host.attach(GalleryBackend(fixtures))
    let store = BlueprintsStore(host: host)
    await store.refresh()
    return store
  }

  @Test("lists blueprints by name and runs newest first")
  func refresh() async {
    let store = await store()
    #expect(store.blueprints.count == 6)
    #expect(store.blueprints.first?.name == "Expo app")
    #expect(store.runs.first?.id == GalleryFixtures.runningBlueprintRunId)
    #expect(store.runs(for: GalleryFixtures.macAppBlueprintId).count == 3)
    #expect(store.run(id: GalleryFixtures.failedBlueprintRunId)?.failedStep?.key == .validate)
    #expect(store.phase == .content)
  }

  @Test("an empty list reads as empty, not as an error")
  func empty() async {
    let store = await store(GalleryFixtures.noBlueprints)
    #expect(store.blueprints.isEmpty)
    #expect(store.error == nil)
  }

  @Test("a form round-trips a blueprint and clears the settings source with an empty string")
  func formRoundTrip() async throws {
    let store = await store()
    let blueprint = try #require(store.blueprint(id: GalleryFixtures.macAppBlueprintId))
    var form = BlueprintForm(blueprint)
    #expect(form.references.map(\.name) == ["Argus", "Grove"])
    #expect(form.copySettingsFrom == "/Users/dev/Projects/Argus")
    form.removeReference("/Users/dev/Projects/Argus")
    #expect(form.copySettingsFrom == nil)
    #expect(form.updateInput.copyProjectSettingsFrom == "")
    #expect(form.createInput.copyProjectSettingsFrom == nil)
    #expect(form.createInput.fromDraft == nil)
  }

  @Test("a template blueprint needs owner/name")
  func templateProblem() {
    var form = BlueprintForm()
    form.name = "App"
    form.scaffold = .githubTemplate
    form.templateRepo = "template"
    #expect(form.problem != nil)
    form.templateRepo = "me/template"
    #expect(form.problem == nil)
  }

  @Test("project names follow the host's rule")
  func projectName() {
    var request = BlueprintsStore.ProjectRequest()
    #expect(request.nameProblem != nil)
    request.name = "my app"
    #expect(request.nameProblem != nil)
    request.name = "tally-2"
    #expect(request.nameProblem == nil)
  }
}
