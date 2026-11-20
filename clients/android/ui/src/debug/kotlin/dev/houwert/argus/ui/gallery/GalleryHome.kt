package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.code.FuzzyFileMatcher
import dev.houwert.argus.core.compare.CompareGroup
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.kit.protocol.generated.CodeSearchMatch
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteGitStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.generated.SessionPullRequest
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import dev.houwert.argus.ui.code.CodeView
import dev.houwert.argus.ui.files.FileSearchGroupHeader
import dev.houwert.argus.ui.files.FileSearchMatchRow
import dev.houwert.argus.ui.files.FuzzyFileRow
import dev.houwert.argus.ui.sessions.CompareRunHeaderRow
import dev.houwert.argus.ui.sessions.FoldedSessionsLabel
import dev.houwert.argus.ui.sessions.ProjectRootState
import dev.houwert.argus.ui.sessions.SessionRow
import dev.houwert.argus.ui.sessions.SidebarSectionHeader
import dev.houwert.argus.ui.syntax.SyntaxLanguage
import dev.houwert.argus.ui.usage.UsageLimitsStrip

private val now = System.currentTimeMillis().toDouble()

private fun session(id: String, branch: String, name: String? = null, status: RemoteSessionStatus = RemoteSessionStatus.ready, pr: SessionPullRequestState? = null) =
  RemoteSession(
    id = id, repoRoot = "/r/argus", kind = RemoteSessionKind.worktree, branch = branch, status = status, displayName = name,
    pullRequest = pr?.let { SessionPullRequest(412.0, it, "https://github.com/acme/argus/pull/412") },
  )

private fun agent(session: String, status: RemoteAgentStatusStatus, minutes: Int) =
  RemoteAgentStatus(agentId = "a-$session", sessionId = session, status = status, lastActivityAt = now - minutes * 60_000)

private val git = RemoteGitStatus("fix-merge", ahead = 2.0, behind = 1.0, dirtyCount = 0.0, stashCount = 0.0, conflictCount = 0.0, detached = false, upstream = "origin/fix-merge", diffAdditions = 120.0, diffDeletions = 18.0)

private const val SAMPLE = """import SwiftUI

/// A greeting.
struct Greeter {
  let name: String
  func greet() -> String { "Hello, \(name)!" }
}
"""

@Composable
internal fun HomePage() {
  Story("Plan limits") {
    SidebarSectionHeader("Plan limits")
    UsageLimitsStrip(UsageFixtures.limits, Modifier.padding(vertical = 4.dp))
    SidebarSectionHeader("Plan limits, several accounts")
    UsageLimitsStrip(UsageFixtures.pooledLimits, Modifier.padding(vertical = 4.dp))
  }
  Story("Session rows") {
    SidebarSectionHeader("Needs you")
    SessionRow(session("s1", "fix-merge", "Fix the flaky merge test"), listOf(agent("s1", RemoteAgentStatusStatus.requiresAction, 3)), git = git, detailed = true)
    SessionRow(session("s2", "start-composer", "Unify the start composer", pr = SessionPullRequestState.open), listOf(agent("s2", RemoteAgentStatusStatus.running, 1)))
    SessionRow(session("s3", "stack-child", "Stacked follow-up"), emptyList(), indent = 1, stacked = true, caption = "On top of start-composer")
    SessionRow(session("s4", "setup", "Setting up a worktree", status = RemoteSessionStatus.initializing), emptyList())
    SessionRow(session("s5", "broken", status = RemoteSessionStatus.error).copy(setupError = "npm install failed"), emptyList())
    CompareRunHeaderRow(CompareGroup("c1", listOf(session("c1a", "cmp-a", "Rewrite the parser"), session("c1b", "cmp-b", "Rewrite the parser"))))
    FoldedSessionsLabel("2 done · 1 snoozed", expanded = false)
    ProjectRootState(SessionActivity(session("root", "main"), listOf(agent("root", RemoteAgentStatusStatus.running, 0))), "main")
  }
  Story("Quick open and search rows") {
    val match = FuzzyFileMatcher(listOf("clients/android/ui/src/main/kotlin/CodeView.kt")).search("cv").first()
    FuzzyFileRow(match)
    FuzzyFileRow(match.copy(isBoosted = true))
    FileSearchGroupHeader("packages/host/src/services/session/watcher.ts", 3)
    FileSearchMatchRow(CodeSearchMatch("watcher.ts", line = 42, column = 10, length = 7, preview = "    const watcher = chokidar.watch(path)", previewOffset = 0))
  }
  Story("Code view") {
    Box(Modifier.height(180.dp).padding(vertical = 4.dp)) { CodeView(SAMPLE, SyntaxLanguage.Swift, focusLine = 5) }
  }
}
