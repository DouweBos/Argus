package dev.houwert.argus.core.code

import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test

class FuzzyFileMatcherTest {
  private val paths = listOf(
    "packages/host/src/services/session/watcher.ts",
    "clients/apple/ArgusCore/Sources/ArgusCore/Code/FuzzyFileMatcher.swift",
    "clients/apple/ArgusUI/Sources/ArgusUI/Views/CodeView.swift",
    "app/components/agent/AgentView.tsx",
    "docs/routing.md",
    "README.md",
    "fizz/zoom/m.swift",
  )

  @Test fun theFileNameBeatsLettersScatteredOverDirectories() {
    val matcher = FuzzyFileMatcher(paths)
    assertEquals(paths[1], matcher.search("fzm").first().path)
    assertEquals(paths[2], matcher.search("codeview").first().path)
    assertEquals("README.md", matcher.search("readme").first().path)
  }

  @Test fun wordBoundariesAndRunsBeatScatteredLetters() {
    val ranked = FuzzyFileMatcher(listOf("src/xaxgxexnxt.ts", "src/AgentView.tsx", "src/agent.ts")).search("agent").map { it.path }
    assertEquals("src/xaxgxexnxt.ts", ranked.last())
    assertEquals("src/agent.ts", ranked.first())
  }

  @Test fun nonMatchesAreDroppedAndMatchingIsCaseInsensitive() {
    val matcher = FuzzyFileMatcher(paths)
    assertTrue(matcher.search("zzzq").isEmpty())
    assertEquals(listOf(paths[0]), matcher.search("WATCHER").map { it.path })
    assertEquals(paths[3], matcher.search("agent view").first().path)
  }

  @Test fun indicesPointAtTheMatchedCharacters() {
    val match = FuzzyFileMatcher.match("cv", "Views/CodeView.swift")!!
    assertEquals(listOf(6, 10), match.second)
  }

  @Test fun changedFilesRankFirstAndLeadAnEmptyQuery() {
    val matcher = FuzzyFileMatcher(paths)
    val boosted = setOf("docs/routing.md")
    val results = matcher.search("md", boosted)
    assertEquals("docs/routing.md", results.first().path)
    assertTrue(results.first().isBoosted)
    assertEquals(listOf("docs/routing.md", paths[0], paths[1]), matcher.search("", boosted, 3).map { it.path })
  }

  @Test fun manyPathsSearchFast() {
    val dirs = listOf("packages/host/src", "clients/apple/ArgusUI/Sources", "app/components/agent", "node_modules/lodash/fp")
    val many = List(200_000) { "${dirs[it % dirs.size]}/module${it / 7}/File${it}View.swift" }
    val matcher = FuzzyFileMatcher(many)
    val start = System.nanoTime()
    assertTrue(matcher.search("file1999view").isNotEmpty())
    assertEquals(50, matcher.search("fv").size)
    assertTrue(System.nanoTime() - start < 4_000_000_000)
  }
}
