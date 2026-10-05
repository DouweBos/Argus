import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@MainActor
struct DroppedFilesTests {
  private func file(_ text: String) throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("drop-\(UUID()).txt")
    try Data(text.utf8).write(to: url)
    return url
  }

  @Test func aLocalSessionMentionsTheFilesOwnPath() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    let url = try file("hi")
    defer { try? FileManager.default.removeItem(at: url) }
    let dropped = await store.hostPaths(forDropped: [url], sessionId: "s1")
    #expect(dropped.paths == [url.path])
    #expect(!backend.requested.contains("upload_session_attachment"))
  }

  @Test func aRemoteSessionGetsTheFileUploadedFirst() async throws {
    var hooks = HostStoreHooks()
    hooks.sessionIsRemote = { _ in true }
    let store = HostStore(hooks: hooks)
    let backend = FakeBackend()
    backend.reply(
      command: "upload_session_attachment", #"{"name":"a.txt","path":"/host/staging/a.txt","size":2}"#)
    await store.attach(backend)
    let url = try file("hi")
    defer { try? FileManager.default.removeItem(at: url) }
    let dropped = await store.hostPaths(forDropped: [url], sessionId: "s1")
    #expect(dropped.paths == ["/host/staging/a.txt"])
    #expect(dropped.errors.isEmpty)
  }

  @Test func aFileThatCantBeSentIsReportedAndTheRestStillGo() async throws {
    var hooks = HostStoreHooks()
    hooks.sessionIsRemote = { _ in true }
    let store = HostStore(hooks: hooks)
    let backend = FakeBackend()
    backend.fail(command: "upload_session_attachment")
    await store.attach(backend)
    let url = try file("hi")
    defer { try? FileManager.default.removeItem(at: url) }
    let missing = URL(fileURLWithPath: "/nonexistent/\(UUID())")
    let dropped = await store.hostPaths(forDropped: [missing, url], sessionId: "s1")
    #expect(dropped.paths.isEmpty)
    #expect(dropped.errors.count == 2)
  }
}
