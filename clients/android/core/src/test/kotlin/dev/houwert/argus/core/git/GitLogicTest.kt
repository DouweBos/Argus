package dev.houwert.argus.core.git

import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.GatewayErrorPayload
import dev.houwert.argus.kit.protocol.generated.RemoteSessionTurn
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Test

class SessionDiffScopeTest {
  private val turns = listOf(
    RemoteSessionTurn(1, "a", "x", "First", 1.0),
    RemoteSessionTurn(2, "b", "x", "Second", 2.0),
  )

  @Test fun readsItsModeBack() {
    for (scope in listOf(SessionDiffScope.Uncommitted, SessionDiffScope.Branch, SessionDiffScope.LastTurn, SessionDiffScope.Turn(turns[0]))) {
      assertEquals(scope, SessionDiffScope.fromMode(scope.mode, turns))
    }
  }

  @Test fun aTurnThatsGoneReadsAsTheLastTurn() {
    assertEquals(SessionDiffScope.LastTurn, SessionDiffScope.fromMode("turn:gone", turns))
  }

  @Test fun wiresAPinnedTurnAsItsCheckpoint() {
    assertEquals("turn" to "b", SessionDiffScope.wire("turn:b"))
    assertEquals("working" to null, SessionDiffScope.wire("working"))
  }

  @Test fun reviewCommentsNameTheTurnByNumber() {
    assertEquals("changes from turn 2", SessionDiffScope.LastTurn.reviewScope(turns))
    assertEquals("changes from turn 1", SessionDiffScope.Turn(turns[0]).reviewScope(turns))
  }
}

class GitFailureTest {
  @Test fun aRejectedPushOffersPullThenPushAndALeaseProtectedForcePush() {
    val failure = GitFailure.classify("! [rejected] main -> main (fetch first)\nerror: failed to push some refs to 'origin'")
    assertEquals(GitFailure.Kind.NonFastForward, failure.kind)
    assertEquals("pull-then-push", failure.recovery)
    assertEquals(listOf(GitFailure.Action.PullThenPush, GitFailure.Action.ForceWithLease), failure.actions(canRetry = true))
    assertTrue(failure.actions(canRetry = false).isEmpty())
  }

  @Test fun plainLanguageMessagesClassifyLikeGitsOwnText() {
    assertEquals(GitFailure.Kind.NonFastForward, GitFailure.classify("The remote has commits you don't have yet. Pull them first, then push again.").kind)
    assertEquals(GitFailure.Kind.NetworkTimeout, GitFailure.classify("Couldn't reach the remote. Check your internet connection.").kind)
    assertEquals(
      GitFailure.Kind.RebaseConflict,
      GitFailure.classify("There are conflicts to resolve. Fix the conflicted files, then continue.", operation = "rebase").kind,
    )
    assertEquals(listOf(GitFailure.Action.PublishBranch), GitFailure.classify("fatal: The current branch topic has no upstream branch.").actions(canRetry = true))
  }

  @Test fun aBranchNamedAfterAConflictIsntAConflict() {
    assertEquals(GitFailure.Kind.Unknown, GitFailure.classify("error: pathspec 'conflict-b' did not match").kind)
  }

  @Test fun theHostsGitErrorPayloadIsReadFromTheWireErrorsData() {
    val data = buildJsonObject {
      put("__gitError", JsonPrimitive(true))
      put("kind", JsonPrimitive("no-upstream"))
      put("message", JsonPrimitive("Branch has no upstream configured"))
      put("recovery", JsonPrimitive("publish-branch"))
      put("stderr", JsonPrimitive("fatal: no upstream"))
    }
    val failure = GitFailure.from(TransportException.Gateway(GatewayErrorPayload("bad_request", "Branch has no upstream configured", data)))
    assertEquals(GitFailure.Kind.NoUpstream, failure?.kind)
    assertEquals("publish-branch", failure?.recovery)
    assertEquals("fatal: no upstream", failure?.details)
    assertNull(GitFailure.from(TransportException.TimedOut()))
  }
}

class BaseBranchChoiceTest {
  @Test fun theConfiguredDefaultWinsAsALocalBranch() {
    assertEquals("staging", BaseBranchChoice.preselected(listOf("main", "staging"), listOf("origin/main"), "staging", emptyList(), null))
  }

  @Test fun theRemoteTipOverALocalCopyTheProjectRootHasCheckedOut() {
    assertEquals("origin/main", BaseBranchChoice.preselected(listOf("main", "feature"), listOf("origin/main"), null, emptyList(), "main"))
  }

  @Test fun noBaseLikeBranchFallsBackToTheFirstLocalOne() {
    assertEquals("feature", BaseBranchChoice.preselected(listOf("feature"), emptyList(), null, emptyList(), null))
    assertNull(BaseBranchChoice.preselected(emptyList(), emptyList(), null, emptyList(), null))
  }

  @Test fun onlyBaseLikeRemoteRefsAreOffered() {
    assertEquals(
      listOf("main", "feature", "origin/main", "origin/release"),
      BaseBranchChoice.options(listOf("main", "feature"), listOf("origin/main", "origin/someone-else", "origin/release"), listOf("release")),
    )
  }
}
