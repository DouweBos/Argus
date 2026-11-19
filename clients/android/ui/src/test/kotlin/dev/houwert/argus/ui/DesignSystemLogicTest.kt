package dev.houwert.argus.ui

import dev.houwert.argus.ui.components.ChromeText
import dev.houwert.argus.ui.components.FlowRowMath
import dev.houwert.argus.ui.components.MenuChipText
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.PillMetrics
import dev.houwert.argus.ui.components.ReadingColumn
import dev.houwert.argus.ui.components.ToggleListMath
import dev.houwert.argus.ui.components.formatTokens
import dev.houwert.argus.ui.theme.ProjectAccent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DesignSystemLogicTest {
  @Test
  fun initialsTakeTheFirstTwoWordsElseTheFirstTwoLetters() {
    assertEquals("RN", ChromeText.initials("react-native-client"))
    assertEquals("AR", ChromeText.initials("Argus"))
    assertEquals("IA", ChromeText.initials("iOS App"))
    assertEquals("", ChromeText.initials(""))
  }

  @Test
  fun agesReadAsTheTightestUnitFromMillisecondsOrSeconds() {
    val now = 2_000_000_000_000L
    val ms = now.toDouble()
    assertEquals("now", ChromeText.shortAge(ms - 10_000, now))
    assertEquals("5m", ChromeText.shortAge(ms - 5 * 60_000, now))
    assertEquals("4h", ChromeText.shortAge(ms - 4 * 3_600_000, now))
    assertEquals("3d", ChromeText.shortAge(ms - 3 * 86_400_000.0, now))
    assertEquals("3w", ChromeText.shortAge(ms - 21 * 86_400_000.0, now))
    assertEquals("2h", ChromeText.shortAge(now / 1000.0 - 7200, now))
    assertEquals("now", ChromeText.shortAge(ms + 60_000, now))
  }

  @Test
  fun durations() {
    assertEquals("29s", ChromeText.duration(29.7))
    assertEquals("5m 29s", ChromeText.duration(329.0))
    assertEquals("1h 4m", ChromeText.duration(3_840.0))
    assertEquals("0s", ChromeText.duration(-3.0))
  }

  @Test
  fun readingColumnCentresAndStepsLeftOfATrailingReserve() {
    assertEquals(350f, ReadingColumn.frame(1400f).first)
    assertEquals(350f, ReadingColumn.frame(1400f, 260f).first)
    val shifted = ReadingColumn.frame(1000f, 260f)
    assertEquals(740f, shifted.first + shifted.second)
    assertEquals(560f, ReadingColumn.frame(600f).second)
  }

  @Test
  fun flowRowCellWidths() {
    assertEquals(listOf(150, 150), FlowRowMath.cellWidths(listOf(60, 80), 308, 8, false))
    assertEquals(listOf(230, 70), FlowRowMath.cellWidths(listOf(200, 40), 308, 8, false))
    assertEquals(listOf(70, 90, 60), FlowRowMath.cellWidths(listOf(70, 90, 60), 760, 6, true))
    assertEquals(listOf(300), FlowRowMath.cellWidths(listOf(400), 300, 6, true))
  }

  @Test
  fun projectAccentMatchesTheDesktopPalette() {
    assertEquals(4, ProjectAccent.index("/Users/douwe/Work/Houwert/Projects/Argus"))
    assertEquals(1, ProjectAccent.index("/Users/me/Work/Acme/mobile-app"))
    assertEquals(3, ProjectAccent.index("/tmp/é"))
    assertEquals(0, ProjectAccent.index(""))
  }

  @Test
  fun pillOverflow() {
    val item = PillMetrics.ICON_WIDTH + PillMetrics.SPACING
    assertEquals(5, PillMetrics.visibleCount(5, 5 * item - PillMetrics.SPACING))
    assertEquals(5, PillMetrics.visibleCount(5, Float.POSITIVE_INFINITY))
    assertEquals(3, PillMetrics.visibleCount(10, 3 * item + PillMetrics.ICON_WIDTH))
    assertEquals(2, PillMetrics.visibleCount(10, 3 * item + PillMetrics.ICON_WIDTH - 1))
    assertEquals(0, PillMetrics.visibleCount(4, 10f))
    assertEquals(0, PillMetrics.visibleCount(4, -50f))
    assertEquals(4, PillMetrics.visibleCount(4, 4 * item + PillMetrics.ICON_WIDTH, alwaysMore = true))
    assertEquals(3, PillMetrics.visibleCount(4, 4 * item - PillMetrics.SPACING, alwaysMore = true))
    val width = 6 * item
    assertTrue(PillMetrics.visibleCount(10, width, 1.5f) < PillMetrics.visibleCount(10, width))
  }

  @Test
  fun toggleListAppendsRemovesAndNeverDoubles() {
    assertEquals(listOf("a", "b"), ToggleListMath.toggled(listOf("a"), "b", true))
    assertEquals(listOf("b"), ToggleListMath.toggled(listOf("a", "b"), "a", false))
    assertEquals(listOf("a"), ToggleListMath.toggled(listOf("a"), "a", true))
  }

  @Test
  fun menuChipShowsThePickedLabelOrTheValueItself() {
    val options = listOf(PickerOption("", "Default"), PickerOption("codex", "Codex", hint = "Custom"))
    assertEquals("Default", MenuChipText.valueLabel("", options))
    assertEquals("Codex", MenuChipText.valueLabel("codex", options))
    assertEquals("gone", MenuChipText.valueLabel("gone", options))
  }

  @Test
  fun tokenCounts() {
    assertEquals("999", formatTokens(999))
    assertEquals("128k", formatTokens(128_400))
    assertEquals("1.2M", formatTokens(1_200_000))
  }
}
