import ArgusKit
import Testing

@testable import ArgusCore

@Suite("Git failure")
struct GitFailureTests {
  @Test("a rejected push offers pull-then-push and a lease-protected force push")
  func nonFastForward() {
    let failure = GitFailure.classify(
      "! [rejected] main -> main (fetch first)\nerror: failed to push some refs to 'origin'")
    #expect(failure.kind == .nonFastForward)
    #expect(failure.recovery == "pull-then-push")
    #expect(failure.actions(canRetry: true) == [.pullThenPush, .forceWithLease])
    #expect(failure.actions(canRetry: false).isEmpty)
  }

  @Test("GroveKit's plain-language messages classify like git's own text")
  func groveKitWording() {
    #expect(GitFailure.classify("The remote has commits you don't have yet. Pull them first, then push again.").kind == .nonFastForward)
    #expect(GitFailure.classify("Couldn't reach the remote. Check your internet connection.").kind == .networkTimeout)
    #expect(GitFailure.classify("There are conflicts to resolve. Fix the conflicted files, then continue.", operation: "rebase").kind == .rebaseConflict)
    #expect(GitFailure.classify("fatal: The current branch topic has no upstream branch.").actions(canRetry: true) == [.publishBranch])
  }

  @Test("a branch named after a conflict isn't a conflict")
  func conflictWordInName() {
    #expect(GitFailure.classify("error: pathspec 'conflict-b' did not match").kind == .unknown)
  }

  @Test("the host's GitError payload is read from the wire error's data")
  func hostPayload() {
    let error = Transport.TransportError.gateway(
      GatewayErrorPayload(
        code: "bad_request", message: "Branch has no upstream configured",
        data: .object([
          "__gitError": .bool(true), "kind": .string("no-upstream"), "message": .string("Branch has no upstream configured"),
          "recovery": .string("publish-branch"), "stderr": .string("fatal: no upstream"),
        ])))
    let failure = GitFailure(error: error)
    #expect(failure?.kind == .noUpstream)
    #expect(failure?.recovery == "publish-branch")
    #expect(failure?.details == "fatal: no upstream")
    #expect(GitFailure(error: Transport.TransportError.timedOut) == nil)
  }
}
