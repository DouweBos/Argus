package dev.houwert.argus.ui.composer

import dev.houwert.argus.core.transcript.PendingPrompts
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.util.PendingForm
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What voice mode reacts to: a finished turn's reply, or a decision the agent is waiting on. */
class VoiceCue(val id: String, val kind: Kind) {
  sealed interface Kind {
    data class Reply(val text: String) : Kind
    /** Allow / deny, answered aloud. */
    data class Permission(val call: RemoteToolCall) : Kind
    /** A question, plan or secret, which only the screen can answer. */
    data class OnScreen(val title: String) : Kind
  }

  override fun equals(other: Any?) = other is VoiceCue && other.id == id
  override fun hashCode() = id.hashCode()
}

/** What a voice-mode listen is for. */
internal sealed interface VoiceListen {
  data object Prompt : VoiceListen
  data class Answer(val toolUseId: String) : VoiceListen
}

/** What voice mode needs from the device, injectable for tests. */
class VoiceEnvironment(
  val synthesizer: () -> SpeechSynthesizer,
  val isForeground: () -> Boolean,
  /** Silence after speech that sends it; null is the user's setting. */
  val pauseMs: Long? = null,
  /** Silence with nothing said that closes the microphone. */
  val giveUpMs: Long = 30_000,
)

// Hands-free: a finished turn's reply is read aloud, then the microphone opens and a pause sends what was said.
// Permission prompts are read too, and a spoken "allow" or "deny" answers them.

/** Changes whenever there's something new to say; the view hands it back through [voiceCueChanged]. */
val ComposerModel.voiceCue: VoiceCue?
  get() {
    if (!voiceMode.value || starter != null) return null
    val messages = host.visibleMessages(agentId)
    host.pendingCalls(agentId, messages).firstOrNull()?.let { call ->
      if (PendingForm.of(call.name, call.input) == PendingForm.Buttons) return VoiceCue("prompt:${call.id}", VoiceCue.Kind.Permission(call))
      return VoiceCue("prompt:${call.id}", VoiceCue.Kind.OnScreen(PendingPrompts.title(call)))
    }
    if (status?.status != RemoteAgentStatusStatus.idle) return null
    for (message in messages.asReversed()) {
      if (message.role == RemoteMessageRole.user) return null
      val text = message.textBlocks.joinToString("\n\n").trim()
      if (message.role == RemoteMessageRole.assistant && message.isError != true && text.isNotEmpty()) {
        return VoiceCue("reply:${message.id}", VoiceCue.Kind.Reply(text))
      }
    }
    return null
  }

fun ComposerModel.toggleVoiceMode() = setVoiceMode(!voiceMode.value)

fun ComposerModel.setVoiceMode(on: Boolean) {
  if (on == voiceMode.value || (on && (voice == null || starter != null))) return
  _voiceMode.value = on
  VoiceSettings.setMode(on, preferences)
  if (!on) return stopVoice()
  onAffordance?.invoke(ChatInputAffordance.VoiceMode)
  val cue = voiceCue
  // A waiting prompt is read; a reply already on screen isn't, and the microphone opens for the next prompt.
  if (cue != null && cue.kind !is VoiceCue.Kind.Reply) return voiceCueChanged()
  cue?.let { voiceHandledCue = it.id }
  if (!isRunning) listen(VoiceListen.Prompt)
}

/** A turn started here; its reply is read when it ends. A reply that was already there when the agent opened isn't. */
fun ComposerModel.voiceTurnStarted() {
  if (voiceMode.value) voiceArmed = true
}

fun ComposerModel.voiceCueChanged() {
  if (!voiceMode.value) return
  val cue = voiceCue ?: return
  if (cue.id == voiceHandledCue) return
  if (cue.kind is VoiceCue.Kind.Reply && !voiceArmed) return
  voiceHandledCue = cue.id
  voiceArmed = false
  voiceJob?.cancel()
  voiceJob = scope.launch { runVoice(cue) }
}

/** Quiet and off the microphone; voice mode itself stays as it was. Words already heard stay in the draft. */
fun ComposerModel.stopVoice() {
  voiceJob?.cancel()
  voiceTimer?.cancel()
  // Before stopping: a speaker that returns at once mustn't count the reply as played out.
  _speaking.value = false
  voiceSynthesizer?.stop()
  if (dictationRun?.listen != null) stopDictation()
}

private suspend fun ComposerModel.runVoice(cue: VoiceCue) {
  voiceSynthesizer?.stop()
  // The user's own words stay in the draft; nothing half-said is sent.
  endDictation()
  if (!voiceMode.value) return
  when (val kind = cue.kind) {
    is VoiceCue.Kind.Reply -> {
      listen(VoiceListen.Prompt)
      say(SpokenText.reply(kind.text))
    }
    is VoiceCue.Kind.Permission -> {
      listen(VoiceListen.Answer(kind.call.id))
      say(SpokenText.permission(kind.call.name, kind.call.input))
    }
    is VoiceCue.Kind.OnScreen -> say(SpokenText.onScreen(kind.title))
  }
}

/** Opens the microphone first so the user can talk over the reply. */
private fun ComposerModel.listen(purpose: VoiceListen) {
  val voice = voice ?: return
  startDictation(DictationTrigger.Voice)
  val run = dictationRun ?: return
  if (run.trigger != DictationTrigger.Voice) return
  run.listen = purpose
  armVoiceTimer(run, voice.giveUpMs)
}

private suspend fun ComposerModel.say(text: String) {
  val voice = voice ?: return
  val settings = VoiceSettings.load(preferences)
  if (text.isEmpty() || (settings.onlyInBackground && voice.isForeground())) return
  val synthesizer = voiceSynthesizer ?: voice.synthesizer().also { voiceSynthesizer = it }
  val run = dictationRun
  run?.echo = text
  _speaking.value = true
  synthesizer.speak(text, settings)
  // Played out: all heard so far was the reply. Talked over: the barge-in already counted it.
  if (_speaking.value && run != null) run.echoWords = SpokenText.words(run.latest).size
  _speaking.value = false
  // Silence is counted from the end of the reply, not its start.
  val current = dictationRun
  if (current != null && current.listen != null && !current.heard) armVoiceTimer(current, voice.giveUpMs)
}

// Dictation hooks

/** The transcript as voice mode wants it in the draft: null while it's only the reply's own echo. */
internal fun ComposerModel.voiceHeard(transcript: String, run: DictationRun): String? {
  val voice = voice ?: return transcript
  if (run.listen == null) return transcript
  run.latest = transcript
  val echo = run.echo
  if (_speaking.value && echo != null) {
    if (SpokenText.novelWords(transcript, echo).isEmpty()) return null
    // The user started talking: the reply stops for them.
    run.echoWords = SpokenText.echoLength(transcript, echo)
    _speaking.value = false
    voiceSynthesizer?.stop()
  }
  val words = SpokenText.dropping(run.echoWords, transcript)
  // A lone "." from a cough or a tap isn't speech.
  if (SpokenText.words(words).isEmpty()) return null
  run.heard = true
  armVoiceTimer(run, voice.pauseMs ?: (VoiceSettings.load(preferences).sendAfter * 1000).toLong())
  return words
}

/** Dictation's last words are in; send them or answer with them. Returns whether the draft should keep them. */
internal fun ComposerModel.voiceFinished(run: DictationRun, transcript: String): Boolean {
  val purpose = run.listen ?: return true
  if (!run.voiceSend) return true
  return when (purpose) {
    VoiceListen.Prompt -> true
    is VoiceListen.Answer -> {
      val answer = SpokenText.answer(transcript)
      if (answer == null) {
        voiceJob = scope.launch {
          if (!voiceMode.value) return@launch
          listen(purpose)
          say(SpokenText.REPEAT_ANSWER)
        }
      } else {
        onAffordance?.invoke(ChatInputAffordance.VoiceAnswer)
        val decision = if (answer == SpokenText.Answer.Allow) "allow" else "deny"
        scope.launch { host.respond(agentId, purpose.toolUseId, decision) }
      }
      false
    }
  }
}

/** After the words landed: a spoken prompt goes out. */
internal fun ComposerModel.voiceSendIfDone(run: DictationRun) {
  if (run.listen != VoiceListen.Prompt || !run.voiceSend || !canSend()) return
  onAffordance?.invoke(ChatInputAffordance.VoiceSend)
  submit()
}

private fun ComposerModel.armVoiceTimer(run: DictationRun, delayMs: Long) {
  voiceTimer?.cancel()
  voiceTimer = scope.launch {
    delay(delayMs)
    if (dictationRun?.id != run.id || _speaking.value) return@launch
    // Heard something: the pause sends it. Heard nothing: the microphone closes.
    run.voiceSend = run.heard
    stopDictation()
  }
}
