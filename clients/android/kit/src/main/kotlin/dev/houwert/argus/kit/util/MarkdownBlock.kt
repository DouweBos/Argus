package dev.houwert.argus.kit.util

/**
 * Block-level markdown structure. Inline formatting is left to the render site; this only
 * decides what is a heading, a list, a fence, a table or a paragraph.
 */
sealed interface MarkdownBlock {
  data class Heading(val level: Int, val text: String) : MarkdownBlock
  data class Paragraph(val text: String) : MarkdownBlock
  data class Code(val language: String?, val body: String) : MarkdownBlock
  data class Quote(val text: String) : MarkdownBlock
  data class ListBlock(val items: List<String>, val ordered: Boolean) : MarkdownBlock
  data class Table(val columns: List<String>, val rows: List<List<String>>) : MarkdownBlock
  data object Rule : MarkdownBlock

  companion object {
    private val itemStart = Regex("""^\s*([-*+]|\d+[.)])\s+""")
    private val trimmedItemStart = Regex("""^([-*+]|\d+[.)])\s+""")
    private val heading = Regex("""^(#{1,6})\s+(.*)$""")
    private val bullet = Regex("""^[-*+]\s+(.*)$""")
    private val numbered = Regex("""^\d+[.)]\s+(.*)$""")

    /** `|---|:--:|` and friends: the row that turns pipes into a table. */
    fun isTableSeparator(line: String): Boolean {
      val trimmed = line.trimSpaces()
      if (!trimmed.contains('-') || !(trimmed.startsWith("|") || trimmed.startsWith("-"))) return false
      return trimmed.all { it in "|-: \t" }
    }

    fun cells(line: String): List<String> {
      var trimmed = line.trimSpaces()
      if (trimmed.startsWith("|")) trimmed = trimmed.drop(1)
      if (trimmed.endsWith("|")) trimmed = trimmed.dropLast(1)
      return trimmed.split('|').map { it.trimSpaces() }
    }

    fun parse(source: String): List<MarkdownBlock> {
      val blocks = mutableListOf<MarkdownBlock>()
      val paragraph = mutableListOf<String>()
      val listItems = mutableListOf<String>()
      var listOrdered = false
      val quote = mutableListOf<String>()

      fun flushParagraph() {
        if (paragraph.isEmpty()) return
        blocks.add(Paragraph(paragraph.joinToString("\n")))
        paragraph.clear()
      }
      fun flushList() {
        if (listItems.isEmpty()) return
        blocks.add(ListBlock(listItems.toList(), listOrdered))
        listItems.clear()
      }
      fun flushQuote() {
        if (quote.isEmpty()) return
        blocks.add(Quote(quote.joinToString("\n")))
        quote.clear()
      }
      fun flushAll() {
        flushParagraph()
        flushList()
        flushQuote()
      }

      val lines = source.split("\n")
      var i = 0
      // A blank line inside a list: the list goes on if an item or an indented continuation follows.
      var blankInList = false
      while (i < lines.size) {
        val line = lines[i]
        i += 1

        if (listItems.isNotEmpty()) {
          val isBlank = line.trimSpaces().isEmpty()
          val indented = line.startsWith("  ") || line.startsWith("\t")
          if (isBlank) {
            blankInList = true
            continue
          }
          // An indented line under an item is that item's continuation.
          if (indented && !itemStart.containsMatchIn(line)) {
            val text = line.trimSpaces()
            listItems[listItems.size - 1] += (if (blankInList) "\n\n" else "\n") + text
            blankInList = false
            continue
          }
          val isItem = trimmedItemStart.containsMatchIn(line.trimSpaces())
          if (blankInList && !isItem) flushList()
          blankInList = false
        }

        if (line.startsWith("```")) {
          flushAll()
          val language = line.drop(3).trimSpaces()
          val body = mutableListOf<String>()
          while (i < lines.size && !lines[i].startsWith("```")) {
            body.add(lines[i])
            i += 1
          }
          // Drop the closing fence, if the block was actually closed.
          if (i < lines.size) i += 1
          blocks.add(Code(language.ifEmpty { null }, body.joinToString("\n")))
          continue
        }

        val trimmed = line.trimSpaces()

        // A pipe row is only a table when the next line is its separator.
        if (trimmed.startsWith("|") && i < lines.size && isTableSeparator(lines[i])) {
          flushAll()
          val columns = cells(trimmed)
          i += 1
          val rows = mutableListOf<List<String>>()
          while (i < lines.size && lines[i].trimSpaces().startsWith("|")) {
            rows.add(cells(lines[i]))
            i += 1
          }
          blocks.add(Table(columns, rows))
          continue
        }

        if (trimmed.isEmpty()) {
          flushAll()
          continue
        }
        if (trimmed == "---" || trimmed == "***" || trimmed == "___") {
          flushAll()
          blocks.add(Rule)
          continue
        }
        heading.find(trimmed)?.let { match ->
          flushAll()
          blocks.add(Heading(match.groupValues[1].length, match.groupValues[2]))
          continue
        }
        if (trimmed.startsWith("> ")) {
          flushParagraph()
          flushList()
          quote.add(trimmed.drop(2))
          continue
        }
        bullet.find(trimmed)?.let { match ->
          flushParagraph()
          flushQuote()
          if (listItems.isNotEmpty() && listOrdered) flushList()
          listOrdered = false
          listItems.add(match.groupValues[1])
          continue
        }
        numbered.find(trimmed)?.let { match ->
          flushParagraph()
          flushQuote()
          if (listItems.isNotEmpty() && !listOrdered) flushList()
          listOrdered = true
          listItems.add(match.groupValues[1])
          continue
        }

        flushList()
        flushQuote()
        paragraph.add(line)
      }
      flushAll()
      return blocks
    }
  }
}
