package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.agents.AgentMcpServers
import dev.houwert.argus.core.agents.AgentMcpServers.Server
import dev.houwert.argus.core.agents.AgentMcpServers.State
import dev.houwert.argus.core.agents.McpServerActivity
import dev.houwert.argus.core.git.TimelineRestore
import dev.houwert.argus.core.git.TimelineTurn
import dev.houwert.argus.core.sessions.SessionFact
import dev.houwert.argus.core.sessions.SetupStep
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionDeleteFailed
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionProgress
import dev.houwert.argus.kit.protocol.generated.RemoteSessionProgressPhase
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.generated.RemoteStoppedAgent
import dev.houwert.argus.kit.protocol.generated.RemoteTerminal
import dev.houwert.argus.kit.protocol.generated.SessionPullRequest
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import dev.houwert.argus.ui.agent.AgentMcpServersView
import dev.houwert.argus.ui.agent.McpServerCallbacks
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.session.RecentChatRow
import dev.houwert.argus.ui.session.SessionDeletingView
import dev.houwert.argus.ui.session.SessionFactRow
import dev.houwert.argus.ui.session.SetupFailedActions
import dev.houwert.argus.ui.session.SetupFailedRow
import dev.houwert.argus.ui.session.SetupPendingRow
import dev.houwert.argus.ui.session.SetupProgressCard
import dev.houwert.argus.ui.session.TimelineRestoreRow
import dev.houwert.argus.ui.session.TimelineTurnRow
import dev.houwert.argus.ui.terminals.SessionTerminalsList
import dev.houwert.argus.ui.terminals.TerminalOutputState
import dev.houwert.argus.ui.terminals.TerminalOutputView

private val now = System.currentTimeMillis().toDouble()
private const val MINUTE = 60_000.0

private fun session(
  status: RemoteSessionStatus = RemoteSessionStatus.ready,
  setupError: String? = null,
  deleteFailed: RemoteSessionDeleteFailed? = null,
  progress: RemoteSessionProgress? = null,
) = RemoteSession(
  id = "s-1",
  repoRoot = "/Users/sam/Projects/argus",
  kind = RemoteSessionKind.worktree,
  branch = "feat/unify-start-composer",
  status = status,
  setupError = setupError,
  deleteFailed = deleteFailed,
  progress = progress,
)

private val failedClone = """
  Preparing worktree (new branch 'feat/unify-start-composer')
  HEAD is now at 3f2c1d9 fix(remote): keep the pairing sheet open
  copy .env.local
  symlink node_modules
  > pnpm install --frozen-lockfile
  ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with packages/host/package.json
""".trimIndent()

private val rowPadding = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)
private val noop: suspend () -> Unit = {}
private val failedActions = SetupFailedActions(noop, noop, noop, noop)

@Composable
internal fun SessionGalleryPage() {
  Story("Setup progress") {
    SetupProgressCard(session(RemoteSessionStatus.initializing), step = null)
    SetupProgressCard(
      session(RemoteSessionStatus.initializing),
      SetupStep(current = 3.0, total = 7.0, item = "packages/host/node_modules", phase = "symlink"),
    )
    SetupProgressCard(
      session(RemoteSessionStatus.initializing),
      SetupStep(6.0, 7.0, item = "pnpm install", phase = "command", detail = "Progress: resolved 1423, reused 1398, downloaded 25"),
    )
  }
  Story("Setup pending") { SetupPendingRow(hasControl = true, runSetup = noop, skip = noop) }
  Story("Setup failed") {
    SetupFailedRow(session(RemoteSessionStatus.error, setupError = failedClone), hasControl = true, actions = failedActions)
    SetupFailedRow(
      session(RemoteSessionStatus.error, "rm: .turbo: Permission denied", RemoteSessionDeleteFailed.teardown),
      hasControl = true,
      actions = failedActions,
    )
    SetupFailedRow(
      session(RemoteSessionStatus.error, "EBUSY: resource busy or locked", RemoteSessionDeleteFailed.remove),
      hasControl = false,
      actions = failedActions,
    )
  }
  Story("Deleting") {
    SessionDeletingView(RemoteSessionProgress(1.0, 3.0, RemoteSessionProgressPhase("teardown"), "docker compose down --volumes"))
    SessionDeletingView(RemoteSessionProgress(412.0, 1180.0))
    SessionDeletingView(null)
  }
  Story("Timeline") {
    ListSection {
      TimelineTurnRow(TimelineTurn(7, "c7", "a1", "Claude", "Move the start composer's model picker into the toolbar", now - 2 * MINUTE, finished = false), rowPadding)
      TimelineRestoreRow(TimelineRestore("r2", "c5", 5, now - 9 * MINUTE, canUndo = true), rowPadding, undo = {})
      TimelineTurnRow(TimelineTurn(6, "c6", "a1", "Claude", "Fix the composer losing its draft when the session reloads", now - 14 * MINUTE, files = 4, additions = 128, deletions = 37), rowPadding)
      TimelineTurnRow(TimelineTurn(5, "c5", "a2", "Codex", "Add a test for the draft store", now - 40 * MINUTE, files = 1, additions = 52), rowPadding)
      TimelineRestoreRow(TimelineRestore("r1", "c2", 2, now - 70 * MINUTE, undoneAt = now - 65 * MINUTE, canUndo = false), rowPadding)
      TimelineTurnRow(TimelineTurn(4, "c4", "a1", "Claude", "", now - 3 * 60 * MINUTE), rowPadding)
      TimelineTurnRow(TimelineTurn(3, "c3", "a1", null, "Explain why the build fails on CI", now - 26 * 60 * MINUTE, available = false), rowPadding)
    }
  }
  Story("MCP servers") {
    val servers = AgentMcpServers(
      listOf(
        Server("github", State.Connected, "user", 42, null),
        Server("claude.ai Linear", State.NeedsAuth, "claudeai", null, null),
        Server("figma", State.Failed, "project", null, "connect ECONNREFUSED 127.0.0.1:3845"),
        Server("plugin:playwright:browser", State.Pending, "plugin", null, null),
        Server("sentry", State.Disabled, "user", 18, null),
        Server("postgres", State.Connected, "local", 1, null),
      ),
      accountId = "acc-2",
    )
    val callbacks = McpServerCallbacks(act = { _, _, _ -> null }, dismiss = {}, retry = {})
    Box(Modifier.height(470.dp)) {
      AgentMcpServersView(
        servers,
        error = null,
        accountName = "sam@work.dev",
        hasControl = true,
        activity = { if (it == "postgres") McpServerActivity.SigningIn("https://example.com/oauth", callbackExpected = true) else null },
        callbacks = callbacks,
      )
    }
    Box(Modifier.height(320.dp)) {
      AgentMcpServersView(null, "The agent stopped before it could report its servers.", null, true, { null }, callbacks)
    }
  }
  Story("Terminals") {
    Box(Modifier.height(200.dp)) {
      SessionTerminalsList(
        listOf(RemoteTerminal("t1", runTitle = "Dev server"), RemoteTerminal("t2", title = "zsh"), RemoteTerminal("t3")),
        open = {},
      )
    }
    Box(Modifier.height(300.dp)) { SessionTerminalsList(emptyList(), open = {}) }
    Box(Modifier.height(240.dp)) {
      TerminalOutputView(
        TerminalOutputState(
          text = "  VITE v7.1.2  ready in 412 ms\n\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host to expose\n" +
            "12:04:31 [vite] hmr update /src/App.tsx\n12:04:40 [vite] page reload src/main.tsx\n",
          truncated = true,
          exitCode = 1,
        ),
      )
    }
  }
  Story("Details rows") {
    ListSection(header = "Status") {
      SessionFactRow(SessionFact("Base", SessionFact.Value.Ref("main")))
      SessionFactRow(
        SessionFact("Pull request", SessionFact.Value.PullRequest(SessionPullRequest(1284.0, SessionPullRequestState.open, "https://github.com/acme/argus/pull/1284"))),
      )
      SessionFactRow(SessionFact("Changes", SessionFact.Value.Changes(214, 58)))
      SessionFactRow(SessionFact("Upstream", SessionFact.Value.Text("2 behind"), SessionFact.Emphasis.Warning))
      SessionFactRow(SessionFact("Last activity", SessionFact.Value.Age(now - 25 * MINUTE)))
    }
    ListSection(header = "Agents") {
      RecentChatRow(chat("Review the pairing flow", 37, 12), onClick = {})
      RecentChatRow(chat("Write the changeset", 4, 180), onClick = {})
    }
  }
}

private fun chat(title: String, messages: Long, minutesAgo: Int) = RemoteStoppedAgent(
  historyId = "h-$title",
  runnerSessionId = "r-$title",
  title = title,
  branch = "feat/unify-start-composer",
  messageCount = messages,
  startedAt = now - (minutesAgo + 30) * MINUTE,
  endedAt = now - minutesAgo * MINUTE,
)
