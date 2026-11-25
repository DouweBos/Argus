package dev.houwert.argus.ui.composer

import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred

/** Text to speech, on the device. */
interface SpeechSynthesizer {
  /** Returns once the text has been spoken or [stop] cut it off. */
  suspend fun speak(text: String, settings: VoiceSettings)
  fun stop()
}

/** Android's `TextToSpeech`, one utterance at a time. Call [shutdown] when done with it. */
class SystemSpeechSynthesizer(context: Context) : SpeechSynthesizer {
  private val ready = CompletableDeferred<Boolean>()
  private val tts = TextToSpeech(context.applicationContext) { ready.complete(it == TextToSpeech.SUCCESS) }

  /** The utterance playing and what its end completes; the listener runs on a binder thread. */
  @Volatile private var current: Pair<String, CompletableDeferred<Unit>>? = null

  init {
    tts.setAudioAttributes(
      AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build(),
    )
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) = Unit
      override fun onDone(utteranceId: String?) = finish(utteranceId)
      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String?) = finish(utteranceId)
      override fun onError(utteranceId: String?, errorCode: Int) = finish(utteranceId)
      override fun onStop(utteranceId: String?, interrupted: Boolean) = finish(utteranceId)
    })
  }

  override suspend fun speak(text: String, settings: VoiceSettings) {
    stop()
    if (!ready.await()) return
    apply(settings)
    val id = UUID.randomUUID().toString()
    val done = CompletableDeferred<Unit>()
    current = id to done
    if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) return finish(id)
    // A cancelled caller silences what it started.
    try {
      done.await()
    } finally {
      if (current?.first == id) stop()
    }
  }

  override fun stop() {
    val playing = current ?: return
    tts.stop()
    finish(playing.first)
  }

  fun shutdown() {
    stop()
    tts.shutdown()
  }

  /** The installed on-device voices for the current language, best quality first; empty until the engine is up. */
  suspend fun voices(): List<Pair<String, String>> {
    if (!ready.await()) return emptyList()
    val language = Locale.getDefault().language
    val voices = runCatching { tts.voices.orEmpty() }.getOrDefault(emptySet())
      .filter { it.locale.language == language && it.isOnDevice }
      .sortedWith(compareByDescending<Voice> { it.quality }.thenBy { it.locale.displayName }.thenBy { it.name })
    return voices.mapIndexed { index, voice -> voice.name to label(voice, index, voices) }
  }

  private fun apply(settings: VoiceSettings) {
    val voice = settings.voiceId?.let { id -> runCatching { tts.voices.orEmpty() }.getOrNull()?.firstOrNull { it.name == id } }
    if (voice != null) tts.setVoice(voice) else tts.setLanguage(Locale.getDefault())
    tts.setSpeechRate(settings.speed.coerceIn(VoiceSettings.SPEEDS).toFloat())
  }

  private fun finish(utteranceId: String?) {
    val playing = current ?: return
    if (playing.first != utteranceId) return
    current = null
    playing.second.complete(Unit)
  }

  private val Voice.isOnDevice: Boolean
    get() = !isNetworkConnectionRequired && TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in features.orEmpty()

  /** Engine voice names are codes (`en-us-x-iol-local`); a region and a number read better. */
  private fun label(voice: Voice, index: Int, all: List<Voice>): String {
    val region = voice.locale.displayName
    val number = all.take(index + 1).count { it.locale == voice.locale }
    val quality = if (voice.quality >= Voice.QUALITY_VERY_HIGH) " (Enhanced)" else ""
    return "$region $number$quality"
  }
}

/** Whether Argus is the app in front, for voice mode's "only in the background". */
object AppActivity {
  val isForeground: Boolean
    get() = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
}
