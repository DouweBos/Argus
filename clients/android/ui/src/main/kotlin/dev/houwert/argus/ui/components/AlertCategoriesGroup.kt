package dev.houwert.argus.ui.components

import androidx.compose.runtime.Composable

/** Which agent alerts this phone gets; each computer stops sending what's off. */
@Composable
fun AlertCategoriesGroup(
  needsYou: Boolean,
  finished: Boolean,
  onNeedsYou: (Boolean) -> Unit,
  onFinished: (Boolean) -> Unit,
) {
  SettingsGroup(
    title = "Alert me when",
    footer = "Each computer you're paired with stops sending what you turn off. Needs you and the widgets still list everything.",
  ) {
    SettingsToggleRow(
      "Agent needs you", needsYou, onNeedsYou,
      description = "A permission prompt, a question, a plan to approve, an error, or a usage limit running low.",
    )
    SettingsToggleRow("Agent finished", finished, onFinished, description = "An agent completed its turn.")
  }
}
