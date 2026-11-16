import Testing

@testable import ArgusKit

@Suite("Artifact links")
struct ArtifactLinkTests {
  private func call(
    _ input: [String: JSONValue], result: String, status: RemoteToolStatus = .done, isError: Bool? = nil
  ) -> RemoteToolCall {
    RemoteToolCall(
      id: "t1", name: "Artifact", input: input, resultBlocks: [.text(result)], isError: isError, status: status)
  }

  @Test("a publish lands on the link in its result, named after its file")
  func publish() {
    let link = ArtifactLink.from(
      call(
        ["file_path": .string("/tmp/work/launch-plan.html"), "icon": .string("rocket")],
        result: "Published launch-plan.html at https://claude.ai/code/artifact/0f6e2c1a-1b2c-4d5e-8f90-1234567890ab (version 1)."))
    #expect(link?.url.absoluteString == "https://claude.ai/code/artifact/0f6e2c1a-1b2c-4d5e-8f90-1234567890ab")
    #expect(link?.title == "launch-plan")
    #expect(link?.action == .publish)
  }

  @Test("an open lands on its link")
  func open() {
    let link = ArtifactLink.from(
      call(
        ["action": .string("open"), "url": .string("https://claude.ai/artifact/abc123")],
        result: "Opened the Artifact at https://claude.ai/artifact/abc123 for the user. Nothing was published or changed."))
    #expect(link?.url.absoluteString == "https://claude.ai/artifact/abc123")
    #expect(link?.action == .open)
  }

  @Test("nothing to show before it finishes, when it failed, or for other actions")
  func nothingToShow() {
    let published = "Published a.html at https://claude.ai/artifact/abc123"
    #expect(ArtifactLink.from(call([:], result: published, status: .running)) == nil)
    #expect(ArtifactLink.from(call([:], result: published, isError: true)) == nil)
    #expect(ArtifactLink.from(call(["action": .string("read")], result: published)) == nil)
    #expect(ArtifactLink.from(call(["asset": .bool(true)], result: published)) == nil)
    #expect(ArtifactLink.from(call([:], result: "Published a.html at https://example.com/page")) == nil)
  }
}
