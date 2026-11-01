import ArgusCore
import ArgusKit
import Foundation
import Testing

/// A start offers models before any agent has reported them.
@MainActor
@Suite("Last-known models")
struct LastKnownModelsTests {
  @Test("a runner's last-reported models come from the host's runner list")
  func fromRunners() async {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(
      .automationsRunners,
      #"{"runners":[{"id":"claude-code","display_name":"Claude Code","is_custom":false,"default_model":null,"models":[],"reported_models":[{"value":"haiku","displayName":"Haiku","description":"","supportedEffortLevels":["low","high"]}]},{"id":"custom:apex","display_name":"Apex","is_custom":true,"default_model":null,"models":[]}]}"#
    )
    await store.attach(backend)
    await store.loadRunners()

    #expect(store.lastKnownModels(runnerId: nil).map(\.value) == ["haiku"])
    #expect(store.lastKnownModels(runnerId: nil).first?.supportedEffortLevels == ["low", "high"])
    #expect(store.lastKnownModels(runnerId: "custom:apex").isEmpty)
  }
}
