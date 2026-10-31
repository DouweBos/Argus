import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@MainActor
private final class FakeDeviceHost: DeviceSessionHost {
  var connectionId: String?
  var deviceClaims: [String: RemoteDeviceClaimState] = [:]
  var statusHolder: RemoteDeviceClaim?
  var calls: [String] = []

  func loadClaimStatus(deviceId: String) async {
    calls.append("status")
    connectionId = "me"
    deviceClaims[deviceId] = RemoteDeviceClaimState(
      deviceId: deviceId, holder: statusHolder, waiting: [])
  }

  func claimDevice(deviceId: String, force: Bool) async -> Bool {
    calls.append(force ? "claim!" : "claim")
    return true
  }

  func deviceState(deviceId: String, platform: RemotePlatform) async -> RemoteDeviceState? {
    calls.append("state")
    return nil
  }
}

private final class SleepLog: @unchecked Sendable {
  var slept: [Duration] = []
}

private func claim(_ connection: String) -> RemoteDeviceClaim {
  let json = #"{"connection_id":"\#(connection)","device_id":"d","label":"\#(connection)"}"#
  return try! JSONDecoder().decode(RemoteDeviceClaim.self, from: Data(json.utf8))
}

@MainActor
@Suite("Device session")
struct DeviceSessionTests {
  private func session(
    _ log: SleepLog = SleepLog(), watches: @escaping @MainActor (DeviceSession.Watch) -> Void = { _ in }
  ) -> DeviceSession {
    DeviceSession(sleep: { log.slept.append($0) }, onWatchEnded: watches)
  }

  @Test("retries a refused start five seconds apart, then claims and seeds the pose")
  func retries() async {
    let log = SleepLog()
    let host = FakeDeviceHost()
    let session = session(log)
    var attempts = 0
    await session.run(
      deviceId: "d", platform: .ios, host: host, claim: true,
      attach: { _ in
        attempts += 1
        return attempts < 3 ? nil : {}
      }, sink: { _ in })
    #expect(attempts == 3)
    #expect(log.slept == [.seconds(5), .seconds(5), .seconds(10)])
    #expect(host.calls == ["status", "claim", "state"])
    #expect(session.status == .noVideo)
  }

  @Test("gives up after six refused starts")
  func givesUp() async {
    let log = SleepLog()
    let session = session(log)
    var attempts = 0
    await session.run(
      deviceId: "d", platform: .ios, host: FakeDeviceHost(), claim: true,
      attach: { _ in
        attempts += 1
        return nil
      }, sink: { _ in })
    #expect(attempts == 6)
    #expect(log.slept.count == 5)
    #expect(session.status == .error)
  }

  @Test("leaves someone else's claim alone, and claims nothing without control")
  func claims() async {
    let held = FakeDeviceHost()
    held.statusHolder = claim("other")
    await session().run(
      deviceId: "d", platform: .ios, host: held, claim: true, attach: { _ in {} }, sink: { _ in })
    #expect(held.calls == ["status", "state"])

    let watcher = FakeDeviceHost()
    await session().run(
      deviceId: "d", platform: .ios, host: watcher, claim: false, attach: { _ in {} },
      sink: { _ in })
    #expect(watcher.calls == ["state"])
  }

  @Test("tracks the coded size and keeps a streaming picture out of no-video")
  func streaming() async {
    let session = session()
    var forwarded = 0
    await session.run(
      deviceId: "d", platform: .ios, host: FakeDeviceHost(), claim: false,
      attach: { sink in
        sink(.config(streamId: 1, codec: "avc1", codedWidth: 300, codedHeight: 600, description: Data()))
        session.markStreaming()
        return {}
      }, sink: { _ in forwarded += 1 })
    #expect(session.codedSize == CGSize(width: 300, height: 600))
    #expect(forwarded == 1)
    #expect(session.status == .streaming)
  }

  @Test("someone else holds it only once our own connection id is known")
  func otherHolder() {
    let state = RemoteDeviceClaimState(deviceId: "d", holder: claim("other"), waiting: [])
    #expect(DeviceSession.otherHolder(state, connectionId: nil) == nil)
    #expect(DeviceSession.otherHolder(state, connectionId: "other") == nil)
    #expect(DeviceSession.otherHolder(state, connectionId: "me") == claim("other"))
    #expect(DeviceSession.otherHolder(nil, connectionId: "me") == nil)
  }

  @Test("a rerun on the same device keeps the watch; stop detaches and reports it once")
  func watch() async {
    var watches: [DeviceSession.Watch] = []
    var detached = 0
    let session = session(watches: { watches.append($0) })
    let attach: DeviceSession.Attach = { _ in { detached += 1 } }
    await session.run(
      deviceId: "d", platform: .android, host: FakeDeviceHost(), claim: false, attach: attach,
      sink: { _ in })
    session.markInteracted()
    await session.run(
      deviceId: "d", platform: .android, host: FakeDeviceHost(), claim: false, attach: attach,
      sink: { _ in })
    #expect(detached == 1)
    #expect(watches.isEmpty)
    session.stop()
    session.stop()
    #expect(detached == 2)
    #expect(watches.map(\.platform) == [.android])
    #expect(watches.map(\.interacted) == [true])
  }
}
