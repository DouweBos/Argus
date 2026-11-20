package dev.houwert.argus.ui

import dev.houwert.argus.core.agents.AgentMcpServers.Server
import dev.houwert.argus.core.agents.AgentMcpServers.State
import dev.houwert.argus.core.agents.McpServerActivity
import dev.houwert.argus.core.git.TimelineRestore
import dev.houwert.argus.core.sessions.SetupStep
import dev.houwert.argus.core.stores.McpServerAction
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionDeleteFailed
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionProgress
import dev.houwert.argus.kit.protocol.generated.RemoteSessionProgressPhase
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.generated.SessionPullRequest
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import dev.houwert.argus.ui.agent.McpServerText
import dev.houwert.argus.ui.session.SessionDeletingText
import dev.houwert.argus.ui.session.SessionDetailsText
import dev.houwert.argus.ui.session.SetupFailedText
import dev.houwert.argus.ui.session.SetupProgressText
import dev.houwert.argus.ui.session.TimelineText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionPanelsLogicTest {
  private val session = RemoteSession("s", "/r", RemoteSessionKind.worktree, "b", status = RemoteSessionStatus.initializing,
    progress = RemoteSessionProgress(1.0, 4.0))

  @Test fun setupProgressLines() {
    assertEquals("Initializing session", SetupProgressText.title(null))
    assertEquals("Preparing the worktree", SetupProgressText.stepLine(null))
    val step = SetupStep(3.0, 7.0, "node_modules", phase = "symlink")
    assertEquals("Linking", SetupProgressText.title(step))
    assertEquals("Step 3 of 7 · 4 remaining", SetupProgressText.stepLine(step))
    assertEquals(3.0 / 7.0, SetupProgressText.fraction(step, session)!!, 1e-9)
    // Without a broadcast, the listed progress stands in.
    assertEquals(0.25, SetupProgressText.fraction(null, session)!!, 1e-9)
  }

  @Test fun deletingLines() {
    val teardown = RemoteSessionProgress(1.0, 3.0, RemoteSessionProgressPhase("teardown"), "docker compose down")
    assertEquals("Running teardown commands", SessionDeletingText.title(teardown))
    assertEquals("Command 2 of 3", SessionDeletingText.stepLine(teardown))
    assertEquals("Deleting the worktree", SessionDeletingText.title(RemoteSessionProgress(5.0, 10.0)))
    assertEquals("Removing files", SessionDeletingText.stepLine(null))
  }

  @Test fun failedTitlesAndTail() {
    assertEquals("Setup failed", SetupFailedText.title(null))
    assertEquals("Teardown failed", SetupFailedText.title(RemoteSessionDeleteFailed.teardown))
    assertEquals("Delete failed", SetupFailedText.title(RemoteSessionDeleteFailed.remove))
    assertEquals("c\nd\ne\nf", SetupFailedText.tail("a\nb\nc\nd\ne\nf\n"))
  }

  @Test fun mcpPrimaryActionAndDetail() {
    assertEquals(McpServerAction.signIn, McpServerText.primary(State.NeedsAuth, true, null))
    assertEquals(McpServerAction.reconnect, McpServerText.primary(State.Failed, true, null))
    assertEquals(McpServerAction.enable, McpServerText.primary(State.Disabled, true, null))
    assertNull(McpServerText.primary(State.Failed, false, null))
    assertNull(McpServerText.primary(State.Failed, true, McpServerActivity.Working))
    assertNull(McpServerText.primary(State.Connected, true, null))

    val github = Server("github", State.Connected, "user", 1, null)
    assertEquals(listOfNotNull(github.origin, "1 tool").joinToString(" · "), McpServerText.detail(github, null, null))
    val failed = Server("figma", State.Failed, "project", null, "ECONNREFUSED")
    assertEquals("ECONNREFUSED", McpServerText.detail(failed, McpServerAction.reconnect, null))
    assertEquals("boom", McpServerText.detail(github, null, McpServerActivity.Failed("boom")))
    assertEquals("Sign in", McpServerText.title(McpServerAction.signIn))
  }

  @Test fun timelineRestoreDetail() {
    val restore = TimelineRestore("r", "c", 2, timestamp = 0.0, canUndo = true)
    assertEquals("Files only, the conversation stays · just now", TimelineText.restoreDetail(restore, now = 1_000.0))
    assertEquals("Undone just now · just now", TimelineText.restoreDetail(restore.copy(undoneAt = 500.0), now = 1_000.0))
    assertEquals("1 file", TimelineText.files(1))
  }

  @Test fun pullRequestRef() {
    assertEquals("#12", SessionDetailsText.pullRequestRef(SessionPullRequest(12.0, SessionPullRequestState.open, "https://github.com/a/b/pull/12")))
    assertEquals("!7", SessionDetailsText.pullRequestRef(SessionPullRequest(7.0, SessionPullRequestState.open, "https://gitlab.com/a/b/-/merge_requests/7")))
  }
}
