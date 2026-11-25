package dev.houwert.argus.ui.composer

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.FlatIconButton
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.icons.voiceMode
import dev.houwert.argus.ui.theme.ArgusTheme

/** The composer's voice mode switch: on, replies are read aloud and the conversation runs hands-free. */
@Composable
fun VoiceModeButton(isOn: Boolean, speaking: Boolean, modifier: Modifier = Modifier, size: Dp = 34.dp, enabled: Boolean = true, onClick: () -> Unit) {
  val pulse = rememberInfiniteTransition(label = "voice")
  val talking by pulse.animateFloat(1f, 0.45f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "speaking")
  FlatIconButton(
    Icon.voiceMode,
    if (isOn) "Turn off voice mode" else "Voice mode",
    modifier.alpha(if (speaking) talking else 1f),
    selected = isOn,
    enabled = enabled,
    size = size,
    tint = if (isOn) ArgusTheme.colors.accent else null,
    onClick = onClick,
  )
}

/** Feeds voice mode the turns and prompts it reacts to; changes only, as a reply already on screen isn't read. */
@Composable
internal fun VoiceLoop(composer: ComposerModel) {
  val running = composer.isRunning
  val cue = composer.voiceCue?.id
  val seen = remember(composer) { VoiceLoopState(running, cue) }
  LaunchedEffect(composer, running) {
    if (running != seen.running && running) composer.voiceTurnStarted()
    seen.running = running
  }
  LaunchedEffect(composer, cue) {
    if (cue != seen.cue) composer.voiceCueChanged()
    seen.cue = cue
  }
  DisposableEffect(composer) { onDispose { composer.stopVoice() } }
}

private class VoiceLoopState(var running: Boolean, var cue: String?)

/** The device's speech and foreground state, with one synthesizer shut down when the composer leaves. */
@Composable
fun rememberVoiceEnvironment(): VoiceEnvironment {
  val context = LocalContext.current.applicationContext
  val speaker = remember { lazy { SystemSpeechSynthesizer(context) } }
  DisposableEffect(speaker) { onDispose { if (speaker.isInitialized()) speaker.value.shutdown() } }
  return remember(speaker) { VoiceEnvironment(synthesizer = { speaker.value }, isForeground = { AppActivity.isForeground }) }
}
