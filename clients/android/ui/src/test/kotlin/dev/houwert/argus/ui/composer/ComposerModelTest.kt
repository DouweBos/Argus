package dev.houwert.argus.ui.composer

import dev.houwert.argus.core.sessions.ComposerStart
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccountAccountType
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteRunnerModel
import dev.houwert.argus.kit.storage.InMemoryKeyValueStore
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.storage.Preferences
import dev.houwert.argus.kit.util.LinkedProjects
import java.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ComposerModelTest {
  private val host = FakeComposerHost()
  private val preferences = Preferences(InMemoryKeyValueStore())
  private val drafts = DraftAttachments()
  private val pixel = PendingImage(ImageAttachments.attachment(Base64.getDecoder().decode("iVBORw0KGgo="), "image/png"))

  private fun model(
    status: RemoteAgentStatusStatus? = RemoteAgentStatusStatus.idle,
    starter: ComposerStarter? = null,
    engine: (() -> DictationEngine)? = null,
  ): ComposerModel {
    status?.let { host.status("a1", it) }
    return ComposerModel(
      if (starter == null) "a1" else null, "s1", host, CoroutineScope(Dispatchers.Unconfined), starter,
      preferences, drafts, engine,
    )
  }

  private fun account(id: String) =
    RemoteClaudeAccount(id, label = id, needsReauth = false, rateLimited = false, accountType = RemoteClaudeAccountAccountType.claudeai)

  private fun runner(id: String, models: List<String>) =
    RemoteRunner(id, id, isCustom = true, models = models.map { RemoteRunnerModel(it, it.uppercase()) })

  private fun talk() {
    host.messagesByAgent.value = mapOf("a1" to listOf(RemoteMessage("m1", RemoteMessageRole("user"), listOf("go"), emptyList())))
  }

  @Test fun `an idle agent is sent the message and the draft clears`() {
    val composer = model()
    composer.setText("  fix the build  ")
    composer.submit()
    assertEquals(listOf("fix the build"), host.sent.map { it.message })
    assertTrue(host.queued.isEmpty())
    assertEquals("", composer.text.value)
    assertNull(preferences.string(PreferenceKey.draft("a1")))
  }

  @Test fun `a running agent gets the message queued`() {
    val composer = model(RemoteAgentStatusStatus.running)
    composer.setText("next")
    composer.submit()
    assertEquals(listOf("next"), host.queued.map { it.message })
    assertTrue(host.sent.isEmpty())
  }

  @Test fun `images alone send as see attached images and links ride one message`() {
    val composer = model()
    composer.attach(listOf(pixel))
    composer.toggleLink("/repos/other")
    composer.submit()
    val sent = host.sent.single()
    assertNull(sent.displayText)
    assertEquals(LinkedProjects.buildPreamble(listOf("/repos/other"), "(see attached images)"), sent.message)
    assertEquals(1, sent.images.size)
    assertTrue(composer.linkedProjects.value.isEmpty())
    assertTrue(composer.images.value.isEmpty())
    assertNull(preferences.string(PreferenceKey.linkedProjects("a1")))
  }

  @Test fun `files send as mentions of where the host saved them`() {
    val composer = model()
    composer.setText("read these")
    composer.attachFiles(listOf(PickedFile("spec.pdf", 10) { ByteArray(10) }, PickedFile("my notes.txt", 4) { ByteArray(4) }))
    assertTrue(composer.files.value.none { it.isUploading })
    composer.submit()
    assertEquals(
      "read these\n\nAttached files: @.argus/attachments/x/spec.pdf @.argus/attachments/x/my\\ notes.txt",
      host.sent.single().message,
    )
    assertTrue(composer.files.value.isEmpty())
  }

  @Test fun `a failed upload drops its chip and a send waits while one uploads`() {
    val composer = model()
    host.failingAttachments = setOf("broken.bin")
    composer.attachFiles(listOf(PickedFile("broken.bin", 1) { ByteArray(1) }))
    assertTrue(composer.files.value.isEmpty())

    val gate = CompletableDeferred<Unit>()
    host.attachmentGate = gate
    composer.attachFiles(listOf(PickedFile("slow.zip", 1) { ByteArray(1) }))
    assertTrue(composer.hasContent)
    assertFalse(composer.canSend())
    composer.submit()
    assertTrue(host.sent.isEmpty())
    gate.complete(Unit)
    assertTrue(composer.canSend())
  }

  @Test fun `a picked element sends its context and crop, the bubble shows a chip`() {
    val composer = model()
    composer.attach(PickedElement(PickedElement.Source.Browser, "button.save", "[ctx]", pixel.attachment))
    assertTrue(composer.hasContent)
    composer.setText("make this red")
    composer.submit()
    val sent = host.sent.single()
    assertEquals("make this red\n\n[ctx]", sent.message)
    assertEquals("make this red\n\n[Element: button.save]", sent.displayText)
    assertEquals(1, sent.images.size)
    assertTrue(composer.elements.value.isEmpty())
  }

  @Test fun `plan toggles plan mode and model sets or opens the picker, never reaching the CLI`() {
    val composer = model()
    composer.setText("/plan"); composer.submit()
    composer.setText("/model opus"); composer.submit()
    composer.setText("/model"); composer.submit()
    assertEquals(listOf(RemotePermissionMode.plan), host.modes)
    assertEquals(listOf("opus"), host.models)
    assertTrue(composer.showingModelPicker.value)
    assertTrue(host.sent.isEmpty())
  }

  @Test fun `a local command with an image attached goes to the CLI as text`() {
    val composer = model()
    composer.attach(listOf(pixel))
    composer.setText("/plan")
    composer.submit()
    assertEquals(listOf("/plan"), host.sent.map { it.message })
    assertTrue(host.modes.isEmpty())
  }

  @Test fun `usage-limits goes to the agent while no usage store offers it`() {
    val composer = model()
    composer.setText("/usage-limits")
    composer.submit()
    assertEquals(listOf("/usage-limits"), host.sent.map { it.message })
  }

  @Test fun `the phone takes input for a stopped agent`() {
    val composer = model(RemoteAgentStatusStatus.stopped)
    composer.setText("hello")
    composer.submit()
    assertTrue(composer.isEnabled)
    assertEquals(1, host.sent.size)
  }

  @Test fun `side questions need a conversation, and a start composer has none`() {
    val composer = model()
    assertFalse(composer.hasConversation)
    talk()
    assertTrue(composer.hasConversation)
    assertFalse(model(null, ComposerStarter("auto") { true }).hasConversation)
  }

  @Test fun `the draft's text, images and links come back on load`() = runBlocking {
    val first = model()
    first.setText("half a thought")
    first.attach(listOf(pixel))
    first.toggleLink("/repos/other")

    val second = model()
    second.load()
    assertEquals("half a thought", second.text.value)
    assertEquals("half a thought".length, second.caret.value)
    assertEquals(listOf(pixel.attachment), second.images.value.map { it.attachment })
    assertEquals(listOf("/repos/other"), second.linkedProjects.value)
    assertEquals(listOf("a1"), host.loadedCapabilities)
  }

  @Test fun `a start composer keeps its picks and hands them to the agent it starts`() {
    val started = mutableListOf<ComposerStart>()
    val composer = model(null, ComposerStarter("auto") { started += it; true })
    composer.setPermissionMode(RemotePermissionMode.plan)
    composer.setText("/model sonnet"); composer.submit()
    composer.setText("build it"); composer.submit()
    assertTrue(host.modes.isEmpty())
    assertTrue(host.models.isEmpty())
    assertEquals(listOf("build it"), started.map { it.message })
    assertEquals(RemotePermissionMode.plan, started.first().permissionMode)
    assertEquals("sonnet", started.first().model)
    assertEquals("", composer.text.value)
    assertEquals(RemotePermissionMode.auto, composer.permissionMode)
    assertFalse(composer.starting.value)
  }

  @Test fun `a start that fails keeps the draft`() {
    val composer = model(null, ComposerStarter("auto") { false })
    composer.setText("build it")
    composer.submit()
    assertEquals("build it", composer.text.value)
    assertFalse(composer.starting.value)
  }

  @Test fun `a redirect that needs text won't start from images alone`() {
    val composer = model()
    composer.attach(listOf(pixel))
    assertTrue(composer.canSend())
    assertFalse(composer.canSend(ComposerStarter("auto", needsText = true) { true }))
  }

  @Test fun `a redirect that isn't ready won't start and one needing no content starts empty`() {
    val started = mutableListOf<ComposerStart>()
    val composer = model(null, ComposerStarter("auto") { true })
    composer.setText("fix it")
    assertFalse(composer.canSend(ComposerStarter("auto", ready = false) { true }))
    composer.setText("")
    val issues = ComposerStarter("auto", needsContent = false) { started += it; true }
    assertTrue(composer.canSend(issues))
    composer.submit(issues)
    assertEquals(listOf(""), started.map { it.message })
  }

  @Test fun `a runner's declared models replace the reported ones, hide effort, and ride the start`() {
    val started = mutableListOf<ComposerStart>()
    val composer = model(null, ComposerStarter("auto") { started += it; true })
    composer.setModel("opus")
    composer.setRunner(runner("gw", listOf("m1")))
    assertEquals(listOf("m1"), composer.models.map { it.value })
    assertEquals("Default", composer.modelLabel)
    assertTrue(composer.effortLevels.isEmpty())
    composer.setText("go")
    composer.submit()
    assertEquals("gw", started.first().runnerId)
    assertNull(started.first().model)
  }

  @Test fun `a start picks its account, which rides the start once`() {
    val started = mutableListOf<ComposerStart>()
    host.claudeAccounts.value = listOf(account("work"), account("side"))
    val composer = model(null, ComposerStarter("auto") { started += it; true })
    assertTrue(composer.offersAccounts)
    assertEquals(FOLLOW_DEFAULT_ACCOUNT, composer.accountId)
    composer.setAccount("side")
    assertEquals("side", composer.accountId)
    composer.setText("go")
    composer.submit()
    assertEquals("side", started.first().accountId)
    assertEquals(FOLLOW_DEFAULT_ACCOUNT, composer.accountId)
    composer.setRunner(runner("gw", emptyList()))
    assertFalse(composer.offersAccounts)
  }

  @Test fun `before a conversation the default is a choice, after it the agent's account is ticked`() {
    host.claudeAccounts.value = listOf(account("work"), account("side"))
    host.activeClaudeAccountId.value = "work"
    val composer = model()
    assertTrue(composer.offersFollowDefault)
    assertEquals(FOLLOW_DEFAULT_ACCOUNT, composer.checkedAccountId)

    talk()
    host.status("a1", RemoteAgentStatusStatus.idle, accountId = "side")
    assertFalse(composer.offersFollowDefault)
    assertEquals("side", composer.checkedAccountId)
    assertNull(composer.accountHint("side"))
    composer.setAccount("side")
    assertTrue(host.pins.isEmpty())

    composer.setAccount("work")
    assertEquals("work", host.pins["s1"])
    assertEquals("work", composer.checkedAccountId)
    assertEquals("After this turn", composer.accountHint("work"))
    assertNull(composer.accountHint("side"))
    host.status("a1", RemoteAgentStatusStatus.idle, accountId = "work")
    assertNull(composer.accountHint("work"))
  }

  @Test fun `a start whose account picker was never touched leaves the pin alone`() {
    val started = mutableListOf<ComposerStart>()
    val composer = model(null, ComposerStarter("auto") { started += it; true })
    composer.setText("go")
    composer.submit()
    assertNull(started.first().accountId)
  }

  @Test fun `a picked runner drops the starter's default model`() {
    val composer = model(null, ComposerStarter("auto", defaultModel = "opus") { true })
    assertEquals("opus", composer.pickedModel)
    composer.setRunner(runner("gemini", emptyList()))
    assertNull(composer.pickedModel)
    composer.setRunner(null)
    assertEquals("opus", composer.pickedModel)
  }

  @Test fun `an @ at the caret opens the menu and picking a file inserts it`() = runBlocking {
    val composer = model()
    host.files = listOf("src/app.swift", "README.md")
    composer.load()
    composer.setText("see @app", 8)
    assertEquals(listOf("app.swift"), composer.mentionItems.map { it.display })
    composer.acceptMention(composer.mentionItems[0])
    assertEquals("see @src/app.swift ", composer.text.value)
  }

  @Test fun `only the newest browse lookup lands`() = runBlocking {
    val composer = ComposerModel("a1", "s1", host, this, null, preferences, drafts)
    host.mentionDelay = { if (it == "src/") 20 else 0 }
    host.mentionEntries = mapOf("src/" to listOf("old.swift"), "lib/" to listOf("new.swift"))
    composer.setText("@src/", 5)
    yield()
    composer.setText("@lib/", 5)
    delay(80)
    assertEquals(listOf("lib", "new.swift"), composer.mentionItems.map { it.display })
  }

  @Test fun `Esc closes the menu until the text changes`() {
    val composer = model()
    composer.setText("/")
    assertTrue(composer.slashItems.isNotEmpty())
    assertTrue(composer.handle(ComposerKey.Escape))
    assertTrue(composer.slashItems.isEmpty())
    composer.setText("/c")
    assertTrue(composer.slashItems.isNotEmpty())
  }

  @Test fun `Return sends and Shift+Return passes through`() {
    val composer = model()
    composer.setText("go")
    assertFalse(composer.handle(ComposerKey.Return(true)))
    assertTrue(composer.handle(ComposerKey.Return(false)))
    assertEquals(listOf("go"), host.sent.map { it.message })
  }

  @Test fun `arrows move through an open menu and Return takes the pick`() {
    val composer = model()
    composer.setText("/cl")
    assertTrue(composer.handle(ComposerKey.Return(false)))
    assertEquals("/clear ", composer.text.value)
    assertTrue(host.sent.isEmpty())
  }

  @Test fun `Ctrl+period interrupts a running agent`() {
    val composer = model(RemoteAgentStatusStatus.running)
    assertTrue(composer.handle(ComposerKey.CommandPeriod))
    assertEquals(listOf("a1"), host.interrupted)
  }

  @Test fun `a pending limit resume shows only for a live agent`() {
    host.statusByAgent.value = emptyMap()
    assertNull(ComposerModel.pendingLimitResume(null))
    val idle = dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus("a", "s", status = RemoteAgentStatusStatus.idle, limitResumeAt = 1000.0)
    assertEquals(1000.0, ComposerModel.pendingLimitResume(idle))
    assertNull(ComposerModel.pendingLimitResume(idle.copy(status = RemoteAgentStatusStatus.stopped)))
    assertNull(ComposerModel.pendingLimitResume(idle.copy(status = RemoteAgentStatusStatus.error)))
  }
}

class ComposerDictationTest {
  private class FakeEngine(val final: String, val error: String? = null) : DictationEngine {
    var onTranscript: ((String) -> Unit)? = null
    var onEnded: (() -> Unit)? = null
    var stops = 0
    override suspend fun start(onTranscript: (String) -> Unit, onEnded: () -> Unit) {
      error?.let { throw DictationException(it) }
      this.onTranscript = onTranscript
      this.onEnded = onEnded
    }
    override suspend fun stop(): String { stops++; return final }
  }

  private val host = FakeComposerHost()

  private fun model(engine: FakeEngine) =
    ComposerModel("a1", "s1", host, CoroutineScope(Dispatchers.Unconfined), preferences = Preferences(InMemoryKeyValueStore()), dictationEngine = { engine })

  @Test fun `partials fill the draft, the final transcript stays for review, nothing is sent`() {
    val engine = FakeEngine("run the tests")
    val composer = model(engine)
    val affordances = mutableListOf<ChatInputAffordance>()
    composer.onAffordance = { affordances += it }
    composer.setText("please", 6)
    composer.startDictation()
    assertEquals(DictationPhase.Listening, composer.dictation.value)
    assertFalse(composer.canSend())
    engine.onTranscript?.invoke("run the")
    assertEquals("please run the", composer.text.value)
    composer.stopDictation()
    assertEquals(DictationPhase.Idle, composer.dictation.value)
    assertEquals("please run the tests", composer.text.value)
    assertTrue(host.sent.isEmpty())
    assertEquals(listOf(ChatInputAffordance.Dictation), affordances)
    assertTrue(composer.canSend())
  }

  @Test fun `an engine that ends by itself finishes the run`() {
    val engine = FakeEngine("done")
    val composer = model(engine)
    composer.startDictation()
    engine.onEnded?.invoke()
    assertEquals(DictationPhase.Idle, composer.dictation.value)
    assertEquals("done", composer.text.value)
    assertEquals(1, engine.stops)
  }

  @Test fun `a refusal surfaces and can be dismissed`() {
    val composer = model(FakeEngine("", error = "Turn on microphone access"))
    composer.startDictation()
    assertTrue(composer.dictation.value.failure!!.contains("microphone"))
    composer.dismissDictationError()
    assertEquals(DictationPhase.Idle, composer.dictation.value)
  }
}
