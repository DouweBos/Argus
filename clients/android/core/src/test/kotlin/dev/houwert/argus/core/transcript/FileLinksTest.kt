package dev.houwert.argus.core.transcript

import dev.houwert.argus.core.transcript.FileLinks.FileRef as Ref
import dev.houwert.argus.core.transcript.FileLinks.Segment
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Cases mirror `app/lib/filePathLink.test.ts`, plus the column and worktree resolution the native apps add. */
class FileLinksTest {
  @Test fun parseFileRefSplitsPathLineAndColumn() {
    assertEquals(Ref("src/foo.ts"), FileLinks.parseFileRef("src/foo.ts"))
    assertEquals(Ref("src/foo.ts", 42), FileLinks.parseFileRef("src/foo.ts:42"))
    assertEquals(Ref("src/foo.ts", 42, 7), FileLinks.parseFileRef("src/foo.ts:42:7"))
  }

  @Test fun plainTextHasNoLinks() {
    assertEquals(listOf(Segment.Text("hello world")), FileLinks.split("hello world"))
    assertEquals(emptyList(), FileLinks.split(""))
    assertEquals(emptyList(), FileLinks.splitMentions(""))
  }

  @Test fun aPathWithALineBecomesOneLinkBetweenTextRuns() {
    assertEquals(
      listOf(Segment.Text("edit "), Segment.Link("src/foo.ts:10", Ref("src/foo.ts", 10)), Segment.Text(" now")),
      FileLinks.split("edit src/foo.ts:10 now"),
    )
  }

  @Test fun lineAndColumnAreBothKept() {
    assertEquals(
      listOf(Segment.Text("at "), Segment.Link("/a/b.swift:3:9", Ref("/a/b.swift", 3, 9)), Segment.Text(".")),
      FileLinks.split("at /a/b.swift:3:9."),
    )
  }

  @Test fun unknownExtensionsAreNotLinks() {
    assertEquals(listOf(Segment.Text("foo.xyzzy is not a known type")), FileLinks.split("foo.xyzzy is not a known type"))
  }

  @Test fun bareFilenamesAndPrefixesLinkAndExtensionsIgnoreCase() {
    val paths = FileLinks.matches("package.json ~/x/y.md ./a.ts ../b.ts README.MD")
      .mapNotNull { (it.kind as? FileLinks.Kind.File)?.ref?.path }
    assertEquals(listOf("package.json", "~/x/y.md", "./a.ts", "../b.ts", "README.MD"), paths)
  }

  @Test fun aMatchSpansTheWholeTokenAndNeverEndsMidWord() {
    assertEquals(listOf(19, 6), FileLinks.matches("@scope/pkg/index.ts x-y.ts").map { it.range.length })
    assertTrue(FileLinks.matches("foo.tsx2").isEmpty())
  }

  @Test fun pathsInBackticksAndParenthesesLinkWithoutThePunctuation() {
    assertEquals(
      listOf(
        Segment.Text("see `"),
        Segment.Link("src/a.ts", Ref("src/a.ts")),
        Segment.Text("` (and "),
        Segment.Link("b/c.go", Ref("b/c.go")),
        Segment.Text(")"),
      ),
      FileLinks.split("see `src/a.ts` (and b/c.go)"),
    )
  }

  @Test fun urlsWinOverPathsAndLoseTrailingPunctuation() {
    assertEquals(
      listOf(Segment.Text("visit "), Segment.Url("https://example.com"), Segment.Text(".")),
      FileLinks.split("visit https://example.com."),
    )
    assertEquals(listOf(Segment.Url("https://x.dev/a.ts")), FileLinks.split("https://x.dev/a.ts"))
    assertEquals(
      listOf(
        Segment.Text("("), Segment.Url("https://x.dev/a_(b)"), Segment.Text(") "),
        Segment.Link("a.ts", Ref("a.ts")),
      ),
      FileLinks.split("(https://x.dev/a_(b)) a.ts"),
    )
  }

  @Test fun rangesAreUtf16SoEmojiBeforeAPathDontShiftIt() {
    val text = "👋 src/a.ts"
    val match = FileLinks.matches(text)[0]
    assertEquals("src/a.ts", text.substring(match.range.location, match.range.end))
  }

  @Test fun mentionsNeedNoExtensionAndUnescapeSpaces() {
    assertEquals(
      listOf(Segment.Text("hey "), Segment.Link("@src/foo.ts", Ref("src/foo.ts")), Segment.Text(" please")),
      FileLinks.splitMentions("hey @src/foo.ts please"),
    )
    assertEquals(
      listOf(Segment.Text("check "), Segment.Link("@foo/bar.ts", Ref("foo/bar.ts")), Segment.Text(", ok?")),
      FileLinks.splitMentions("check @foo/bar.ts, ok?"),
    )
    assertEquals(listOf(Segment.Text("email foo@bar.ts there")), FileLinks.splitMentions("email foo@bar.ts there"))
    assertEquals(
      listOf(
        Segment.Text("see "),
        Segment.Link("""@/Users/d/maestro-results\ (3)""", Ref("/Users/d/maestro-results (3)")),
        Segment.Text(" please"),
      ),
      FileLinks.splitMentions("""see @/Users/d/maestro-results\ (3) please"""),
    )
    assertEquals(
      listOf(Segment.Text("see "), Segment.Link("@foo/bar(1).ts", Ref("foo/bar(1).ts")), Segment.Text(" now")),
      FileLinks.splitMentions("see @foo/bar(1).ts now"),
    )
  }

  @Test fun aFileLinksUrlKeepsLineAndColumnThroughTheRoundTrip() {
    val ref = Ref("src/a b.ts", 4, 9)
    val url = FileLinks.url(ref)
    assertTrue(url.startsWith(FileLinks.SCHEME + ":"))
    assertEquals(ref, FileLinks.fileRef(url))
    assertNull(FileLinks.fileRef("https://x.dev/a.ts"))
    assertEquals("https://x.dev", FileLinks.url(FileLinks.Kind.Url("https://x.dev")))
  }

  @Test fun relativePathsResolveAgainstTheWorktreeTildeAgainstHome() {
    assertEquals("/b/c.ts", FileLinks.resolve("/a/../b/c.ts", "/w"))
    assertEquals("/w/t/src/a.ts", FileLinks.resolve("src/a.ts", "/w/t"))
    assertEquals("/w/t/src/a.ts", FileLinks.resolve("./src/a.ts", "/w/t"))
    assertEquals("/w/x.ts", FileLinks.resolve("../x.ts", "/w/t"))
    assertEquals("/Users/me/n.md", FileLinks.resolve("~/n.md", "/w", home = "/Users/me"))
    assertNull(FileLinks.resolve("src/a.ts", null))
    assertNull(FileLinks.resolve("~/n.md", "/w"))
  }
}
