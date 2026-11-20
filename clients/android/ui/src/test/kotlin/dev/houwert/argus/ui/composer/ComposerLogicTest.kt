package dev.houwert.argus.ui.composer

import dev.houwert.argus.kit.protocol.generated.RemoteAgentCapabilities
import dev.houwert.argus.kit.protocol.generated.RemoteModelInfo
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SlashCommandMenuTest {
  private val commands = SlashCommandMenu.merged(
    listOf(SlashCommandMenu.Command("review", "Review a PR", "<pr>"), SlashCommandMenu.Command("clear", "", "")),
  )

  @Test fun `built-ins merge in and an undescribed agent entry doesn't shadow one`() {
    assertTrue(commands.any { it.name == "compact" })
    assertEquals("Clear conversation history", commands.first { it.name == "clear" }.description)
    assertEquals(commands.map { it.name }.sorted(), commands.map { it.name })
  }

  @Test fun `open only while the first token is typed, contains-filtered`() {
    assertEquals(commands.size, SlashCommandMenu.suggestions("/", commands).size)
    assertEquals(listOf("review"), SlashCommandMenu.suggestions("/vie", commands).map { it.name })
    assertEquals(listOf("compact"), SlashCommandMenu.suggestions("/COMP", commands).map { it.name })
    assertTrue(SlashCommandMenu.suggestions("/review x", commands).isEmpty())
    assertTrue(SlashCommandMenu.suggestions("hi /re", commands).isEmpty())
  }

  @Test fun `accepting fills in the name and a space and the hint shows until an argument`() {
    val text = SlashCommandMenu.accepted(commands.first { it.name == "review" })
    assertEquals("/review ", text)
    assertEquals("<pr>", SlashCommandMenu.argumentHint(text, commands))
    assertNull(SlashCommandMenu.argumentHint("/review 1", commands))
    assertNull(SlashCommandMenu.argumentHint("/clear ", commands))
  }

  @Test fun `plan and model are handled locally`() {
    assertEquals(SlashCommandMenu.Local.TogglePlan, SlashCommandMenu.local("/plan"))
    assertEquals(SlashCommandMenu.Local.OpenModelPicker, SlashCommandMenu.local(" /model "))
    assertEquals(SlashCommandMenu.Local.SetModel("opus"), SlashCommandMenu.local("/model opus"))
    assertNull(SlashCommandMenu.local("/compact"))
    assertEquals(SlashCommandMenu.Local.ShowUsageLimits, SlashCommandMenu.local("/usage-limits"))
    assertNull(SlashCommandMenu.local("/usage-limits now"))
    assertNull(SlashCommandMenu.local("plan"))
  }
}

class ComposerKeymapTest {
  private fun action(key: ComposerKey, menu: Boolean = false, running: Boolean = false) =
    ComposerKeymap.action(key, menu, running)

  @Test fun `Return sends and Shift+Return is a newline`() {
    assertEquals(ComposerKeyAction.Send, action(ComposerKey.Return(false)))
    assertEquals(ComposerKeyAction.PassThrough, action(ComposerKey.Return(true)))
    assertEquals(ComposerKeyAction.Send, action(ComposerKey.Return(false), running = true))
  }

  @Test fun `an open menu takes the arrows, Tab, Return and Esc`() {
    assertEquals(ComposerKeyAction.MenuMove(1), action(ComposerKey.Down, menu = true))
    assertEquals(ComposerKeyAction.MenuMove(-1), action(ComposerKey.Up, menu = true))
    assertEquals(ComposerKeyAction.MenuAccept, action(ComposerKey.Tab(false), menu = true))
    assertEquals(ComposerKeyAction.MenuAccept, action(ComposerKey.Return(false), menu = true))
    assertEquals(ComposerKeyAction.MenuDismiss, action(ComposerKey.Escape, menu = true))
    assertEquals(ComposerKeyAction.PassThrough, action(ComposerKey.Return(true), menu = true))
    assertEquals(ComposerKeyAction.PassThrough, action(ComposerKey.Up))
  }

  @Test fun `Shift+Tab cycles the mode and Ctrl+period interrupts only a running agent`() {
    assertEquals(ComposerKeyAction.CyclePermissionMode, action(ComposerKey.Tab(true)))
    assertEquals(ComposerKeyAction.PassThrough, action(ComposerKey.Tab(false)))
    assertEquals(ComposerKeyAction.Interrupt, action(ComposerKey.CommandPeriod, running = true))
    assertEquals(ComposerKeyAction.Ignore, action(ComposerKey.CommandPeriod))
    assertEquals(ComposerKeyAction.Ignore, action(ComposerKey.Escape, running = true))
  }

  @Test fun `Tab takes a suggested reply after any open menu`() {
    assertEquals(ComposerKeyAction.AcceptFollowUp, ComposerKeymap.action(ComposerKey.Tab(false), false, false, true))
    assertEquals(ComposerKeyAction.MenuAccept, ComposerKeymap.action(ComposerKey.Tab(false), true, false, true))
    assertEquals(ComposerKeyAction.CyclePermissionMode, ComposerKeymap.action(ComposerKey.Tab(true), false, false, true))
  }

  @Test fun `menus clamp`() {
    assertEquals(0, ComposerKeymap.move(0, -1, 3))
    assertEquals(2, ComposerKeymap.move(2, 1, 3))
    assertEquals(2, ComposerKeymap.move(1, 1, 3))
    assertEquals(0, ComposerKeymap.move(4, 1, 0))
  }
}

class ComposerControlsTest {
  @Test fun `native and canonical mode names read the same`() {
    assertEquals(RemotePermissionMode.ask, ComposerPermissionMode.canonical("default"))
    assertEquals(RemotePermissionMode.review, ComposerPermissionMode.canonical("acceptEdits"))
    assertEquals(RemotePermissionMode.plan, ComposerPermissionMode.canonical("plan"))
    assertEquals(RemotePermissionMode.auto, ComposerPermissionMode.canonical(null))
    assertEquals(RemotePermissionMode.auto, ComposerPermissionMode.canonical("bypassPermissions"))
    assertEquals("Accept edits", ComposerPermissionMode.label(RemotePermissionMode.review))
  }

  @Test fun `Shift+Tab order is auto, ask, plan, review`() {
    var mode = RemotePermissionMode.auto
    val seen = (0 until 4).map { mode = ComposerPermissionMode.next(mode); mode }
    assertEquals(listOf(RemotePermissionMode.ask, RemotePermissionMode.plan, RemotePermissionMode.review, RemotePermissionMode.auto), seen)
  }

  @Test fun `effort adds ultracode beside xhigh and hides without levels`() {
    val a = RemoteModelInfo("a", "A", "", supportsEffort = true, supportedEffortLevels = listOf("low", "high", "xhigh"))
    val b = RemoteModelInfo("b", "B", "", supportsEffort = false)
    assertEquals(listOf("low", "high", "xhigh", "ultracode"), ComposerEffort.levels(a))
    assertTrue(ComposerEffort.levels(b).isEmpty())
    assertEquals("Default", ComposerEffort.label(null))
    assertEquals("Extra high", ComposerEffort.label("xhigh"))
  }

  private fun models(vararg values: String) = values.map { RemoteModelInfo(it, it, "") }
  private fun caps(models: List<RemoteModelInfo>) = RemoteAgentCapabilities(models, emptyList(), emptyList())

  @Test fun `an agent's own models win, without them another agent's`() {
    val byAgent = mapOf("a" to caps(emptyList()), "b" to caps(models("default", "sonnet")))
    assertEquals(listOf("opus"), ComposerOptions.models(models("opus"), byAgent).map { it.value })
    assertEquals(listOf("default", "sonnet"), ComposerOptions.models(emptyList(), byAgent).map { it.value })
    assertTrue(ComposerOptions.models(emptyList(), mapOf("a" to caps(emptyList()))).isEmpty())
  }

  @Test fun `no pick is the CLI default and an unknown one falls back to the first`() {
    val list = models("default", "sonnet")
    assertEquals("default", ComposerOptions.current(null, list)?.value)
    assertEquals("sonnet", ComposerOptions.current("sonnet", list)?.value)
    assertEquals("default", ComposerOptions.current("gone", list)?.value)
  }

  @Test fun `the session's own project isn't linkable`() {
    val projects = listOf(RemoteProject("/a", "A"), RemoteProject("/b", "B"))
    assertEquals(listOf("/b"), ComposerOptions.linkable(projects, "/a").map { it.repoRoot })
    assertEquals(2, ComposerOptions.linkable(projects, null).size)
  }
}

class FollowUpsTest {
  private val items = listOf("Yes, add the tests", "Commit it")

  @Test fun `a typed prefix completes case-insensitively`() {
    assertEquals(" the tests", FollowUps.completion("yes, add", items))
    assertEquals("it it", FollowUps.completion("Comm", items))
    assertNull(FollowUps.completion("", items))
    assertNull(FollowUps.completion("Please", items))
    assertNull(FollowUps.completion("Commit it", items))
    assertNull(FollowUps.completion("Yes\n", items))
  }

  @Test fun `Tab fills the completion or the first reply into an empty input`() {
    assertEquals("Yes, add the tests", FollowUps.accepted("", items))
    assertEquals("Commit it", FollowUps.accepted("Comm", items))
    assertNull(FollowUps.accepted("Please", items))
    assertNull(FollowUps.accepted("", emptyList()))
  }
}

class AttachmentLogicTest {
  private val png = java.util.Base64.getDecoder().decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  )

  @Test fun `an accepted format goes out byte for byte with its sniffed type`() {
    val pending = ImageAttachments.pending(png) { error("no re-encode for an accepted type") }!!
    assertEquals("image/png", pending.attachment.mediaType)
    assertEquals(java.util.Base64.getEncoder().encodeToString(png), pending.attachment.data)
    assertEquals("image/jpeg", ImageAttachments.sniff(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0)))
  }

  @Test fun `non-images are refused and others re-encoded`() {
    assertNull(ImageAttachments.pending("nope".toByteArray()) { null })
    assertEquals("image/jpeg", ImageAttachments.pending("heic".toByteArray()) { byteArrayOf(1) }!!.attachment.mediaType)
    assertTrue(ImageAttachments.isImage("b.webp"))
    assertTrue(!ImageAttachments.isImage("b.swift"))
  }

  @Test fun `files send as escaped mentions`() {
    val files = listOf(PendingFile("a", 1, "x/spec.pdf"), PendingFile("b", 1, "x/my notes.txt"), PendingFile("c", 1))
    assertEquals("Attached files: @x/spec.pdf @x/my\\ notes.txt", PendingFile.mentions(files))
    assertNull(PendingFile.mentions(listOf(PendingFile("c", 1))))
  }

  @Test fun `a picked element's body carries its context and its display a chip`() {
    val element = PickedElement(PickedElement.Source.Browser, "button.save", "[ctx]", null)
    assertEquals("make this red\n\n[ctx]", PickedElement.body("make this red", listOf(element)))
    assertEquals("(see the picked element)\n\n[ctx]", PickedElement.body("", listOf(element)))
    assertEquals("make this red\n\n[Element: button.save]", PickedElement.display("make this red", listOf(element)))
  }

  @Test fun `an agent's draft images come back as saved, and only its own`() {
    val dir = kotlin.io.path.createTempDirectory("drafts").toFile()
    val store = DraftAttachments(dir)
    val images = listOf(ImageAttachments.attachment(png, "image/png"))
    store.save(images, "agent/1")
    assertEquals(images, store.load("agent/1"))
    assertTrue(store.load("agent-2").isEmpty())
    store.save(emptyList(), "agent/1")
    assertTrue(store.load("agent/1").isEmpty())
    dir.deleteRecursively()
  }
}
