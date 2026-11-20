package dev.houwert.argus.ui.composer

import java.util.UUID
import kotlinx.coroutines.launch

sealed interface DictationPhase {
  data object Idle : DictationPhase
  /** Opening the recognizer. */
  data object Starting : DictationPhase
  data object Listening : DictationPhase
  /** Waiting for the last words after the microphone closed. */
  data object Finishing : DictationPhase
  data class Failed(val message: String) : DictationPhase

  /** The draft is the transcript's until this ends. */
  val isActive: Boolean get() = this == Starting || this == Listening || this == Finishing

  /** The draft's placeholder while the microphone is open. */
  val placeholder: String?
    get() = when (this) {
      Starting -> "Getting ready"
      Listening -> "Listening"
      Finishing -> "Finishing"
      else -> null
    }

  val failure: String? get() = (this as? Failed)?.message
}

enum class DictationTrigger(val affordance: ChatInputAffordance) {
  Button(ChatInputAffordance.Dictation),
  /** A hardware keyboard's hold-to-talk key. */
  PushToTalk(ChatInputAffordance.DictationShortcut),
}

/** Speech to text into the draft. */
interface DictationEngine {
  /**
   * Listens until [stop]; `onTranscript` gets the whole transcript so far each time it changes.
   * `onEnded` is called when the engine stops by itself (the system recognizer closed).
   */
  suspend fun start(onTranscript: (String) -> Unit, onEnded: () -> Unit)
  /** Stops listening and returns the final transcript. */
  suspend fun stop(): String
}

class DictationException(message: String) : Exception(message)

/** Where dictated words land: at the caret listening began at, spaced from the text on either side. */
data class DictationDraft(val prefix: String, val suffix: String) {
  val original: String get() = prefix + suffix

  /** The draft with `transcript` spliced in, and the caret just after it. */
  fun merged(transcript: String): MentionPicker.Edit {
    val words = transcript.trim()
    if (words.isEmpty()) return MentionPicker.Edit(original, prefix.length)
    val lead = prefix.lastOrNull()?.let { if (it.isWhitespace()) "" else " " } ?: ""
    val trail = suffix.firstOrNull()?.let { if (it.isWhitespace()) "" else " " } ?: ""
    val head = prefix + lead + words
    return MentionPicker.Edit(head + trail + suffix, head.length)
  }

  companion object {
    /** A caret inside a surrogate pair rounds down to the character's start. */
    operator fun invoke(text: String, caret: Int): DictationDraft {
      var split = caret.coerceIn(0, text.length)
      if (split in 1 until text.length && text[split].isLowSurrogate() && text[split - 1].isHighSurrogate()) split -= 1
      return DictationDraft(text.substring(0, split), text.substring(split))
    }
  }
}

internal class DictationRun(val engine: DictationEngine, val draft: DictationDraft, val trigger: DictationTrigger) {
  val id: String = UUID.randomUUID().toString()
  var stopRequested = false
}

/** Dictation into the draft. Words land at the caret for review and are never sent. */
fun ComposerModel.toggleDictation(via: DictationTrigger = DictationTrigger.Button) {
  if (dictation.value.isActive) stopDictation() else startDictation(via)
}

fun ComposerModel.startDictation(via: DictationTrigger = DictationTrigger.Button) {
  val make = dictationEngine ?: return
  if (!isEnabled || dictation.value.isActive) return
  val run = DictationRun(make(), DictationDraft(text.value, caret.value), via)
  dictationRun = run
  _dictation.value = DictationPhase.Starting
  scope.launch {
    try {
      run.engine.start(
        onTranscript = { heard(it, run.id) },
        onEnded = { if (dictationRun?.id == run.id) stopDictation() },
      )
    } catch (error: Exception) {
      if (dictationRun?.id != run.id) return@launch
      dictationRun = null
      _dictation.value = DictationPhase.Failed(error.message ?: "Dictation stopped.")
      return@launch
    }
    if (dictationRun?.id != run.id) return@launch
    if (run.stopRequested) finishDictation(run) else _dictation.value = DictationPhase.Listening
  }
}

/** Takes the words heard so far; a start still underway stops as soon as it's listening. */
fun ComposerModel.stopDictation() {
  val run = dictationRun ?: return
  if (dictation.value != DictationPhase.Listening) {
    run.stopRequested = true
    return
  }
  scope.launch { finishDictation(run) }
}

fun ComposerModel.dismissDictationError() {
  if (dictation.value is DictationPhase.Failed) _dictation.value = DictationPhase.Idle
}

private fun ComposerModel.heard(transcript: String, runId: String) {
  val run = dictationRun ?: return
  if (run.id != runId || !dictation.value.isActive) return
  val merged = run.draft.merged(transcript)
  setText(merged.text, merged.caret)
}

private suspend fun ComposerModel.finishDictation(run: DictationRun) {
  _dictation.value = DictationPhase.Finishing
  val transcript = run.engine.stop()
  if (dictationRun?.id != run.id) return
  dictationRun = null
  _dictation.value = DictationPhase.Idle
  val merged = run.draft.merged(transcript)
  setText(merged.text, merged.caret)
  if (transcript.isBlank()) return
  onAffordance?.invoke(run.trigger.affordance)
}
