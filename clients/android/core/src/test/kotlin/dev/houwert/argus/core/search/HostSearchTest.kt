package dev.houwert.argus.core.search

import dev.houwert.argus.core.routing.ArgusRoute
import dev.houwert.argus.core.sessions.agent
import dev.houwert.argus.core.sessions.session
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HostSearchTest {
  private val agentResult = HostSearch.agent(
    agent("a1", session = "s1", projectName = "Storefront").copy(title = "Fix login redirect", sessionLabel = "checkout-flow"),
    "/r/storefront",
  )
  private val sessionResult = HostSearch.session(session("s2", branch = "feat/new-settings", name = "Settings redesign"), "Argus")
  private val teammateResult = HostSearchResult(
    HostSearchResult.Kind.Teammate, "t1", "Reviewer", "@rex · Reads every pull request",
    listOf("rex", "Reads every pull request"), null, null, ArgusRoute.Teammate("t1"),
  )
  private val items = listOf(agentResult, sessionResult, teammateResult)

  @Test fun emptyQueryMatchesNothing() {
    assertTrue(HostSearch.results("  ", items).isEmpty())
  }

  @Test fun matchesNamesBranchesProjectsAndHandles() {
    assertEquals(listOf("agent:a1"), HostSearch.results("login", items).map { it.id })
    assertEquals(listOf("session:s2"), HostSearch.results("new-settings", items).map { it.id })
    assertEquals(listOf("agent:a1"), HostSearch.results("storefront", items).map { it.id })
    assertEquals(listOf("teammate:t1"), HostSearch.results("rex", items).map { it.id })
  }

  @Test fun wordStartsRankFirstAsInThePalette() {
    assertEquals("session:s2", HostSearch.results("set", items).first().id)
  }

  @Test fun eachResultOpensItsRoute() {
    assertEquals(ArgusRoute.Session("s1", "a1"), agentResult.route)
    assertEquals(ArgusRoute.Session("s2", null), sessionResult.route)
    assertEquals(ArgusRoute.Teammate("t1"), teammateResult.route)
  }

  @Test fun groupsByKindBestFirstWithoutDuplicates() {
    val results = HostSearch.results("r", items + agentResult)
    assertEquals(1, results.count { it.id == "agent:a1" })
    assertEquals(results.first().kind, HostSearch.grouped(results).first().first)
  }

  @Test fun sessionSubtitleNamesPlaceAndBranch() {
    assertEquals("Settings redesign", sessionResult.title)
    assertEquals("Argus · feat/new-settings", sessionResult.subtitle)
  }

  @Test fun scoresMatchTheMacPalette() {
    // "ns" ranks New Session above Agents, as PaletteMatchTests expects on the Mac.
    assertEquals(listOf("New Session", "Agents"), PaletteMatch.rank(listOf("Agents", "New Session"), "ns") { listOf(it) })
  }
}
