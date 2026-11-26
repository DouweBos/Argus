package dev.houwert.argus.core.git

import dev.houwert.argus.kit.protocol.generated.AttributedRange
import dev.houwert.argus.kit.protocol.generated.AttributedRangeAuthor
import dev.houwert.argus.kit.protocol.generated.FileLineAttribution
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test
import dev.houwert.argus.kit.protocol.generated.LineAttribution as Wire

class LineAttributionTest {
  private val wire = Wire(
    listOf(
      FileLineAttribution(
        "a.ts",
        listOf(
          AttributedRange(AttributedRangeAuthor.agent, end = 3, start = 1),
          AttributedRange(AttributedRangeAuthor.human, end = 4, start = 4),
        ),
      ),
    ),
  )

  @Test fun spreadsRangesOverTheirLines() {
    val attribution = LineAttribution.of(wire)
    assertEquals(mapOf(1 to LineAuthor.AGENT, 2 to LineAuthor.AGENT, 3 to LineAuthor.AGENT, 4 to LineAuthor.HUMAN), attribution.lines("a.ts"))
    assertTrue(attribution.lines("gone.ts").isEmpty())
  }

  @Test fun countsOnlyTheLinesAsked() {
    assertEquals(AttributionCounts(1, 1), AttributionCounts.of(LineAttribution.of(wire).lines("a.ts"), listOf(2, 4, 5)))
  }

  @Test fun appliesOnlyToDiffsEndingAtTheTreeAsItIs() {
    assertTrue(LineAttribution.appliesToDiffMode("working"))
    assertTrue(!LineAttribution.appliesToDiffMode("turn"))
  }
}
