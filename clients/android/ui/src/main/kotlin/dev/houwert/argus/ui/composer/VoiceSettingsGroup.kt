package dev.houwert.argus.ui.composer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.storage.Preferences
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.components.SettingsToggleRow
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/** Voice mode's voice, speed and when it speaks; the iPhone's Voice page, written to this device's [preferences]. */
@Composable
fun VoiceSettingsGroup(preferences: Preferences) {
  val theme = ArgusTheme.colors
  val context = LocalContext.current.applicationContext
  var settings by remember(preferences) { mutableStateOf(VoiceSettings.load(preferences)) }
  val preview = remember { lazy { SystemSpeechSynthesizer(context) } }
  var voices by remember { mutableStateOf(emptyList<Pair<String, String>>()) }
  val scope = rememberCoroutineScope()
  LaunchedEffect(preview) { voices = preview.value.voices() }
  DisposableEffect(preview) { onDispose { if (preview.isInitialized()) preview.value.shutdown() } }
  fun update(next: VoiceSettings) {
    settings = next
    next.save(preferences)
  }

  SettingsGroup(
    title = "Voice mode",
    footer = "Turn voice mode on with the waveform button in the message field. Replies are read aloud and " +
      "the microphone opens; stop talking to send. Answer permission prompts with “allow” " +
      "or “deny”. Speech stays on this device.",
  ) {
    SettingsRow("Voice", description = "Download more voices in Android's text-to-speech settings.") {
      val options = listOf(PickerOption<String?>(null, "System voice")) + voices.map { PickerOption<String?>(it.first, it.second) }
      MenuChip("Voice", settings.voiceId, options, { update(settings.copy(voiceId = it)) })
    }
    SettingsRow("Speed", stacked = true) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        val range = VoiceSettings.SPEEDS
        Slider(
          settings.speed.toFloat(),
          { update(settings.copy(speed = (it * 10).roundToInt() / 10.0)) },
          Modifier.weight(1f),
          valueRange = range.start.toFloat()..range.endInclusive.toFloat(),
          steps = ((range.endInclusive - range.start) * 10).roundToInt() - 1,
          colors = SliderDefaults.colors(
            thumbColor = theme.accent,
            activeTrackColor = theme.accent,
            inactiveTrackColor = theme.border,
            activeTickColor = theme.accent,
            inactiveTickColor = theme.border,
          ),
        )
        Text(String.format(Locale.getDefault(), "%.1f×", settings.speed), color = theme.textSecondary, style = argusFont(12))
        Btn("Preview", tone = ButtonTone.Secondary, small = true, hugs = true) {
          val current = settings
          scope.launch { preview.value.speak("The tests pass. Want me to open a pull request?", current) }
        }
      }
    }
    SettingsToggleRow(
      "Only speak in the background",
      settings.onlyInBackground,
      { update(settings.copy(onlyInBackground = it)) },
      description = "While Argus is in front, replies stay on screen and the microphone still opens.",
    )
  }
}
