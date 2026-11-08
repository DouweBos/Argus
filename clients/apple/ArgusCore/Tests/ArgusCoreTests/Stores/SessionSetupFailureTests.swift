import ArgusCore
import ArgusKit
import Foundation
import Testing

/// A worktree the computer couldn't make must not sit on "Setting up…" forever.
@MainActor
@Suite("Session setup failure")
struct SessionSetupFailureTests {
  private static let pending = """
    {"id":"s-new","kind":"worktree","branch":"","display_name":"reply with hi",
    "description":"","path":"","repo_root":"/repo","status":"initializing"}
    """
  private static let failed = """
    {"sessions":[{"id":"s-new","kind":"worktree","branch":"","display_name":"reply with hi",
    "description":"","path":"","repo_root":"/repo","status":"error",
    "setup_error":"Branch \\"reply-with-hi\\" is already used"}]}
    """

  @Test("a create that fails at once shows the failure, not the placeholder")
  func failedCreateReplacesPlaceholder() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(.sessionsCreate, #"{"session":\#(Self.pending)}"#)
    backend.reply(.sessionsList, Self.failed)
    await store.attach(backend)

    _ = await store.createSession(repoRoot: "/repo", branch: "reply-with-hi", description: "")

    let session = try #require(store.sessionsByRepo["/repo"]?.first)
    #expect(store.sessionsByRepo["/repo"]?.count == 1)
    #expect(session.status == .error)
    #expect(session.setupError == #"Branch "reply-with-hi" is already used"#)
  }
}
