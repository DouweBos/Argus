package dev.houwert.argus.ui.composer

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallStatus
import dev.houwert.argus.kit.storage.InMemoryKeyValueStore
import dev.houwert.argus.kit.storage.Preferences
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpokenTextTest {
  @Test fun `code and tables are skipped, markdown and links read as words`() {
    val markdown = """
      ## Done

      I fixed **the build** in `Package.swift`. See [the PR](https://example.com/pr/1).

      ```swift
      let x = 1
      ```

      | a | b |
      |---|---|
      | 1 | 2 |

      - Tests pass
      1. Ship it
      Docs at https://example.com/docs
    """.trimIndent()
    assertEquals(
      "Done. I fixed the build in Package.swift. See the PR. Code is on screen. A table is on screen. " +
        "Tests pass. Ship it. Docs at a link.",
      SpokenText.reply(markdown),
    )
  }

  @Test fun `a long reply stops at a sentence and points at the screen`() {
    val reply = SpokenText.reply("This is a sentence. ".repeat(200))
    assertTrue(reply.length < SpokenText.REPLY_LIMIT + 40)
    assertTrue(reply.endsWith("sentence. The rest is on screen."))
  }

  @Test fun `permission prompts name what the agent wants to do`() {
    assertEquals(
      "The agent wants to run pnpm test. Allow or deny?",
      SpokenText.permission("Bash", mapOf("command" to JsonPrimitive("pnpm test"))),
    )
    assertEquals(
      "The agent wants to edit app.ts. Allow or deny?",
      SpokenText.permission("Edit", mapOf("file_path" to JsonPrimitive("/repo/src/app.ts"))),
    )
    assertTrue(SpokenText.permission("mcp__linear__get_issue", emptyMap()).contains("use issue"))
    assertTrue(SpokenText.permission("Bash", mapOf("command" to JsonPrimitive("x".repeat(200)))).contains("run a long command"))
  }

  @Test fun `only a whole-utterance answer counts`() {
    assertEquals(SpokenText.Answer.Allow, SpokenText.answer("Allow."))
    assertEquals(SpokenText.Answer.Allow, SpokenText.answer("yes please"))
    assertEquals(SpokenText.Answer.Deny, SpokenText.answer("Deny"))
    assertEquals(SpokenText.Answer.Deny, SpokenText.answer("No."))
    assertNull(SpokenText.answer("no I want you to run the tests first"))
    assertNull(SpokenText.answer(""))
  }

  @Test fun `the reply's own echo is told apart from the user`() {
    val spoken = "I fixed the build. Tests pass."
    assertTrue(SpokenText.novelWords("fixed the build", spoken).isEmpty())
    assertEquals(listOf("wait", "stop"), SpokenText.novelWords("fixed the wait stop", spoken))
    assertEquals(4, SpokenText.echoLength("I fixed the build now run the tests", spoken))
    assertEquals(2, SpokenText.echoLength("tests pass", spoken))
    assertEquals("now run the tests", SpokenText.dropping(4, "I fixed the build now run the tests"))
  }
}

@OptIn(ExperimentalCoroutinesApi::class)
class ComposerVoiceTest {
  private val host = FakeComposerHost()
  private val engine = FakeVoiceEngine()
  private val speaker = FakeSpeaker()
  private val scheduler = TestCoroutineScheduler()

  private fun model(foreground: Boolean = false, onlyInBackground: Boolean = false): ComposerModel {
    val preferences = Preferences(InMemoryKeyValueStore())
    VoiceSettings(onlyInBackground = onlyInBackground).save(preferences)
    host.status("a1", RemoteAgentStatusStatus.idle)
    return ComposerModel(
      "a1", "s1", host, CoroutineScope(UnconfinedTestDispatcher(scheduler)), preferences = preferences,
      dictationEngine = { engine },
      voice = VoiceEnvironment({ speaker }, { foreground }, pauseMs = 40, giveUpMs = 400),
    )
  }

  /** The agent runs a turn and ends it with `reply`. */
  private fun finishTurn(composer: ComposerModel, reply: String) {
    host.status("a1", RemoteAgentStatusStatus.running)
    composer.voiceTurnStarted()
    val message = RemoteMessage(UUID.randomUUID().toString(), RemoteMessageRole.assistant, listOf(reply), emptyList())
    host.messagesByAgent.value += "a1" to (host.messagesByAgent.value["a1"].orEmpty() + message)
    host.status("a1", RemoteAgentStatusStatus.idle)
    composer.voiceCueChanged()
  }

  private fun settle() = scheduler.runCurrent()

  private fun pass(ms: Long) {
    scheduler.advanceTimeBy(ms)
    scheduler.runCurrent()
  }

  @Test fun `turning it on opens the microphone, a pause sends what was said`() {
    val composer = model()
    val affordances = mutableListOf<ChatInputAffordance>()
    composer.onAffordance = { affordances += it }
    composer.setVoiceMode(true)
    settle()
    assertEquals(DictationPhase.Listening, composer.dictation.value)
    engine.say("run the tests")
    settle()
    assertEquals("run the tests", composer.text.value)
    pass(120)
    assertEquals(listOf("run the tests"), host.sent.map { it.message })
    assertTrue(composer.text.value.isEmpty())
    assertEquals(listOf(ChatInputAffordance.VoiceMode, ChatInputAffordance.VoiceSend), affordances)
  }

  @Test fun `a finished turn's reply is read aloud, then the microphone opens again`() {
    val composer = model()
    composer.setVoiceMode(true)
    settle()
    engine.say("hi")
    pass(120)
    finishTurn(composer, "All **done**.\n\n```\ncode\n```")
    settle()
    assertEquals(listOf("All done. Code is on screen."), speaker.spoken)
    assertEquals(DictationPhase.Listening, composer.dictation.value)
    assertEquals(2, engine.starts)
  }

  @Test fun `a reply already on screen when the agent opens isn't read`() {
    host.messagesByAgent.value = mapOf("a1" to listOf(RemoteMessage("m0", RemoteMessageRole.assistant, listOf("Earlier."), emptyList())))
    val composer = model()
    composer.setVoiceMode(true)
    composer.voiceCueChanged()
    settle()
    assertTrue(speaker.spoken.isEmpty())
    assertEquals(DictationPhase.Listening, composer.dictation.value)
  }

  @Test fun `talking over the reply stops it, and only the user's words land`() {
    val composer = model()
    composer.setVoiceMode(true)
    settle()
    speaker.holds = true
    finishTurn(composer, "I fixed the build.")
    settle()
    assertTrue(composer.speaking.value)
    engine.say("fixed the build")
    settle()
    assertTrue(composer.speaking.value)
    assertTrue(composer.text.value.isEmpty())
    engine.say("fixed the build wait run it again")
    settle()
    assertFalse(composer.speaking.value)
    assertTrue(speaker.stops > 0)
    assertEquals("wait run it again", composer.text.value)
  }

  @Test fun `a permission prompt is read, and a spoken allow answers it`() {
    val composer = model()
    val affordances = mutableListOf<ChatInputAffordance>()
    composer.onAffordance = { affordances += it }
    composer.setVoiceMode(true)
    settle()
    host.pending = listOf(call("t1", "Bash", mapOf("command" to JsonPrimitive("pnpm test"))))
    composer.voiceCueChanged()
    settle()
    assertEquals("The agent wants to run pnpm test. Allow or deny?", speaker.spoken.last())
    engine.say("Allow.")
    pass(120)
    assertEquals(listOf("t1" to "allow"), host.decisions)
    assertTrue(host.sent.isEmpty())
    assertTrue(composer.text.value.isEmpty())
    assertTrue(ChatInputAffordance.VoiceAnswer in affordances)
  }

  @Test fun `an unclear answer is asked again, not sent as a message`() {
    val composer = model()
    composer.setVoiceMode(true)
    settle()
    host.pending = listOf(call("t1", "Bash", mapOf("command" to JsonPrimitive("ls"))))
    composer.voiceCueChanged()
    settle()
    engine.say("maybe later")
    pass(120)
    assertTrue(host.decisions.isEmpty())
    assertTrue(host.sent.isEmpty())
    assertEquals(SpokenText.REPEAT_ANSWER, speaker.spoken.last())
    assertEquals(DictationPhase.Listening, composer.dictation.value)
  }

  @Test fun `a question is announced and left to the screen`() {
    val composer = model()
    composer.setVoiceMode(true)
    settle()
    host.pending = listOf(call("t1", "ExitPlanMode", mapOf("plan" to JsonPrimitive("Do it"))))
    composer.voiceCueChanged()
    settle()
    assertEquals("Plan ready for review. It's on screen.", speaker.spoken.last())
    assertEquals(DictationPhase.Idle, composer.dictation.value)
  }

  @Test fun `only-in-background stays quiet in front but still listens`() {
    val composer = model(foreground = true, onlyInBackground = true)
    composer.setVoiceMode(true)
    settle()
    engine.say("hi")
    pass(120)
    finishTurn(composer, "Done.")
    settle()
    assertTrue(speaker.spoken.isEmpty())
    assertEquals(DictationPhase.Listening, composer.dictation.value)
  }

  @Test fun `silence closes the microphone without sending, turning it off stops speech`() {
    val composer = model()
    composer.setVoiceMode(true)
    settle()
    pass(600)
    assertEquals(DictationPhase.Idle, composer.dictation.value)
    assertTrue(host.sent.isEmpty())
    assertTrue(composer.voiceMode.value)
    speaker.holds = true
    composer.toggleVoiceMode()
    assertFalse(composer.voiceMode.value)
    assertFalse(composer.speaking.value)
  }

  @Test fun `voice mode is one switch for the app, remembered across composers`() {
    val preferences = Preferences(InMemoryKeyValueStore())
    val environment = VoiceEnvironment({ speaker }, { false })
    val scope = CoroutineScope(UnconfinedTestDispatcher(scheduler))
    ComposerModel("a1", "s1", host, scope, preferences = preferences, dictationEngine = { engine }, voice = environment).setVoiceMode(true)
    assertTrue(ComposerModel("a2", "s1", host, scope, preferences = preferences, voice = environment).voiceMode.value)
    val starter = ComposerStarter("auto") { true }
    assertFalse(ComposerModel(null, "s1", host, scope, starter, preferences, voice = environment).voiceMode.value)
  }

  private fun call(id: String, name: String, input: Map<String, JsonElement>) =
    RemoteToolCall(id = id, name = name, input = input, resultBlocks = emptyList(), status = RemoteToolCallStatus.pending)
}

/** Says what it's told: each `say` is the whole transcript so far, and stopping returns the last of it. */
class FakeVoiceEngine : DictationEngine {
  private var onTranscript: ((String) -> Unit)? = null
  private var latest = ""
  var starts = 0

  override suspend fun start(onTranscript: (String) -> Unit, onEnded: () -> Unit) {
    starts++
    latest = ""
    this.onTranscript = onTranscript
  }

  override suspend fun stop(): String = latest

  fun say(text: String) {
    latest = text
    onTranscript?.invoke(text)
  }
}

class FakeSpeaker : SpeechSynthesizer {
  val spoken = mutableListOf<String>()
  var stops = 0
  /** Keeps speaking until stopped, to talk over it. */
  var holds = false
  private var pending: CompletableDeferred<Unit>? = null

  override suspend fun speak(text: String, settings: VoiceSettings) {
    spoken += text
    if (!holds) return
    CompletableDeferred<Unit>().also { pending = it }.await()
  }

  override fun stop() {
    stops++
    pending?.complete(Unit)
    pending = null
  }
}
