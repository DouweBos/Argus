package dev.houwert.argus.app.telemetry

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.TitleText

/** Shows [TelemetryConsentSheet] once per install, until it is answered. */
@Composable
fun TelemetryConsentGate() {
  var asking by remember { mutableStateOf(!Telemetry.hasAnsweredConsent) }
  if (asking) TelemetryConsentSheet(onAnswered = { asking = false })
}

/**
 * The one-time consent step, in the desktop's and iPhone's words. Settings, Privacy is where it
 * changes afterwards. Answering is the point, so back and outside taps don't dismiss it.
 */
@Composable
fun TelemetryConsentSheet(onAnswered: () -> Unit) {
  fun choose(mode: TelemetryMode) {
    Telemetry.setMode(mode)
    onAnswered()
  }
  Dialog(
    onDismissRequest = {},
    properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false, usePlatformDefaultWidth = false),
  ) {
    Screen {
      TitleText("Help improve Argus")
      MutedText("Pick how much you want to share. You can change this any time under Settings, Privacy.")

      Card {
        BodyText("Just count me")
        MutedText("One event per launch: a random install id and the app version, nothing else.")
        MutedText("This is the minimum; Argus always sends this heartbeat.")
      }

      Card {
        BodyText("Share anonymous data")
        MutedText("App version, Android version and device model.")
        MutedText("Which screens you open and which actions you take.")
        MutedText("Crashes and errors, with file paths stripped out.")
      }

      Card {
        BodyText("What we never collect")
        MutedText("Prompts, agent output, project names, branch names or repo paths.")
        MutedText("Your device name, or anything that identifies you or your computers.")
      }

      Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Btn(label = "Share anonymous data", fills = true) { choose(TelemetryMode.Full) }
        Btn(label = "Just count me", tone = ButtonTone.Secondary, fills = true) { choose(TelemetryMode.Presence) }
      }
    }
  }
}
