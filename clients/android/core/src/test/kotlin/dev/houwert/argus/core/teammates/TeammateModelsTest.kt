package dev.houwert.argus.core.teammates

import dev.houwert.argus.core.support.decode
import dev.houwert.argus.kit.protocol.generated.TeammateSummary
import dev.houwert.argus.kit.protocol.generated.TeammateSymbol
import dev.houwert.argus.kit.protocol.generated.TeammateThread
import dev.houwert.argus.kit.protocol.generated.TeammateThreadSurface
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TeammateModelsTest {
  @Test
  fun initialsTakeTwoLetters() {
    assertEquals("CF", TeammateText.initials("ci fixer"))
    assertEquals("RE", TeammateText.initials("Reviewer"))
    assertEquals("DB", TeammateText.initials("dep-bumper"))
    assertEquals("?", TeammateText.initials("  "))
  }

  @Test
  fun avatarRoundTripsItsSymbol() {
    assertEquals(TeammateSymbol.leaf, teammateAvatar(TeammateSymbol.leaf).symbol)
    assertNull(teammateAvatar(null).symbol)
  }

  @Test
  fun onlyOutsideConversationsAreLabelled() {
    assertNull(TeammateText.surfaceLabel(TeammateThreadSurface.direct))
    assertEquals("Slack", TeammateText.surfaceLabel(TeammateThreadSurface.slack))
    assertEquals("From a teammate", TeammateText.surfaceLabel(TeammateThreadSurface.handoff))
  }

  private val summary = decode(
    TeammateSummary.serializer(),
    """{"teammate":{"id":"t","name":"Ci Fixer","handle":"ci","tagline":"Fixes CI","color":"blue",
      "avatar":{"kind":"initials"},"enabled":true,"scope":{"repo_roots":[]},"source_ids":[],
      "guardrails":{"confidence_threshold":0.7,"max_concurrent_sessions":1,"max_files_changed":10,
      "max_cost_usd_per_run":1,"max_run_minutes":30,"path_denylist":[],"require_clean_ci":false,
      "retry_other_accounts":false},"created_at":0,"updated_at":0},
      "duty_count":2,"has_unread_report":false}""",
  )

  private fun thread(title: String, openedAt: Double) =
    TeammateThread("th", "t", TeammateThreadSurface.direct, title, "a", 0.0, openedAt, false)

  @Test
  fun previewPrefersWorkThenTheLatestConversationThenTheTagline() {
    val talked = summary.copy(latestThread = thread("Flaky login test", 5.0))
    assertEquals("Working on a duty", TeammateText.preview(talked.copy(working = true)))
    assertEquals("Flaky login test", TeammateText.preview(talked))
    assertEquals("Fixes CI", TeammateText.preview(summary.copy(latestThread = thread(" ", 5.0))))
    assertEquals("No conversations yet", TeammateText.preview(summary.copy(teammate = summary.teammate.copy(tagline = ""))))
  }

  @Test
  fun lastActivityIsTheLaterOfARunAndAConversation() {
    assertNull(TeammateText.lastActivityAt(summary))
    assertEquals(9.0, TeammateText.lastActivityAt(summary.copy(lastRunAt = 9.0, latestThread = thread("x", 5.0))))
    assertEquals(12.0, TeammateText.lastActivityAt(summary.copy(lastRunAt = 9.0, latestThread = thread("x", 12.0))))
    assertEquals(5.0, TeammateText.lastActivityAt(summary.copy(latestThread = thread("x", 5.0))))
  }
}
