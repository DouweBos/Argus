package dev.houwert.argus.kit.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/** Block structure goes wrong silently: an unrecognised block renders as literal text, which is how tables shipped as pipes. */
class MarkdownBlockTest {
  @Test fun aPipeRowFollowedByASeparatorIsATable() {
    val blocks = MarkdownBlock.parse(
      """
      | Column | Holds |
      |---|---|
      | Sidebar | the five sections |
      | Detail | what you're reading |
      """.trimIndent(),
    )
    assertEquals(
      listOf(
        MarkdownBlock.Table(
          listOf("Column", "Holds"),
          listOf(listOf("Sidebar", "the five sections"), listOf("Detail", "what you're reading")),
        ),
      ),
      blocks,
    )
  }

  @Test fun alignmentMarkersInTheSeparatorAreAccepted() {
    assertEquals(
      MarkdownBlock.Table(listOf("a", "b"), listOf(listOf("1", "2"))),
      MarkdownBlock.parse("| a | b |\n|:--|--:|\n| 1 | 2 |").first(),
    )
  }

  @Test fun pipesWithoutASeparatorStayProse() {
    assertIs<MarkdownBlock.Paragraph>(MarkdownBlock.parse("| this is just | text").first())
  }

  @Test fun aTableEndsWhereItsRowsEnd() {
    val blocks = MarkdownBlock.parse("| a |\n|---|\n| 1 |\n\nAfter the table.")
    assertEquals(2, blocks.size)
    assertIs<MarkdownBlock.Table>(blocks[0])
    assertEquals(MarkdownBlock.Paragraph("After the table."), blocks[1])
  }

  @Test fun headingsRulesQuotesAndFences() {
    val blocks = MarkdownBlock.parse(
      """
      ## Heading

      > quoted

      ---

      ```swift
      let x = 1
      ```
      """.trimIndent(),
    )
    assertEquals(
      listOf(
        MarkdownBlock.Heading(2, "Heading"),
        MarkdownBlock.Quote("quoted"),
        MarkdownBlock.Rule,
        MarkdownBlock.Code("swift", "let x = 1"),
      ),
      blocks,
    )
  }

  @Test fun orderedAndUnorderedListsDontMerge() {
    assertEquals(
      listOf(
        MarkdownBlock.ListBlock(listOf("one", "two"), ordered = false),
        MarkdownBlock.ListBlock(listOf("first", "second"), ordered = true),
      ),
      MarkdownBlock.parse("- one\n- two\n\n1. first\n2. second"),
    )
  }

  @Test fun anUnclosedFenceStillYieldsItsBody() {
    assertEquals(MarkdownBlock.Code(null, "still code"), MarkdownBlock.parse("```\nstill code").first())
  }

  @Test fun aLooseOrderedListWithIndentedContinuationsStaysOneList() {
    val blocks = MarkdownBlock.parse(
      """
      1. **First** thing.
         It continues here.

      2. Second thing.

      3. Third thing.

      All done.
      """.trimIndent(),
    )
    assertEquals(
      listOf(
        MarkdownBlock.ListBlock(listOf("**First** thing.\nIt continues here.", "Second thing.", "Third thing."), ordered = true),
        MarkdownBlock.Paragraph("All done."),
      ),
      blocks,
    )
  }
}
