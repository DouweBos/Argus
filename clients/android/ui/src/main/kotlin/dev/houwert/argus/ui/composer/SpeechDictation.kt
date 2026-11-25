package dev.houwert.argus.ui.composer

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** What's been heard: finished utterances plus the one still being spoken. */
internal class SpeechTranscript {
  private val finished = mutableListOf<String>()
  private var partial = ""

  val text: String get() = (finished + partial).filter { it.isNotBlank() }.joinToString(" ") { it.trim() }

  fun partial(words: String) { partial = words }

  /** The recognizer's final words for one utterance replace its partials. */
  fun finish(words: String?) {
    (words ?: partial).takeIf { it.isNotBlank() }?.let { finished += it }
    partial = ""
  }

  val isEmpty: Boolean get() = text.isEmpty()
}

/**
 * Streams partial results into the draft as you speak, like the iPhone. Keeps listening across
 * pauses until stopped; silence with nothing new to add ends it. Main thread only.
 */
internal class SpeechDictationEngine(
  private val context: Context,
  /** Voice mode: silence doesn't end it; the composer decides when a pause means send. */
  private val handsFree: Boolean = false,
  private val requestMicrophone: suspend () -> Boolean,
) : DictationEngine {
  private var recognizer: SpeechRecognizer? = null
  private val transcript = SpeechTranscript()
  private var stopping: CompletableDeferred<Unit>? = null
  private var ended = false

  override suspend fun start(onTranscript: (String) -> Unit, onEnded: () -> Unit) = withContext(Dispatchers.Main) {
    if (!requestMicrophone()) throw DictationException("Allow microphone access to dictate.")
    var attempt = 0
    while (true) {
      try {
        return@withContext listen(onTranscript, onEnded)
      } catch (e: Retry) {
        // No offline model for this language, or the service still closing the last one: a fresh recognizer.
        if (e.offlineUnavailable) preferOffline = false
        if (++attempt > MAX_RETRIES) throw DictationException(message(e.error))
        delay(RETRY_DELAY_MS)
      }
    }
  }

  private class Retry(val error: Int, val offlineUnavailable: Boolean) : Exception()

  /** Opens a recognizer and returns once it's listening. */
  private suspend fun listen(onTranscript: (String) -> Unit, onEnded: () -> Unit) {
    release()
    val ready = CompletableDeferred<Unit>()
    val speech = SpeechRecognizer.createSpeechRecognizer(context)
    recognizer = speech
    fun end() {
      if (ended) return
      ended = true
      stopping?.complete(Unit)
      onEnded()
    }
    speech.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) { ready.complete(Unit) }
      override fun onPartialResults(partialResults: Bundle?) {
        partialResults.firstResult()?.let { transcript.partial(it); onTranscript(transcript.text) }
      }
      override fun onResults(results: Bundle?) {
        transcript.finish(results.firstResult())
        onTranscript(transcript.text)
        // An utterance ended; keep listening for the next unless the user stopped.
        if (stopping != null) end() else speech.startListening(intent())
      }
      override fun onError(error: Int) {
        if (!ready.isCompleted) {
          val offline = preferOffline && error in OFFLINE_UNAVAILABLE
          ready.completeExceptionally(
            if (offline || error in TRANSIENT) Retry(error, offline) else DictationException(message(error)),
          )
          return
        }
        // Silence after words is the natural end (hands-free listens on); anything else keeps what was heard too.
        transcript.finish(null)
        onTranscript(transcript.text)
        if (handsFree && stopping == null && error in SILENCE) speech.startListening(intent()) else end()
      }
      override fun onBeginningOfSpeech() = Unit
      override fun onRmsChanged(rmsdB: Float) = Unit
      override fun onBufferReceived(buffer: ByteArray?) = Unit
      override fun onEndOfSpeech() = Unit
      override fun onEvent(eventType: Int, params: Bundle?) = Unit
    })
    speech.startListening(intent())
    try {
      ready.await()
    } catch (e: Exception) {
      release()
      throw e
    }
  }

  override suspend fun stop(): String = withContext(Dispatchers.Main) {
    val speech = recognizer ?: return@withContext transcript.text
    if (!ended) {
      val done = CompletableDeferred<Unit>().also { stopping = it }
      speech.stopListening()
      // The last words arrive in onResults; don't hang on a recognizer that never answers.
      withTimeoutOrNull(STOP_GRACE_MS) { done.await() }
      ended = true
    }
    release()
    transcript.text
  }

  private fun release() {
    recognizer?.destroy()
    recognizer = null
  }

  private fun intent() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
    .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)

  private fun Bundle?.firstResult(): String? =
    this?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

  private companion object {
    const val STOP_GRACE_MS = 3_000L
    const val MAX_RETRIES = 2
    const val RETRY_DELAY_MS = 300L
    val SILENCE = setOf(SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT)
    val TRANSIENT = setOf(SpeechRecognizer.ERROR_SERVER_DISCONNECTED, SpeechRecognizer.ERROR_RECOGNIZER_BUSY)

    /** Learnt once per process: a device without the offline model keeps going online. */
    @Volatile var preferOffline = true
    val OFFLINE_UNAVAILABLE = setOf(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE)

    fun message(error: Int) = when (error) {
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Allow microphone access to dictate."
      SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Dictation needs a connection on this device."
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The speech recognizer is busy. Try again."
      SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "Dictation isn't available in this language."
      else -> "Dictation stopped."
    }
  }
}
