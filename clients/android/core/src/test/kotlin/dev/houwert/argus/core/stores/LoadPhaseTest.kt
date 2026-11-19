package dev.houwert.argus.core.stores

import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

class LoadPhaseTest {
  @Test fun tellsLoadingFromEmptyFromFailed() {
    assertEquals(LoadPhase.Loading, LoadPhase.of(loaded = false, error = null, isEmpty = true))
    assertEquals(LoadPhase.Empty, LoadPhase.of(loaded = true, error = null, isEmpty = true))
    assertEquals(LoadPhase.Failed("nope"), LoadPhase.of(loaded = true, error = "nope", isEmpty = true))
    assertEquals(LoadPhase.Failed("nope"), LoadPhase.of(loaded = false, error = "nope", isEmpty = true))
  }

  @Test fun rowsOnScreenAlwaysWin() {
    assertEquals(LoadPhase.Content, LoadPhase.of(loaded = false, error = null, isEmpty = false))
    assertEquals(LoadPhase.Content, LoadPhase.of(loaded = true, error = "refresh failed", isEmpty = false))
    assertTrue(LoadPhase.of(loaded = true, error = null, isEmpty = false).showsContent)
    assertFalse(LoadPhase.of(loaded = false, error = null, isEmpty = true).showsContent)
  }
}
