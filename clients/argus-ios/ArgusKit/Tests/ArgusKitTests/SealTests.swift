import Foundation
import Testing
@testable import ArgusKit

/// Sealed pushes produced by the desktop's own `seal.ts`. The Notification
/// Service Extension opens these on the lock screen, so a mismatch shows the
/// user a placeholder instead of the real alert.
@Suite("Sealed push payloads")
struct SealTests {
  private static let pushKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
  private static let nonce = "AwMDAwMDAwMDAwMD"
  private static let sealed = """
    AwMDAwMDAwMDAwMDXtzXai5EO2BAYgIujCKMLsEegoDQ7LZKDZ/g1I2RYNbUwhlRu5rVMLznPWTh7Mtn\
    TE19oKu4HwdJWkPKTV/hB5nBF1rOwRF/Pa/Tpe61pVSYxL1YO1F9D8Bzp7IAc0htq4tUhZZBUy4PvgswSM8\
    /0PX6BToM8Y5ti6HF7BhhKdeZmc+nQmOISOtyMd04cbkHt0mt7bLjyHNjhxzX9Wax9hNd8y9gTsIAL7vLxg\
    m/hgYKnseuW+lVsti50Kb2JZQGQ3D4xmEeXXD+YCMqzJJxzbwq0tzl7EbiID7XDV6r
    """

  @Test("opens a payload sealed by the desktop")
  func opensDesktopPayload() throws {
    let opened = try #require(ArgusSeal.open(Self.sealed, pushKeyBase64: Self.pushKey))
    #expect(opened.title == "Argus")
    #expect(opened.body == "Agent needs approval")
    #expect(opened.kind == "permission")
    #expect(opened.agentId == "agent-123")
    #expect(opened.sessionId == "sess-9")
    #expect(opened.toolUseId == "tu-77")
    #expect(opened.actions.map(\.id) == ["approve", "deny"])
    #expect(opened.actions.map(\.title) == ["Approve", "Deny"])
  }

  /// Only the desktop seals in production, so this checks the format
  /// round-trips rather than that the bytes match: `JSONEncoder` emits object
  /// keys in hash order, so identical input yields a different — equally
  /// valid — plaintext to `JSON.stringify`, and hence different ciphertext.
  @Test("our own sealing round-trips through our own opening")
  func sealRoundTrips() throws {
    let notification = SealedNotification(
      title: "Argus", body: "Agent needs approval", kind: "permission",
      agentId: "agent-123", sessionId: "sess-9", toolUseId: "tu-77",
      actions: [
        RemoteNotificationAction(id: "approve", title: "Approve"),
        RemoteNotificationAction(id: "deny", title: "Deny"),
      ])
    let produced = try ArgusSeal.seal(
      notification,
      pushKeyBase64: Self.pushKey,
      nonce: ArgusBase64.decode(Self.nonce)!)
    let reopened = try #require(ArgusSeal.open(produced, pushKeyBase64: Self.pushKey))
    #expect(reopened.title == notification.title)
    #expect(reopened.toolUseId == notification.toolUseId)
    #expect(reopened.actions.map(\.id) == ["approve", "deny"])
    // The envelope framing is fixed even though the plaintext ordering is not.
    let blob = try #require(ArgusBase64.decode(produced))
    #expect(blob.prefix(12) == ArgusBase64.decode(Self.nonce))
    #expect(blob.count == 12 + 206 + 16)
  }

  @Test("collapse id matches the desktop's HMAC")
  func collapseId() {
    #expect(
      ArgusSeal.collapseId(pushKeyBase64: Self.pushKey, subject: "prompt-tu-77")
        == "nwyawhtQoWIzki7AzDpCnA")
  }

  @Test("a wrong key, a short blob or junk all fail quietly")
  func failsQuietly() {
    let otherKey = ArgusBase64.encode(Data(repeating: 8, count: 32))
    #expect(ArgusSeal.open(Self.sealed, pushKeyBase64: otherKey) == nil)
    #expect(ArgusSeal.open("AAAA", pushKeyBase64: Self.pushKey) == nil)
    #expect(ArgusSeal.open(Self.sealed, pushKeyBase64: "not-a-key") == nil)
  }

  @Test("collapse subjects match the desktop's rules")
  func collapseSubjects() {
    let finished = RemoteNotification(
      agentId: "a1", sessionId: nil, toolUseId: nil, kind: .finished,
      title: "", body: "", actions: [])
    #expect(finished.collapseIdentifier == "agent-a1")

    let permission = RemoteNotification(
      agentId: "a1", sessionId: nil, toolUseId: "t9", kind: .permission,
      title: "", body: "", actions: [])
    #expect(permission.collapseIdentifier == "prompt-t9")

    // An MCP push never replaces anything.
    let push = RemoteNotification(
      agentId: "a1", sessionId: nil, toolUseId: nil, kind: .push,
      title: "", body: "", actions: [])
    #expect(push.collapseIdentifier == nil)
  }
}
