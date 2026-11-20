package dev.houwert.argus.ui.composer

import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.FlatIconButton
import dev.houwert.argus.ui.icons.Icon

/** The composer's mic: tap to dictate into the draft, tap again to stop. */
@Composable
fun DictationButton(phase: DictationPhase, modifier: Modifier = Modifier, size: Dp = 34.dp, enabled: Boolean = true, onClick: () -> Unit) {
  val pulse = rememberInfiniteTransition(label = "dictation")
  val listening by pulse.animateFloat(1f, 0.45f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "pulse")
  val alpha = when (phase) {
    DictationPhase.Listening -> listening
    DictationPhase.Starting, DictationPhase.Finishing -> 0.5f
    else -> 1f
  }
  FlatIconButton(
    if (phase.isActive) Icon.micActive else Icon.mic,
    if (phase.isActive) "Stop dictating" else "Dictate",
    modifier.alpha(alpha),
    selected = phase.isActive,
    enabled = enabled,
    size = size,
    onClick = onClick,
  )
}

/**
 * Dictation through the system's speech recognizer, which brings its own microphone UI and
 * permission, so the app needs no RECORD_AUDIO. Offline where the device has the model.
 */
@Composable
fun rememberRecognizerDictation(): () -> DictationEngine {
  val pending = remember { PendingResult() }
  val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val heard = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
    pending.done?.invoke(heard)
    pending.done = null
  }
  val current by rememberUpdatedState(launcher)
  return remember {
    {
      RecognizerDictationEngine { done ->
        pending.done = done
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
          .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        try {
          current.launch(intent)
        } catch (_: ActivityNotFoundException) {
          pending.done = null
          throw DictationException("This device has no speech recognizer.")
        }
      }
    }
  }
}

private class PendingResult {
  var done: ((String?) -> Unit)? = null
}

/** One recognizer run: the system UI listens, its result is the whole transcript. */
internal class RecognizerDictationEngine(private val launch: ((String?) -> Unit) -> Unit) : DictationEngine {
  private var transcript = ""

  override suspend fun start(onTranscript: (String) -> Unit, onEnded: () -> Unit) {
    launch { heard ->
      transcript = heard.orEmpty()
      if (heard != null) onTranscript(heard)
      onEnded()
    }
  }

  override suspend fun stop(): String = transcript
}
