package dev.houwert.argus.ui

import dev.houwert.argus.ui.usage.UsageChartMath
import org.junit.Assert.assertEquals
import org.junit.Test

class UsageChartMathTest {
  @Test fun ticksAreRoundStepsPastTheMax() {
    assertEquals(listOf(0.0, 20.0, 40.0, 60.0), UsageChartMath.ticks(58.6))
    assertEquals(listOf(0.0, 2.5, 5.0, 7.5), UsageChartMath.ticks(7.1))
    assertEquals(listOf(0.0, 5e7, 1e8), UsageChartMath.ticks(9.4e7))
    assertEquals(listOf(0.0, 1.0), UsageChartMath.ticks(0.0))
  }

  @Test fun datesSpreadAcrossTheBuckets() {
    assertEquals(listOf(0, 1, 2, 3, 4, 5, 6).filterIndexed { i, _ -> i % 2 == 0 }, UsageChartMath.labelIndices(7))
    assertEquals(listOf(0, 1, 2), UsageChartMath.labelIndices(3))
    assertEquals(listOf(0, 5, 10, 15, 20), UsageChartMath.labelIndices(24))
    assertEquals(emptyList<Int>(), UsageChartMath.labelIndices(0))
  }
}
