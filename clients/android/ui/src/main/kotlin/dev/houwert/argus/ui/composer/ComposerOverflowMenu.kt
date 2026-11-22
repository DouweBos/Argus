package dev.houwert.argus.ui.composer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.subtitle
import dev.houwert.argus.ui.components.MenuOptionItem
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

private enum class OverflowPage { Root, Account }

/** The ⋮ pill. A submenu takes the menu's place, as Android's do: a phone has no room beside it. */
@Composable
internal fun ComposerOverflowMenu(composer: ComposerModel) {
  composer.observe()
  var open by remember(composer) { mutableStateOf(false) }
  var page by remember(composer) { mutableStateOf(OverflowPage.Root) }
  val account = composer.effectiveAccountName
  Box {
    ComposerPillLabel(
      Icon.ellipsisVertical, if (account == null) "More options" else "More options, account: $account",
      accent = composer.hasPendingAccountSwitch, chevron = false, open = open, enabled = composer.isEnabled,
    ) {
      page = OverflowPage.Root
      open = true
      composer.onAffordance?.invoke(ChatInputAffordance.OverflowMenu)
    }
    DropdownMenu(open, { open = false }, containerColor = ArgusTheme.colors.surface) {
      when (page) {
        OverflowPage.Root -> SubmenuItem("Account", account) { page = OverflowPage.Account }
        OverflowPage.Account -> {
          SubmenuHeader("Account") { page = OverflowPage.Root }
          for (option in accountOptions(composer)) {
            MenuOptionItem(option, option.value == composer.checkedAccountId) {
              open = false
              composer.setAccount(option.value)
            }
          }
        }
      }
    }
  }
}

@Composable
private fun SubmenuItem(title: String, value: String?, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  DropdownMenuItem(
    text = {
      Column {
        Text(title, color = theme.text, style = argusFont(15))
        if (value != null) Text(value, color = theme.textMuted, style = argusFont(12))
      }
    },
    leadingIcon = { Icon(Icon.person, null, Modifier.size(18.dp), tint = theme.textSecondary) },
    trailingIcon = { Icon(Icon.chevronRight, null, Modifier.size(18.dp), tint = theme.textSecondary) },
    onClick = onClick,
  )
}

@Composable
private fun SubmenuHeader(title: String, onBack: () -> Unit) {
  val theme = ArgusTheme.colors
  DropdownMenuItem(
    text = { Text(title, color = theme.textSecondary, style = argusFont(15)) },
    leadingIcon = { Icon(Icon.chevronLeft, "Back", Modifier.size(18.dp), tint = theme.textSecondary) },
    onClick = onBack,
  )
  HorizontalDivider(color = theme.border)
}

private fun accountOptions(composer: ComposerModel): List<PickerOption<String>> = buildList {
  if (composer.offersFollowDefault) add(PickerOption(FOLLOW_DEFAULT_ACCOUNT, "Follow computer default", composer.activeAccountName))
  for (account in composer.accounts) {
    val hint = listOfNotNull(composer.accountHint(account.id), account.subtitle.ifEmpty { null }).joinToString(" · ")
    add(PickerOption(account.id, composer.accountName(account.id) ?: account.id, hint.ifEmpty { null }))
  }
}
