package dev.houwert.argus.kit.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Parsed against the TypeScript `parseDiff` over a real `git diff --cached` covering all four statuses. */
class DiffParserTest {
  @Serializable data class Line(val type: String, val content: String, val oldNumber: Int? = null, val newNumber: Int? = null)

  @Serializable data class Hunk(val header: String, val lines: List<Line>)

  @Serializable data class File(val oldPath: String, val newPath: String, val status: String, val hunks: List<Hunk>)

  @Serializable data class Fixture(val raw: String, val files: List<File>)

  private fun fixture(): Fixture =
    Json.decodeFromString(Fixture.serializer(), javaClass.getResource("/diff-sample.json")!!.readText())

  private fun kindName(kind: DiffLineKind) = if (kind == DiffLineKind.NO_NEWLINE) "no-newline" else kind.name.lowercase()

  @Test fun matchesTheTypeScriptParserFileForFile() {
    val f = fixture()
    val parsed = DiffParser.parse(f.raw)
    assertEquals(f.files.size, parsed.size)
    for ((mine, theirs) in parsed.zip(f.files)) {
      assertEquals(theirs.oldPath, mine.oldPath)
      assertEquals(theirs.newPath, mine.newPath)
      assertEquals(theirs.status, mine.status.rawValue)
      assertEquals(theirs.hunks.size, mine.hunks.size)
      for ((myHunk, theirHunk) in mine.hunks.zip(theirs.hunks)) {
        assertEquals(theirHunk.header, myHunk.header)
        assertEquals(theirHunk.lines.size, myHunk.lines.size)
        for ((myLine, theirLine) in myHunk.lines.zip(theirHunk.lines)) {
          assertEquals(theirLine.type, kindName(myLine.kind))
          assertEquals(theirLine.content, myLine.text)
          assertEquals(theirLine.oldNumber, myLine.oldNumber)
          assertEquals(theirLine.newNumber, myLine.newNumber)
        }
      }
    }
  }

  @Test fun derivesTheFourStatuses() {
    val byPath = DiffParser.parse(fixture().raw).associateBy { it.displayPath }
    assertEquals(DiffFileStatus.ADDED, byPath["added.txt"]?.status)
    assertEquals(DiffFileStatus.MODIFIED, byPath["keep.txt"]?.status)
    assertEquals(DiffFileStatus.DELETED, byPath["remove.txt"]?.status)
    assertEquals(DiffFileStatus.RENAMED, byPath["after.txt"]?.status)
    // A rename keeps where it came from, which the UI shows as "from".
    assertEquals("before.txt", byPath["after.txt"]?.oldPath)
  }

  @Test fun countsAdditionsAndDeletionsPerFile() {
    val byPath = DiffParser.parse(fixture().raw).associateBy { it.displayPath }
    // keep.txt: "two" became "TWO" and "four" was appended.
    assertEquals(2, byPath["keep.txt"]?.additions)
    assertEquals(1, byPath["keep.txt"]?.deletions)
    assertEquals(1, byPath["remove.txt"]?.deletions)
  }

  @Test fun carriesTheNoNewlineMarkerWithoutNumberingIt() {
    val markers = DiffParser.parse(fixture().raw).flatMap { it.hunks }.flatMap { it.lines }
      .filter { it.kind == DiffLineKind.NO_NEWLINE }
    // added.txt was written without a trailing newline.
    assertTrue(markers.isNotEmpty())
    assertTrue(markers.all { it.oldNumber == null && it.newNumber == null })
  }

  @Test fun anEmptyDiffYieldsNoFiles() {
    assertTrue(DiffParser.parse("").isEmpty())
    assertTrue(DiffParser.parse("no diff here\njust text").isEmpty())
  }
}

class InlineDiffTest {
  @Test fun aMiddleReplacementKeepsTheSharedEdgesAsContext() {
    val lines = InlineDiff.compute("a\nb\nc", "a\nB\nc")
    assertEquals(listOf(DiffLineKind.CONTEXT, DiffLineKind.REMOVE, DiffLineKind.ADD, DiffLineKind.CONTEXT), lines.map { it.kind })
    assertEquals("b", lines[1].text)
    assertEquals("B", lines[2].text)
    assertEquals(2, lines[1].oldNumber)
    assertEquals(2, lines[2].newNumber)
  }

  @Test fun statsCountOnlyWhatActuallyChanged() {
    assertEquals(InlineDiff.Stats(1, 1), InlineDiff.stats("a\nb\nc", "a\nB\nc"))
    assertEquals(InlineDiff.Stats(0, 0), InlineDiff.stats("a", "a"))
    assertEquals(InlineDiff.Stats(2, 0), InlineDiff.stats("", "x\ny"))
  }

  @Test fun aWriteIsAllAdditionsAndAnEmptyOneIsNothing() {
    assertEquals(listOf(DiffLineKind.ADD, DiffLineKind.ADD), InlineDiff.writeLines("x\ny").map { it.kind })
    assertEquals(InlineDiff.Stats(2, 0), InlineDiff.writeStats("x\ny"))
    assertEquals(InlineDiff.Stats(0, 0), InlineDiff.writeStats(""))
  }
}
