import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Device input")
struct DeviceInputTests {
  private func attached() async -> (HostStore, RecordingBackend) {
    let backend = RecordingBackend()
    backend.reply("state_hydrate", #"{"projects":[],"sessions":[],"agents":[]}"#)
    let store = HostStore()
    await store.attach(backend)
    return (store, backend)
  }

  private func types(_ backend: RecordingBackend) -> [Int] {
    backend.calls("devices.touch").compactMap {
      if case .object(let fields) = $0.params, case .number(let type) = fields["event_type"] {
        return Int(type)
      }
      return nil
    }
  }

  @Test("a tap reaches the host down first, and waiting drag samples collapse to the latest")
  func ordered() async throws {
    let (store, backend) = await attached()
    store.deviceTouch(deviceId: "d", platform: .ios, x: 0.1, y: 0.1, eventType: 0)
    for step in 1...5 {
      store.deviceTouch(deviceId: "d", platform: .ios, x: 0.1 * Double(step), y: 0.1, eventType: 1)
    }
    store.deviceTouch(deviceId: "d", platform: .ios, x: 0.5, y: 0.1, eventType: 2)
    store.deviceKeyboard(deviceId: "d", platform: .ios, keyCode: 4, modifiers: 0, isDown: true)

    #expect(await eventually { backend.calls("devices.keyboard").count == 1 })
    #expect(types(backend) == [0, 1, 2])
    let names = backend.calls.map(\.name).filter { $0.hasPrefix("devices.") }
    #expect(names.last == "devices.keyboard")
  }
}
