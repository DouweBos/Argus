package dev.houwert.argus.app.screens.accounts

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.core.stores.addClaudeAccount
import dev.houwert.argus.core.stores.cancelClaudeLogin
import dev.houwert.argus.core.stores.loadClaudeLoginStatus
import dev.houwert.argus.core.stores.refreshClaudeAccounts
import dev.houwert.argus.core.stores.refreshRunnerAccounts
import dev.houwert.argus.core.stores.removeClaudeAccount
import dev.houwert.argus.core.stores.renameClaudeAccount
import dev.houwert.argus.core.stores.setActiveClaudeAccount
import dev.houwert.argus.core.stores.startClaudeLogin
import dev.houwert.argus.core.stores.submitClaudeLoginCode
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.displayName
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccountAccountType
import dev.houwert.argus.kit.protocol.subtitle
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.LoadPhaseBox
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsItem
import dev.houwert.argus.ui.components.SettingsLayout
import dev.houwert.argus.ui.components.SettingsPage
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * Every runner's sign-in on the computer: its Claude accounts and which one new agents run as,
 * then the other runners, read only. The chosen account decides which subscription agents use.
 */
@Composable
fun ClaudeAccountsScreen() {
  val host = LocalAppStore.current.host
  val accountsOrNull by host.claudeAccounts.collectAsState()
  val activeId by host.activeClaudeAccountId.collectAsState()
  val runners by host.runnerAccounts.collectAsState()
  val login by host.claudeLogin.collectAsState()
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val canManage = "control" in capabilities
  val accounts = accountsOrNull.orEmpty()
  val scope = rememberCoroutineScope()
  var useConsole by remember { mutableStateOf(false) }
  var starting by remember { mutableStateOf(false) }
  var renaming by remember { mutableStateOf<RemoteClaudeAccount?>(null) }

  LaunchedEffect(connection) {
    if (connection != Transport.State.Ready) return@LaunchedEffect
    host.refreshClaudeAccounts()
    host.loadClaudeLoginStatus()
    host.refreshRunnerAccounts()
  }
  LiveRefresh(enabled = connection == Transport.State.Ready) {
    host.refreshClaudeAccounts()
    // The attempt runs on the computer, so follow what it reports.
    if (host.claudeLogin.value?.pending == true) host.loadClaudeLoginStatus()
  }
  LaunchedEffect(login?.pending) { if (login?.pending == false) host.refreshClaudeAccounts() }

  fun startLogin(accountId: String?) {
    starting = true
    scope.launch {
      if (accountId != null) host.startClaudeLogin(accountId, useConsole) else host.addClaudeAccount(useConsole)
      starting = false
      host.refreshClaudeAccounts()
    }
  }

  AppScreen("Accounts") {
    LoadPhaseBox(
      loaded = accountsOrNull != null, error = null,
      isEmpty = accounts.isEmpty() && !canManage && runners.orEmpty().isEmpty(),
      loadingLabel = "Loading accounts",
      empty = {
        EmptyState(
          Icon.person, "No Claude accounts",
          body = "Add one and agents can run on that subscription instead of whichever account Claude was signed into first.",
        )
      },
    ) {
      SettingsPage {
        if (accounts.isNotEmpty()) {
          SettingsGroup(title = "Claude") {
            accounts.forEach { account ->
              AccountRow(
                account, active = account.id == activeId, canManage = canManage,
                onSelect = { scope.launch { host.setActiveClaudeAccount(account.id) } },
                onLogin = { startLogin(account.id) },
                onRename = { renaming = account },
                onRemove = { scope.launch { host.removeClaudeAccount(account.id) } },
              )
            }
          }
        }
        // Sign-in runs here in the list, as on the Mac, rather than in a sheet.
        if (canManage) ClaudeSignInSection(useConsole, { useConsole = it }, starting, accounts.isEmpty()) { startLogin(null) }
        RunnerAccountsSection(runners.orEmpty())
      }
    }
  }

  renaming?.let { account -> RenameDialog(account, onDismiss = { renaming = null }) { label -> scope.launch { host.renameClaudeAccount(account.id, label) } } }
}

/** Add an account or sign in, then follow the attempt the computer runs; a pasted code is the phone's way to finish. */
@Composable
private fun ClaudeSignInSection(useConsole: Boolean, onUseConsole: (Boolean) -> Unit, starting: Boolean, firstAccount: Boolean, start: () -> Unit) {
  val host = LocalAppStore.current.host
  val login by host.claudeLogin.collectAsState()
  val scope = rememberCoroutineScope()
  var code by remember { mutableStateOf("") }
  var submitting by remember { mutableStateOf(false) }
  val focus = remember { FocusRequester() }
  val pending = login?.pending == true
  LaunchedEffect(login?.needsCode) { if (login?.needsCode == true) runCatching { focus.requestFocus() } }
  LaunchedEffect(pending) { if (!pending) code = "" }
  fun submit() {
    if (code.isBlank() || submitting) return
    submitting = true
    scope.launch {
      host.submitClaudeLoginCode(code.trim())
      submitting = false
    }
  }
  SettingsGroup(
    title = if (pending || starting) "Complete sign-in" else if (firstAccount) "Sign in to Claude" else "Add another Claude account",
    footer = if (pending) "Finish on your computer, or paste the code the browser shows there."
    else "A browser opens on your computer to approve access. Accounts already signed in stay signed in.",
  ) {
    SettingsItem {
      Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        when {
          starting -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            MutedText("Opening the browser on your computer")
          }
          pending -> {
            MutedText(
              if (login?.needsCode == true) "Claude is waiting for the code the browser shows."
              else "Waiting for you to approve in the browser on your computer"
            )
            ThemedTextField(code, { code = it }, "Paste the code", Modifier.focusRequester(focus), input = TextInput.Code, onSubmit = ::submit)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
              Btn("Cancel sign-in", tone = ButtonTone.Secondary, small = true, hugs = true) { scope.launch { host.cancelClaudeLogin() } }
              Box(Modifier.weight(1f))
              Btn(
                if (submitting) "Signing in" else "Sign in", small = true, hugs = true, icon = Icon.check,
                enabled = code.isNotBlank() && !submitting, onClick = ::submit,
              )
            }
          }
          else -> {
            val error = login?.error
            if (error != null) Banner(error, tone = Tone.Danger) else if (login?.ok == true) Banner("Signed in.", tone = Tone.Success)
            SegmentedControl(useConsole, listOf(false to "Claude subscription", true to "Anthropic Console"), onChange = onUseConsole)
            Btn(if (firstAccount) "Sign in" else "Add account", icon = Icon.plus, fills = true, onClick = start)
          }
        }
      }
    }
  }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AccountRow(
  account: RemoteClaudeAccount,
  active: Boolean,
  canManage: Boolean,
  onSelect: () -> Unit,
  onLogin: () -> Unit,
  onRename: () -> Unit,
  onRemove: () -> Unit,
) {
  val theme = ArgusTheme.colors
  var menu by remember { mutableStateOf(false) }
  var confirmingRemove by remember { mutableStateOf(false) }
  Box {
    Row(
      Modifier.fillMaxWidth()
        .combinedClickable(
          role = Role.Button, onClickLabel = "Use for new agents",
          onLongClickLabel = if (canManage) "More actions" else null,
          onLongClick = if (canManage) ({ menu = true }) else null,
          onClick = onSelect,
        )
        .padding(SettingsLayout.rowPadding),
      horizontalArrangement = Arrangement.spacedBy(12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(account.displayName, color = theme.text, style = argusFont(15, FontWeight.SemiBold))
        if (account.subtitle.isNotEmpty()) Text(account.subtitle, color = theme.textSecondary, style = argusFont(13))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          if (account.needsReauth) Badge("Signed out", tone = Tone.Danger) else if (account.rateLimited) Badge("Limit reached", tone = Tone.Warning)
          if (account.accountType == RemoteClaudeAccountAccountType.console) Badge("Console")
        }
      }
      if (active) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
          Icon(Icon.check, null, Modifier.size(14.dp), tint = theme.success)
          Text("In use", color = theme.success, style = argusFont(13, FontWeight.Medium))
        }
      }
    }
    DropdownMenu(menu, { menu = false }, containerColor = theme.surface) {
      if (account.needsReauth) {
        DropdownMenuItem({ Text("Sign in again") }, { menu = false; onLogin() }, leadingIcon = { Icon(Icon.web, null) })
      }
      DropdownMenuItem({ Text("Rename") }, { menu = false; onRename() }, leadingIcon = { Icon(Icon.pencil, null) })
      DropdownMenuItem(
        { Text("Remove", color = theme.error) }, { menu = false; confirmingRemove = true },
        leadingIcon = { Icon(Icon.trash, null, tint = theme.error) },
      )
    }
  }
  if (confirmingRemove) {
    AlertDialog(
      onDismissRequest = { confirmingRemove = false },
      title = { Text("Remove ${account.displayName}?") },
      text = { Text("This clears the account from Argus; Claude's own credentials are untouched.") },
      confirmButton = { TextButton({ confirmingRemove = false; onRemove() }) { Text("Remove", color = theme.error) } },
      dismissButton = { TextButton({ confirmingRemove = false }) { Text("Cancel") } },
    )
  }
}

@Composable
private fun RenameDialog(account: RemoteClaudeAccount, onDismiss: () -> Unit, onSave: (String) -> Unit) {
  var draft by remember { mutableStateOf(account.label.orEmpty()) }
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("Rename") },
    text = { ThemedTextField(draft, { draft = it }, account.email ?: account.id, input = TextInput.Name) },
    confirmButton = {
      TextButton({
        onSave(draft)
        onDismiss()
      }, enabled = draft.isNotBlank()) { Text("Save") }
    },
    dismissButton = { TextButton(onDismiss) { Text("Cancel") } },
  )
}
