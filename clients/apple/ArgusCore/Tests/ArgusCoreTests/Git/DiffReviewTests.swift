import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Diff review")
struct DiffReviewTests {
  private static let session = """
    {"id":"s-1","kind":"worktree","branch":"feat","display_name":"Feat",
    "description":"","path":"/work/argus-feat","repo_root":"/work/argus","status":"ready"}
    """

  private static func comment(_ path: String, _ lines: ClosedRange<Int>, _ body: String, side: DiffReviewComment.Side = .new)
    -> DiffReviewComment
  {
    DiffReviewComment(
      path: path, side: side, lines: lines, excerpt: ["let x = 1"], hunk: "@@ -1,2 +1,2 @@\n-let x = 0\n+let x = 1",
      scope: "uncommitted changes", body: body)
  }

  @Test("three comments on two files become one message, each with its location and hunk")
  func promptCarriesEveryComment() {
    let comments = [
      Self.comment("b.ts", 4...4, "Rename this."),
      Self.comment("a.ts", 12...14, "Handle nil."),
      Self.comment("a.ts", 3...3, "Why removed?", side: .old),
    ]
    let message = DiffReviewPrompt.message(comments)
    #expect(message.contains("## 1. a.ts:3 (removed)"))
    #expect(message.contains("## 2. a.ts:12-14"))
    #expect(message.contains("## 3. b.ts:4"))
    #expect(message.components(separatedBy: "```diff\n@@ -1,2 +1,2 @@").count == 4)
    #expect(message.contains("Handle nil."))
    let display = DiffReviewPrompt.displayText(comments)
    #expect(display.hasPrefix("Review: 3 comments on 2 files"))
    #expect(!display.contains("@@"))
  }

  @Test("a hunk with a fence in it gets a longer fence")
  func fenceOutgrowsTheHunk() {
    var comment = Self.comment("README.md", 1...1, "Fix the example.")
    comment.hunk = "@@ -1 +1 @@\n+```swift"
    #expect(DiffReviewPrompt.message([comment]).contains("````diff\n"))
  }

  @Test("a comment anchors to its last line by side, number and text")
  func anchors() {
    let comment = Self.comment("a.ts", 12...14, "x")
    #expect(comment.anchors(path: "a.ts", side: .new, last: 14, text: "let x = 1"))
    #expect(!comment.anchors(path: "a.ts", side: .new, last: 14, text: "let x = 2"))
    #expect(!comment.anchors(path: "a.ts", side: .old, last: 14, text: "let x = 1"))
  }

  @Test("sending posts one message to the live agent and clears the drafts")
  func sendGoesToTheLiveAgent() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(command: "get_session", Self.session)
    backend.reply(.agentsSend, #"{"queued":true}"#)
    backend.reply(.agentsList, #"{"agents":[{"agent_id":"a-1","session_id":"s-1","status":"idle","created_at":1}]}"#)
    await store.attach(backend)
    await store.adoptSession(id: "s-1")
    await store.loadAgents(repoRoot: "/work/argus")
    store.addReviewComment(Self.comment("a.ts", 1...1, "One"), sessionId: "s-1")
    store.addReviewComment(Self.comment("b.ts", 2...2, "Two"), sessionId: "s-1")

    let agentId = await store.sendReview(sessionId: "s-1", defaults: AgentStartDefaults())

    #expect(agentId == "a-1")
    let params = try #require(backend.params(.agentsSend))
    #expect(params["agent_id"] as? String == "a-1")
    #expect((params["message"] as? String)?.contains("## 2. b.ts:2") == true)
    #expect((params["display_text"] as? String)?.hasPrefix("Review: 2 comments on 2 files") == true)
    #expect(store.reviews.comments("s-1").isEmpty)
  }
}

@Suite("Diff review on a parsed diff")
struct ParsedDiffReviewTests {
  @Test("a tapped removed line comments on the old side and finds itself again")
  func removedLine() throws {
    let diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n-let x = 0\n+let x = 1\n same\n"
    let file = try #require(DiffParser.parse(diff).first)
    let hunk = try #require(file.hunks.first)
    let removed = try #require(hunk.lines.first { $0.kind == .remove })
    let comment = try #require(DiffReviewComment.draft(path: "a.ts", hunk: hunk, line: removed, scope: "uncommitted changes"))
    #expect(comment.side == .old)
    #expect(comment.lines == 1...1)
    #expect(comment.hunk.hasPrefix("@@ -1,2 +1,2 @@\n-let x = 0\n+let x = 1"))
    #expect(comment.anchors(path: "a.ts", line: removed))
    #expect(!comment.anchors(path: "a.ts", line: try #require(hunk.lines.first { $0.kind == .add })))
  }
}
