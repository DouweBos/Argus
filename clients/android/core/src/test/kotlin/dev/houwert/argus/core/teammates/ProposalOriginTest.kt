package dev.houwert.argus.core.teammates

import dev.houwert.argus.core.routing.ArgusRoute
import dev.houwert.argus.core.routing.TeammatePage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ProposalOriginTest {
  @Test
  fun aRunOpensTheRun() {
    val origin = ProposalOrigin.of("auto-1", "run-9")
    assertEquals(ProposalOrigin.Run("auto-1", "run-9"), origin)
    assertEquals(ArgusRoute.Automation("auto-1", "run-9"), origin?.route)
  }

  @Test
  fun noRunIsNowhere() {
    assertNull(ProposalOrigin.of("auto-1", null))
  }

  @Test
  fun aTeammateChatOpensTheConversation() {
    val origin = ProposalOrigin.of("teammate-chat:tm-1", "thread:th-2")
    assertEquals(ProposalOrigin.TeammateChat("tm-1", "th-2"), origin)
    assertEquals(ArgusRoute.Teammate("tm-1", TeammatePage.Chat("th-2")), origin?.route)
  }

  @Test
  fun aTeammateChatWithoutAThreadOpensTheNewest() {
    assertEquals(ProposalOrigin.TeammateChat("tm-1", null), ProposalOrigin.of("teammate-chat:tm-1", null))
    assertEquals(ProposalOrigin.TeammateChat("tm-1", null), ProposalOrigin.of("teammate-chat:tm-1", "run-3"))
    assertNull(ProposalOrigin.of("teammate-chat:", "thread:th-2"))
  }
}
