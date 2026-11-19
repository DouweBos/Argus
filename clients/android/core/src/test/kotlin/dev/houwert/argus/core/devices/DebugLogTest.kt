package dev.houwert.argus.core.devices

import dev.houwert.argus.core.devices.DebugLogEntry.Level
import dev.houwert.argus.core.devices.DebugLogEntry.Source
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

class DebugLogTest {
  @Test fun parsesStructuredStdoutLinesAndKeepsTheRestAsText() {
    val log = DebugLog()
    log.append("""{"level":"warn","message":"low memory","timestamp":"10:00","source":"device"}""" + "\nplain\n", Source.Stdout)
    log.append("boom\n", Source.Stderr)
    assertEquals(listOf("low memory", "plain", "boom"), log.entries.map { it.message })
    assertEquals(Level.Warning, log.entries[0].level)
    assertEquals("device", log.entries[0].origin)
    assertNull(log.entries[1].level)
    assertEquals(listOf(true, false, true), log.entries.map { it.isError })
    assertEquals(listOf(1, 2, 3), log.entries.map { it.id })
  }

  @Test fun aStatusErrorLineIsTextNotAnEntry() {
    val log = DebugLog()
    log.append("""{"status":"error","message":"x","timestamp":"t"}""" + "\n", Source.Stdout)
    assertNull(log.entries.first().level)
  }

  @Test fun dropsTheOldestPastTheLimitAndFiltersByText() {
    val log = DebugLog(limit = 2)
    log.append("a\nb\nc\n", Source.Stdout)
    assertEquals(listOf("b", "c"), log.entries.map { it.message })
    assertEquals(listOf("c"), log.entries.filter { it.matches(" C ") }.map { it.message })
  }

  @Test fun aLineSplitAcrossChunksIsParsedOnceWhole() {
    val log = DebugLog()
    log.append("""{"level":"error","message":"half""", Source.Stdout)
    assertTrue(log.entries.isEmpty())
    log.append("""way","timestamp":"t"}""" + "\nnext\n", Source.Stdout)
    assertEquals(listOf("halfway", "next"), log.entries.map { it.message })
    assertEquals(Level.Error, log.entries.first().level)
  }

  @Test fun theClockTimeDropsTheDateZoneAndSubMillisecondDigits() {
    val log = DebugLog()
    log.append("""{"level":"log","message":"a","timestamp":"2026-10-04 21:04:54.120707+0200"}""" + "\n", Source.Stdout)
    log.append("""{"level":"log","message":"b","timestamp":"10:00"}""" + "\n", Source.Stdout)
    assertEquals(listOf<String?>("21:04:54.120", "10:00"), log.entries.map { it.clockTime })
  }
}
