package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.AccountAvatar
import dev.houwert.argus.ui.components.ColorSchemeCards
import dev.houwert.argus.ui.components.ColorThemeCards
import dev.houwert.argus.ui.components.GrantLabel
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsGroupTitle
import dev.houwert.argus.ui.components.SettingsHeaderButton
import dev.houwert.argus.ui.components.SettingsItem
import dev.houwert.argus.ui.components.SettingsLinkRow
import dev.houwert.argus.ui.components.SettingsNavItem
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.components.SettingsToggleRow
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.ColorTheme
import dev.houwert.argus.ui.theme.ThemePreference
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

@Composable
internal fun SettingsGalleryPage() {
  val theme = ArgusTheme.colors
  var wrap by remember { mutableStateOf(true) }
  var notify by remember { mutableStateOf(false) }
  var scheme by remember { mutableStateOf(ThemePreference.System) }
  var preset by remember { mutableStateOf(ColorTheme.Grove) }
  SettingsGroup(footer = "Change what this device may do under Settings → Remote in Argus on the computer.") {
    SettingsRow("Status") {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        StatusDot(Tone.Success)
        Text("Connected", color = theme.success, style = argusFont(13))
      }
    }
    SettingsRow("Access") { Text(GrantLabel.text(listOf("monitor", "control")), color = theme.textSecondary, style = argusFont(13)) }
    SettingsLinkRow("Computer details", icon = Icon.desktop, value = "Studio") {}
  }
  SettingsGroup(title = "New sessions", footer = "Both can be overridden per session.", accessory = { SettingsHeaderButton("Add App", icon = Icon.plus) {} }) {
    SettingsRow("Default model", description = "Pre-selected in the launcher.") { Text("Opus", color = theme.textSecondary, style = argusFont(15)) }
    SettingsToggleRow("Wrap lines", wrap, { wrap = it }, description = "Soft-wrap long lines in the code view.")
    SettingsToggleRow("Notify when done", notify, { notify = it })
    SettingsRow("Worktree location", description = "Where new worktrees are created.", stacked = true) {
      MutedText("~/.argus/worktrees/Argus-argus-worktrees")
    }
    SettingsItem { MutedText("No custom apps yet.") }
  }
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    SettingsGroupTitle("Appearance")
    ColorSchemeCards(scheme, preset, { scheme = it })
    ColorThemeCards(preset, { preset = it })
  }
  Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
    SettingsGroupTitle("Navigation")
    SettingsNavItem("General", Icon.gear, selected = true) {}
    SettingsNavItem("Agents", Icon.agents, selected = false) {}
    SettingsNavItem("Notifications", Icon.notifications, selected = false) {}
  }
  Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
    AccountAvatar("DB")
    AccountAvatar(null, size = 32.dp)
    AccountAvatar("A", size = 24.dp)
  }
  Box(Modifier.height(24.dp))
}
