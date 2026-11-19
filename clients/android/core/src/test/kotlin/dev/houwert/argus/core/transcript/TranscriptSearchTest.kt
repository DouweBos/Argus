package dev.houwert.argus.core.transcript

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TranscriptSearchTest {
  private val units = listOf(
    TranscriptSearch.Unit("m1", "Build the App, then the app tests"),
    TranscriptSearch.Unit("m2#tool#t1", "Read src/App.swift"),
    TranscriptSearch.Unit("m3", "aaaa"),
  )

  @Test fun matchesAreCaseInsensitiveTrimmedAndInTranscriptOrder() {
    val hits = TranscriptSearch.find("  app ", units)
    assertEquals(listOf("m1", "m1", "m2#tool#t1"), hits.map { it.unitId })
    assertEquals(listOf(TextRange(10, 3), TextRange(24, 3), TextRange(9, 3)), hits.map { it.range })
  }

  @Test fun matchesNeverOverlap() {
    assertEquals(listOf(0, 2), TranscriptSearch.find("aa", units).map { it.range.location })
  }

  @Test fun anEmptyQueryFindsNothing() {
    assertTrue(TranscriptSearch.find("   ", units).isEmpty())
  }

  @Test fun steppingWrapsBothWaysAndStartsAtTheRightEnd() {
    assertEquals(0, TranscriptSearch.step(null, 3, forward = true))
    assertEquals(2, TranscriptSearch.step(null, 3, forward = false))
    assertEquals(0, TranscriptSearch.step(2, 3, forward = true))
    assertEquals(2, TranscriptSearch.step(0, 3, forward = false))
    assertNull(TranscriptSearch.step(0, 0, forward = true))
  }

  @Test fun theCounterReadsLikeTheDesktops() {
    assertEquals("", TranscriptSearch.counter("", 0, null))
    assertEquals("No matches", TranscriptSearch.counter("x", 0, null))
    assertEquals("3 of 12", TranscriptSearch.counter("x", 12, 2))
  }
}
