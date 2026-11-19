package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.SessionPullRequest
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SessionFactsTest {
  private fun named(name: String? = null, base: String? = null) = session("s1", branch = "fix-login", name = name, base = base)

  @Test
  fun titles() {
    assertEquals("Fix login", SessionActivity.title(named("Fix login")))
    assertEquals("fix-login", SessionActivity.subtitle(named("Fix login")))
    assertEquals("fix-login", SessionActivity.title(named("")))
    assertNull(SessionActivity.subtitle(named()))
  }

  @Test
  fun gitFacts() {
    val activity = SessionActivity(named(base = "main"), emptyList())
    assertEquals(listOf("Base"), activity.facts(null).map { it.label })
    val quiet = activity.facts(git(additions = 0, deletions = 0))
    assertEquals(listOf("Base", "Changes", "Upstream"), quiet.map { it.label })
    assertEquals(SessionFact.Value.Text("None"), quiet[1].value)
    val busy = activity.facts(git(additions = 4, deletions = 1, dirty = 1, behind = 2, conflicts = 3))
    assertEquals(listOf("Base", "Changes", "Uncommitted", "Upstream", "Conflicts"), busy.map { it.label })
    assertEquals(SessionFact.Value.Changes(4, 1), busy[1].value)
    assertEquals(SessionFact.Value.Text("1 file"), busy[2].value)
    assertEquals(SessionFact.Emphasis.Warning, busy[3].emphasis)
    assertEquals(SessionFact.Emphasis.Danger, busy[4].emphasis)
  }

  @Test
  fun pullRequestFact() {
    val s = named(base = "main").copy(
      pullRequest = SessionPullRequest(42.0, SessionPullRequestState.open, "https://github.com/o/r/pull/42"),
    )
    val facts = SessionActivity(s, emptyList()).facts(null)
    assertEquals(listOf("Base", "Pull request"), facts.map { it.label })
    assertEquals(
      SessionFact.Value.PullRequest(SessionPullRequest(42.0, SessionPullRequestState.open, "https://github.com/o/r/pull/42")),
      facts[1].value,
    )
  }
}
