import Testing

@testable import ArgusCore

@Suite("Proposal origin")
struct ProposalOriginTests {
  @Test("a conversation's proposal opens the conversation")
  func teammateThread() {
    let origin = ProposalOrigin(automationId: "teammate-chat:ci-fixer", runId: "thread:th1")
    #expect(origin == .teammateThread(teammateId: "ci-fixer", threadId: "th1"))
    #expect(origin?.route == .teammate(id: "ci-fixer", page: .chat(threadId: "th1")))
  }

  @Test("an automation's proposal opens its run")
  func run() {
    let origin = ProposalOrigin(automationId: "deps", runId: "r1")
    #expect(origin == .run(automationId: "deps", runId: "r1"))
    #expect(origin?.route == .automation(id: "deps", runId: "r1"))
  }

  @Test("no run, or a malformed chat id")
  func edges() {
    #expect(ProposalOrigin(automationId: "deps", runId: nil) == nil)
    #expect(ProposalOrigin(automationId: "teammate-chat:", runId: "thread:th1") == .run(automationId: "teammate-chat:", runId: "thread:th1"))
  }
}
