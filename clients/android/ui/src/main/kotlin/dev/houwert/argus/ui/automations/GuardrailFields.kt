package dev.houwert.argus.ui.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationGuardrails
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.TextKeyboard
import dev.houwert.argus.ui.components.ThemedTextField

/** The limits a run is held to, whatever its playbook says. Enforced on the computer; this only edits the numbers. */
@Composable
fun GuardrailFields(guardrails: RemoteAutomationGuardrails, onChange: (RemoteAutomationGuardrails) -> Unit) {
  val g = guardrails
  Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    NumberField("Confidence threshold", "Below this, a proposal waits for you.", g.confidenceThreshold, 0.8) {
      onChange(g.copy(confidenceThreshold = it))
    }
    NumberField("Sessions at once", "Auto-started, in flight.", g.maxConcurrentSessions, 2.0) { onChange(g.copy(maxConcurrentSessions = it)) }
    NumberField("Files changed", "A bigger branch is never pushed.", g.maxFilesChanged, 25.0) { onChange(g.copy(maxFilesChanged = it)) }
    NumberField("Time limit (minutes)", "A run past this is stopped and marked failed.", g.maxRunMinutes, 20.0) {
      onChange(g.copy(maxRunMinutes = it))
    }
    NumberField(
      "Spend ceiling (USD)",
      if (g.maxCostUsdPerRun > 0) "A run crossing this finishes its turn, then stops." else "Off: a run spends what the work costs.",
      g.maxCostUsdPerRun, 0.0,
    ) { onChange(g.copy(maxCostUsdPerRun = it)) }

    MutedText("Path denylist: comma-separated globs no run may touch.")
    var denylist by rememberSaveable { mutableStateOf(g.pathDenylist.joinToString(", ")) }
    ThemedTextField(
      denylist,
      { text ->
        denylist = text
        onChange(g.copy(pathDenylist = GuardrailText.denylist(text)))
      },
      "infra/**, **/*.lock", mono = true, input = TextInput.Code,
    )
    SwitchRow("Require green CI before an auto-merge", g.requireCleanCi) { onChange(g.copy(requireCleanCi = it)) }
    SwitchRow("Retry on another Claude account when a usage limit is hit", g.retryOtherAccounts ?: true) {
      onChange(g.copy(retryOtherAccounts = it))
    }
  }
}

@Composable
private fun NumberField(label: String, caption: String, value: Double, fallback: Double, onChange: (Double) -> Unit) {
  // Keep what was typed until it parses: rejecting mid-edit text would fight every keystroke.
  var text by rememberSaveable(label) { mutableStateOf(GuardrailText.format(value)) }
  Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    MutedText("$label: $caption")
    ThemedTextField(
      text,
      { typed ->
        text = typed
        onChange(GuardrailText.parse(typed, fallback))
      },
      GuardrailText.format(fallback), keyboard = TextKeyboard.DecimalPad, mono = true, input = TextInput.Code,
    )
  }
}

object GuardrailText {
  fun format(value: Double): String = if (value == Math.rint(value)) value.toLong().toString() else value.toString()

  /** A comma decimal reads as a point; a negative or unparseable entry falls back. */
  fun parse(typed: String, fallback: Double): Double =
    typed.trim().replace(',', '.').toDoubleOrNull()?.let { if (it >= 0) it else fallback } ?: fallback

  fun denylist(text: String): List<String> = text.split(',').map { it.trim() }.filter { it.isNotEmpty() }
}
