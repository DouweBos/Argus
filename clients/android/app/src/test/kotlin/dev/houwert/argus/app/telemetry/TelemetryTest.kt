package dev.houwert.argus.app.telemetry

import dev.houwert.argus.core.stores.StoreEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class TelemetryTest {
  @Test
  fun scrubsPaths() {
    val scrubbed = Telemetry.scrub("failed at /Users/alice/Work/repo and /home/bob/x, /data/user/0/dev.houwert.argus/files/a")
    assertEquals("failed at /Users/<user>/Work/repo and /home/<user>/x, /data/<path>", scrubbed)
  }

  @Test
  fun appErrorScrubsAndTruncates() {
    val event = TelemetryEvent.AppError("send", "/Users/alice/" + "x".repeat(3000))
    val message = event.properties["message"] as String
    assertFalse(message.contains("alice"))
    assertEquals(2000, message.length)
  }

  @Test
  fun bucketsRoundOffCounts() {
    assertEquals("xs", TelemetryEvent.MessageSent(false, false, 10).properties["length_bucket"])
    assertEquals("0", TelemetryEvent.FileSearchRun(regex = false, results = 0, truncated = false).properties["result_bucket"])
    assertEquals("11-100", TelemetryEvent.IssueSearched(42).properties["result_bucket"])
    assertEquals("under_1d", TelemetryEvent.SavedShown(7200).properties["age_bucket"])
  }

  @Test
  fun mapsStoreEvents() {
    assertEquals(
      TelemetryEvent.WorkLanded(StoreEvent.LandAction.Merge, true, "squash"),
      Telemetry.from(StoreEvent.WorkLanded(StoreEvent.LandAction.Merge, true, "squash")),
    )
    assertEquals(mapOf("action" to "push", "success" to false, "strategy" to "none"),
      TelemetryEvent.WorkLanded(StoreEvent.LandAction.Push, false).properties)
  }
}
