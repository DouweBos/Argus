package dev.houwert.argus.core.teammates

import dev.houwert.argus.kit.protocol.generated.TeammateSymbol
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
}
