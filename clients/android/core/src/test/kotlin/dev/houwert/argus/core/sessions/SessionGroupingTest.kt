package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusAwaiting
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val running = RemoteAgentStatusStatus.running

class SessionActivityTest {
  @Test
  fun readyStates() {
    val ready = session("s1")
    assertEquals(SessionActivity.State.Idle, SessionActivity(ready, emptyList()).state)
    assertEquals(SessionActivity.State.Working, SessionActivity(ready, listOf(agent("a", status = running))).state)
    assertEquals(
      SessionActivity.State.Waiting,
      SessionActivity(ready, listOf(agent("a", status = running, awaiting = RemoteAgentStatusAwaiting.permission))).state,
    )
    assertFalse(SessionActivity(ready, listOf(agent("a"))).showsDot)
    assertEquals("1 agent", SessionActivity(ready, listOf(agent("a"))).statusText)
  }

  @Test
  fun lifecycle() {
    val setting = SessionActivity(session("s1", status = RemoteSessionStatus.initializing), emptyList())
    assertTrue(setting.state == SessionActivity.State.Preparing && setting.showsDot && setting.isBusy)
    assertEquals("Setting up", setting.statusText)
    val deleting = SessionActivity(session("s1", status = RemoteSessionStatus.deleting), emptyList())
    assertEquals("Deleting", deleting.statusText)
    assertFalse(deleting.showsDot)
    val failed = SessionActivity(session("s1", status = RemoteSessionStatus.error, setupError = "npm failed"), emptyList())
    assertTrue(failed.state == SessionActivity.State.Failed && failed.statusText == "npm failed")
    assertEquals("Setup failed", SessionActivity.statusLabel(RemoteSessionStatus.error))
    assertNull(SessionActivity.statusLabel(RemoteSessionStatus.ready))
  }

  @Test
  fun unavailable() {
    val activity = SessionActivity(
      session("s1", status = RemoteSessionStatus.error, unavailable = true),
      listOf(agent("a", status = running)),
    )
    assertEquals(SessionActivity.State.Unavailable, activity.state)
  }

  @Test
  fun lastActive() {
    val activity = SessionActivity(session("s1"), listOf(agent("a", created = 5.0), agent("b", created = 1.0, active = 9.0)))
    assertEquals(9.0, activity.lastActive)
  }
}

class AgentOrderTest {
  @Test
  fun wraps() {
    val ids = listOf("a", "b", "c")
    assertEquals("b", AgentOrder.cycled(ids, "a", 1))
    assertEquals("a", AgentOrder.cycled(ids, "c", 1))
    assertEquals("c", AgentOrder.cycled(ids, "a", -1))
  }

  @Test
  fun arranged() {
    val agents = listOf(agent("a", created = 1.0), agent("b", created = 2.0), agent("c", created = 3.0), agent("d", created = 4.0))
    fun ids(order: List<String>?) = AgentOrder.arranged(agents, order).map { it.agentId }
    assertEquals(listOf("a", "b", "c", "d"), ids(null))
    assertEquals(listOf("c", "a", "b", "d"), ids(listOf("c", "a", "b")))
    assertEquals(listOf("b", "a", "c", "d"), ids(listOf("gone", "b", "a")))
  }

  @Test
  fun moved() {
    val ids = listOf("a", "b", "c", "d")
    assertEquals(listOf("b", "c", "a", "d"), AgentOrder.moved("a", "c", ids))
    assertEquals(listOf("a", "d", "b", "c"), AgentOrder.moved("d", "b", ids))
    assertNull(AgentOrder.moved("a", "a", ids))
    assertNull(AgentOrder.moved("gone", "a", ids))
  }

  @Test
  fun nothingToCycle() {
    assertNull(AgentOrder.cycled(listOf("a"), "a", 1))
    assertNull(AgentOrder.cycled(listOf("a", "b"), null, 1))
    assertNull(AgentOrder.cycled(listOf("a", "b"), "gone", 1))
  }

  @Test
  fun overlayBeforeSort() {
    val listed = listOf(agent("a", active = 10.0), agent("b", active = 5.0))
    val live = mapOf("b" to agent("b", status = running, active = 5.0))
    val sorted = AgentOrder.byActivity(AgentOrder.overlaid(listed, live))
    assertEquals(listOf("b", "a"), sorted.map { it.agentId })
    assertEquals(running, sorted.first().status)
  }

  @Test
  fun byActivity() {
    val agents = listOf(
      agent("idle", active = 100.0),
      agent("run", status = running, active = 1.0),
      agent("ask", status = running, active = 0.0, awaiting = RemoteAgentStatusAwaiting.question),
    )
    assertEquals(listOf("ask", "run", "idle"), AgentOrder.byActivity(agents).map { it.agentId })
  }

  @Test
  fun sessionTabsKeepStopped() {
    val listed = listOf(agent("live", created = 2.0), agent("old", created = 0.0))
    val stopped = mapOf(
      "shut" to agent("shut", status = RemoteAgentStatusStatus.stopped, created = 1.0),
      "old" to agent("old", status = RemoteAgentStatusStatus.stopped),
    )
    val tabs = AgentOrder.sessionTabs(listed, listOf("shut"), { stopped[it] }, { it in stopped })
    assertEquals(listOf("shut", "live"), tabs.map { it.agentId })
  }

  @Test
  fun neighbour() {
    assertEquals("a", AgentOrder.neighbour("b", listOf("a", "b", "c")))
    assertEquals("b", AgentOrder.neighbour("a", listOf("a", "b")))
    assertNull(AgentOrder.neighbour("a", listOf("a")))
  }
}

class SessionGroupTest {
  @Test
  fun order() {
    val sessions = listOf(session("w1"), session("root", kind = RemoteSessionKind.projectRoot), session("w2", name = "Two"))
    val agents = listOf(agent("x", session = "gone"), agent("a", session = "w2"))
    val groups = SessionGroup.make(sessions, agents)
    assertEquals(listOf("root", "w1", "w2", "gone"), groups.map { it.id })
    assertEquals("Two", groups[2].label)
    assertTrue(groups[3].label == "Session" && groups[3].session == null)
  }

  @Test
  fun agentsInSession() {
    val agents = listOf(agent("late", session = "w1", created = 2.0), agent("early", session = "w1", created = 1.0))
    val live = mapOf("late" to agent("late", session = "w1", status = running, created = 2.0))
    val group = SessionGroup.make(listOf(session("w1")), agents, live)[0]
    assertEquals(listOf("early", "late"), group.agents.map { it.agentId })
    assertEquals(running, group.agents[1].status)
  }
}

class SessionSearchTest {
  @Test
  fun matches() {
    val s = session("1", name = "Fix login")
    assertTrue(SessionSearch.matches(s, "Argus", "LOGIN"))
    assertTrue(SessionSearch.matches(s, "Argus", "b-1"))
    assertTrue(SessionSearch.matches(s, "Argus", "argus"))
    assertFalse(SessionSearch.matches(s, "Argus", "  "))
  }

  @Test
  fun visible() {
    val worktrees = listOf(session("a"), session("b"))
    assertEquals(2, SessionSearch.visibleWorktrees(worktrees, null, collapsed = false).size)
    assertTrue(SessionSearch.visibleWorktrees(worktrees, null, collapsed = true).isEmpty())
    assertEquals(listOf("b"), SessionSearch.visibleWorktrees(worktrees, setOf("b"), collapsed = true).map { it.id })
  }

  @Test
  fun ordered() {
    val items = listOf("p1" to "h2", "p2" to "x", "p3" to "h1", "p4" to "h2")
    val sorted = SessionSearch.ordered(items, listOf("h1", "h2")) { it.second }
    assertEquals(listOf("p3", "p1", "p4", "p2"), sorted.map { it.first })
  }
}

class GitUpstreamTextTest {
  @Test
  fun describe() {
    assertEquals("Not pushed", GitUpstreamText.describe(git(upstream = null)))
    assertEquals("Up to date with origin/main", GitUpstreamText.describe(git(upstream = "origin/main")))
    assertEquals("↑2 ↓1 origin/main", GitUpstreamText.describe(git(upstream = "origin/main", ahead = 2, behind = 1)))
    assertFalse(GitUpstreamText.isNoteworthy(git(upstream = "origin/main")))
  }
}

class SessionGroupingTest {
  private fun project(root: String, name: String) = RemoteProject(repoRoot = root, name = name)

  @Test
  fun placement() {
    val projects = listOf(project("/r", "app"), project("/other", "app"), project("/solo", "solo"))
    val recent = listOf(agent("a", session = "s1", projectName = "app"), agent("b", session = "x", projectName = "solo"))
    var grouping = SessionGrouping(projects = projects, recentAgents = recent)
    // Two projects called "app": no guessing until the sessions say.
    assertTrue(grouping.agentsInProject("/r").isEmpty())
    assertEquals(listOf("b"), grouping.agentsInProject("/solo").map { it.agentId })
    grouping = grouping.copy(sessionsByRepo = mapOf("/r" to listOf(session("s1"))))
    assertEquals(listOf("a"), grouping.agentsInProject("/r").map { it.agentId })
    assertTrue(grouping.agentsInProject("/other").isEmpty())
  }

  @Test
  fun recentByActivity() {
    val grouping = SessionGrouping(
      recentAgents = listOf(agent("a", active = 10.0), agent("b", active = 1.0)),
      statusByAgent = mapOf("b" to agent("b", status = running, active = 1.0)),
    )
    assertEquals(listOf("b", "a"), grouping.recentAgentsByActivity.map { it.agentId })
  }

  @Test
  fun sessionGroupsOverlayLiveStatusAndKeepTheRootFirst() {
    val grouping = SessionGrouping(
      projects = listOf(project("/r", "app")),
      sessionsByRepo = mapOf("/r" to listOf(session("w1"), session("root", kind = RemoteSessionKind.projectRoot))),
      agentsByRepo = mapOf("/r" to listOf(agent("a", session = "w1"))),
      recentAgents = listOf(agent("late", session = "w1", created = 3.0)),
      statusByAgent = mapOf("a" to agent("a", session = "w1", status = running)),
    )
    val groups = grouping.sessionGroups("/r")
    assertEquals(listOf("root", "w1"), groups.map { it.id })
    assertEquals(listOf("a", "late"), groups[1].agents.map { it.agentId })
    assertEquals(running, groups[1].agents[0].status)
    assertEquals(listOf("a", "late"), grouping.agentsInSession("w1", "/r").map { it.agentId })
    assertEquals("/r", grouping.repoRootOfAgent(agent("z", session = "?", projectName = "app")) { null })
  }
}
