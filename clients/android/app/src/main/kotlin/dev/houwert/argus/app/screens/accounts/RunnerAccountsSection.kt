package dev.houwert.argus.app.screens.accounts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.settings.RunnerAccountSections
import dev.houwert.argus.core.settings.RunnerAccountTone
import dev.houwert.argus.core.settings.statusLabel
import dev.houwert.argus.core.settings.tone
import dev.houwert.argus.kit.protocol.generated.RunnerAccount
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsLayout
import dev.houwert.argus.ui.components.SettingsLinkRow
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/** Every runner besides Claude Code, read only: installing and signing in run in a terminal on the computer. */
@Composable
fun RunnerAccountsSection(accounts: List<RunnerAccount>) {
  val sections = RunnerAccountSections(accounts)
  if (sections.installed.isEmpty() && sections.missing.isEmpty()) return
  var showMissing by rememberSaveable { mutableStateOf(false) }
  SettingsGroup(title = "Other runners", footer = "Install, sign in or sign out in Settings → Accounts on your computer.") {
    sections.installed.forEach { RunnerAccountRow(it) }
    if (sections.collapsesMissing) {
      SettingsLinkRow("Not installed (${sections.missing.size})", value = if (showMissing) "Hide" else "Show") { showMissing = !showMissing }
      if (showMissing) sections.missing.forEach { RunnerAccountRow(it) }
    } else {
      sections.missing.forEach { RunnerAccountRow(it) }
    }
  }
}

@Composable
private fun RunnerAccountRow(account: RunnerAccount) {
  val theme = ArgusTheme.colors
  val tone = when (account.tone) {
    RunnerAccountTone.Success -> Tone.Success
    RunnerAccountTone.Warning -> Tone.Warning
    RunnerAccountTone.Muted -> Tone.Muted
  }
  Row(
    Modifier.fillMaxWidth().padding(SettingsLayout.rowPadding)
      .clearAndSetSemantics { contentDescription = listOfNotNull(account.displayName, account.account, account.statusLabel).joinToString(", ") },
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(account.displayName, color = theme.text, style = argusFont(15, FontWeight.SemiBold))
        if (account.isCustom) Badge("Custom")
      }
      account.account?.let { Text(it, color = theme.textSecondary, style = argusFont(13)) }
    }
    Badge(account.statusLabel, tone = tone)
  }
}
