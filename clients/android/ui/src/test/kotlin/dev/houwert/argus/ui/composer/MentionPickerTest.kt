package dev.houwert.argus.ui.composer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MentionPickerTest {
  private fun ctx(query: String, start: Int) = MentionPicker.Context(query, start)

  @Test fun `a mention starts at an @ that begins a word and runs to the caret`() {
    assertEquals(ctx("src", 0), MentionPicker.detect("@src", 4))
    assertEquals(ctx("ap", 4), MentionPicker.detect("see @ap", 7))
    assertNull(MentionPicker.detect("mail@host", 9))
    assertNull(MentionPicker.detect("@src lib", 8))
    assertEquals(ctx("ab", 0), MentionPicker.detect("@ab rest", 3))
    assertNull(MentionPicker.detect("", 0))
  }

  @Test fun `offsets are UTF-16`() {
    val text = "hé 🙂 @fi"
    assertEquals(text.length - 3, MentionPicker.detect(text, text.length)?.start)
  }

  @Test fun `a slash, tilde or dot switches to browsing`() {
    assertEquals("src/" to "comp", MentionPicker.splitBrowse("src/comp"))
    assertEquals("src/" to "", MentionPicker.splitBrowse("src/"))
    assertEquals("~/" to "work", MentionPicker.splitBrowse("~Work"))
    assertEquals("~" to "", MentionPicker.splitBrowse("~"))
    assertEquals("./" to "git", MentionPicker.splitBrowse(".git"))
  }

  @Test fun `search lists matching directories first, then files, ranked by basename`() {
    val files = listOf("app/App.tsx", "app/lib/app.ts", "src/main.swift", "README.md")
    val dirs = MentionPicker.directories(files)
    assertEquals(listOf("app", "app/lib", "src"), dirs)
    val items = MentionPicker.search(files, dirs, "app")
    assertEquals(listOf("app", "lib", "App.tsx", "app.ts"), items.map { it.display })
    assertEquals(true, items.first().isDirectory)
    assertEquals("app/lib", items[3].hint)
  }

  @Test fun `search caps directories at six and the total at twelve`() {
    val files = (0 until 20).map { "d$it/f$it.txt" }
    val items = MentionPicker.search(files, MentionPicker.directories(files), "")
    assertEquals(6, items.count { it.isDirectory })
    assertEquals(12, items.size)
  }

  @Test fun `browsing leads with linking the directory, then filters its entries`() {
    val items = MentionPicker.browse(
      "src/",
      listOf(MentionPicker.Entry("views", true), MentionPicker.Entry("main.swift", false), MentionPicker.Entry("Info.plist", false)),
      "i",
    )
    assertEquals(MentionPicker.Item("src", isDirectory = true, isLinkAction = true), items.first())
    assertEquals(listOf("Info.plist", "views", "main.swift"), items.drop(1).map { it.display })
  }

  @Test fun `a file inserts @path and a space and a directory drills in`() {
    val context = ctx("ma", 4)
    val picked = MentionPicker.apply(MentionPicker.Item("main.swift", "src", false), context, "see @ma now")
    assertEquals("see @src/main.swift  now", picked.text)
    assertEquals(20, picked.caret)
    assertEquals("see @src/", MentionPicker.apply(MentionPicker.Item("src", "", true), context, "see @ma").text)
    val browsing = ctx("src/", 0)
    assertEquals("@src ", MentionPicker.apply(MentionPicker.Item("src", isDirectory = true, isLinkAction = true), browsing, "@src/").text)
    assertEquals("@src/views/", MentionPicker.apply(MentionPicker.Item("views", isDirectory = true), browsing, "@src/").text)
  }

  @Test fun `files become escaped mentions`() {
    val edit = MentionPicker.insertingFileMentions(listOf("/tmp/a b.txt", "/tmp/c"), "look at", 7)
    assertEquals("look at @/tmp/a\\ b.txt @/tmp/c ", edit.text)
    assertEquals(edit.text.length, edit.caret)
    assertEquals("@/x ", MentionPicker.insertingFileMentions(listOf("/x"), "", 0).text)
  }

  @Test fun `the header names the browsed directory`() {
    assertEquals("Files", MentionPicker.header(ctx("fi", 0)))
    assertEquals("src/", MentionPicker.header(ctx("src/v", 0)))
  }
}

class DictationDraftTest {
  @Test fun `words land at the caret, spaced from both sides`() {
    val merged = DictationDraft("fix thebuild", 7).merged("the flaky")
    assertEquals("fix the the flaky build", merged.text)
    assertEquals("fix the the flaky".length, merged.caret)
  }

  @Test fun `no extra space beside existing whitespace or an empty draft`() {
    assertEquals("hello", DictationDraft("", 0).merged(" hello ").text)
    assertEquals("fix it", DictationDraft("fix ", 4).merged("it").text)
    assertEquals("a\nx b", DictationDraft("a\nb", 2).merged("x").text)
  }

  @Test fun `silence leaves the draft as it was`() {
    val draft = DictationDraft("keep", 2)
    assertEquals("keep", draft.merged("  ").text)
    assertEquals("keep", draft.original)
  }

  @Test fun `a caret past the end or inside an emoji stays on a character boundary`() {
    assertEquals("hi", DictationDraft("hi", 99).prefix)
    assertEquals("a", DictationDraft("a😀b", 2).prefix)
  }
}
