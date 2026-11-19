package dev.houwert.argus.kit.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SharedPromptTest {
  @Test fun nothingSharedLeavesTheDraftEmpty() {
    assertEquals("", SharedPrompt.draft(emptyList(), listOf("  ")))
  }

  @Test fun linksGoOnTheirOwnLinesAndTextIsQuoted() {
    val draft = SharedPrompt.draft(
      listOf("https://linear.app/argus/issue/ARG-12"), listOf("Crash on launch\n\nsecond paragraph"),
    )
    assertEquals("https://linear.app/argus/issue/ARG-12\n\n> Crash on launch\n>\n> second paragraph\n\n", draft)
  }

  @Test fun aLinkSharedAsTextIsALinkAndNotRepeated() {
    val link = "https://github.com/owner/repo/issues/3"
    assertEquals("$link\n\n", SharedPrompt.draft(listOf(link), listOf(link, " $link ")))
    assertEquals("$link\n\n", SharedPrompt.draft(emptyList(), listOf(link)))
  }

  @Test fun onlyWebAddressesCountAsLinks() {
    assertTrue(SharedPrompt.isLink("https://example.com/a?b=1"))
    assertFalse(SharedPrompt.isLink("see https://example.com"))
    assertFalse(SharedPrompt.isLink("file:///tmp/a.png"))
    assertFalse(SharedPrompt.isLink("hello"))
  }
}
