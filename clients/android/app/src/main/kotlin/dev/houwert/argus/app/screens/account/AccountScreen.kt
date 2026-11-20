package dev.houwert.argus.app.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.core.account.cancelSignInNeeded
import dev.houwert.argus.core.account.dismissRemovedNotice
import dev.houwert.argus.core.account.dismissResetNotice
import dev.houwert.argus.core.account.refreshDirectory
import dev.houwert.argus.core.account.refreshRequests
import dev.houwert.argus.core.account.remove
import dev.houwert.argus.core.account.rename
import dev.houwert.argus.kit.account.AccountSignInProvider
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.ConfirmDialog
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MenuAction
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.OverflowMenu
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.ScreenTopBar
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsItem
import dev.houwert.argus.ui.components.SettingsLinkRow
import dev.houwert.argus.ui.components.SettingsPage
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.TextPromptDialog
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.TitleText
import dev.houwert.argus.ui.icons.BrandIcons
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.launch

/** Settings, Account: sign in once and every computer on the account shows up, with no QR per computer. */
@Composable
fun AccountScreen() {
  val account = LocalAppStore.current.account
  val router = LocalRouter.current
  val phase by account.phase.collectAsState()
  val signInNeeded by account.signInNeeded.collectAsState()
  var resetting by rememberSaveable { mutableStateOf(false) }
  LaunchedEffect(Unit) { account.prepare() }
  // Presence moves while the list is open: a host going quiet or coming back.
  LiveRefresh(phase == AccountStore.Phase.Ready, AccountStore.PRESENCE_POLL_INTERVAL_MS.milliseconds) {
    account.refreshDirectory()
    account.refreshRequests()
  }
  Column(Modifier.fillMaxSize()) {
    ScreenTopBar("Account", onBack = { router.pop() })
    if (phase == AccountStore.Phase.Ready && signInNeeded == null) {
      SettingsPage { SignedIn(account) { resetting = true } }
    } else {
      Screen {
        when (phase) {
          AccountStore.Phase.Loading, AccountStore.Phase.SettingUp ->
            Loading(if (phase == AccountStore.Phase.Loading) "Checking your account" else "Setting up your account")
          // Signing in keeps the form, so a browser sign-in that comes back shows where it left.
          AccountStore.Phase.SignedOut, AccountStore.Phase.SigningIn -> SignIn(account)
          // Still on the account; an identity action wants proof it's you.
          AccountStore.Phase.Ready -> {
            SignIn(account)
            Btn("Cancel", tone = ButtonTone.Ghost) { account.cancelSignInNeeded() }
          }
          AccountStore.Phase.AwaitingApproval -> {
            account.resetNotice.collectAsState().value?.let { AccountResetNoticeBanner(it, { account.dismissResetNotice() }) }
            Card { AccountProfileSummary(account, 56.dp) }
            JoinAccountView(account) { resetting = true }
          }
        }
      }
    }
  }
  if (resetting) AccountResetSheet(account) { resetting = false }
}

@Composable
private fun ColumnScope.SignIn(account: AccountStore) {
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val phase by account.phase.collectAsState()
  val signingInWith by account.signingInWith.collectAsState()
  val awaitingCode by account.awaitingEmailCode.collectAsState()
  val error by account.error.collectAsState()
  val signInNeeded by account.signInNeeded.collectAsState()
  var email by rememberSaveable { mutableStateOf("") }
  var code by rememberSaveable { mutableStateOf("") }
  val busy = phase == AccountStore.Phase.SigningIn
  val sendCode = { if ("@" in email) scope.launch { account.sendEmailCode(email) } }
  val verify = { scope.launch { account.verifyEmailCode(code) } }

  TitleText(AccountSignInCopy.title(signInNeeded))
  MutedText(
    AccountSignInCopy.detail(signInNeeded, DEVICE_NOUN)
      ?: "Your computers show up here with their current addresses, so you can connect without scanning a code for each one.",
  )
  Btn("Sign in with GitHub", tone = ButtonTone.Secondary, icon = BrandIcons.github, busy = signingInWith == AccountSignInProvider.GitHub, enabled = !busy) {
    scope.launch { account.signIn(AccountSignInProvider.GitHub) }
  }
  Btn("Sign in with Apple", tone = ButtonTone.Secondary, busy = signingInWith == AccountSignInProvider.Apple, enabled = !busy) {
    scope.launch { account.signIn(AccountSignInProvider.Apple) }
  }
  Card {
    if (awaitingCode) {
      MutedText("Enter the code we emailed to $email.")
      ThemedTextField(code, { code = it }, "123456", input = TextInput.Code, enabled = !busy, onSubmit = { verify() })
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Btn("Verify", hugs = true, busy = signingInWith == AccountSignInProvider.Email, enabled = code.isNotBlank() && !busy) { verify() }
        Btn("Use another email", tone = ButtonTone.Ghost) {
          code = ""
          account.cancelEmailCode()
        }
      }
    } else {
      MutedText("Or get a sign-in code by email")
      ThemedTextField(email, { email = it }, "you@example.com", input = TextInput.Code, enabled = !busy, onSubmit = { sendCode() })
      Btn("Email me a code", tone = ButtonTone.Secondary, enabled = "@" in email && !busy) { sendCode() }
    }
  }
  error?.let { Banner(it, tone = Tone.Danger) }
  if (signInNeeded == null) {
    Btn("Pair with a QR code instead", tone = ButtonTone.Secondary, icon = ArgusIcon.qrCode) { router.push(Route.Pair) }
  }
}

@Composable
private fun ColumnScope.SignedIn(account: AccountStore, onReset: () -> Unit) {
  val theme = ArgusTheme.colors
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val hosts by account.hosts.collectAsState()
  val logError by account.logError.collectAsState()
  val error by account.error.collectAsState()
  val state by account.state.collectAsState()
  var confirmingSignOut by remember { mutableStateOf(false) }
  var removing by remember { mutableStateOf<AccountStore.Host?>(null) }
  var renaming by remember { mutableStateOf<AccountStore.Host?>(null) }

  SettingsGroup { SettingsItem { AccountProfileSummary(account, 48.dp) } }
  AccountRequestsGroup(account)
  SettingsGroup(
    title = "Safety code",
    footer = "The same on every device on your account. If one ever shows a different code, it's looking at a different account.",
  ) {
    SettingsItem {
      SelectionContainer { Text(state?.root?.safetyCode ?: "None", color = theme.text, style = argusFont(20, FontWeight.SemiBold, mono = true)) }
      logError?.let {
        Text(
          "The account service sent changes that don't check out (${it.raw}). Nothing was applied.",
          Modifier.padding(top = 6.dp), color = theme.error, style = argusFont(13),
        )
      }
    }
  }
  SettingsGroup(
    title = "Computers",
    footer = "A computer that hasn't checked in for 15 minutes shows as offline; it's still tried at its last addresses.",
  ) {
    if (hosts.isEmpty()) {
      SettingsItem {
        Text(
          "No computers yet. Run argus-host login, or sign in to Argus on the computer, and add the code it shows.",
          color = theme.textSecondary, style = argusFont(13),
        )
      }
    }
    for (host in hosts) {
      AccountMemberRow(
        ArgusIcon.desktop, theme.textSecondary, host.name, AccountPresenceText.text(host.online, host.lastSeen),
        leading = {
          Row(Modifier.width(24.dp), horizontalArrangement = Arrangement.Center) {
            StatusDot(if (host.online) Tone.Success else Tone.Muted, contentDescription = if (host.online) "Online" else "Offline")
          }
        },
      ) {
        OverflowMenu(
          "Manage ${host.name}",
          listOf(
            MenuAction("Rename", ArgusIcon.pencil) { renaming = host },
            MenuAction("Remove", ArgusIcon.trash, destructive = true) { removing = host },
          ),
        )
      }
    }
    SettingsLinkRow("Add a Computer", icon = ArgusIcon.plus) { router.push(Route.AddComputer) }
  }
  AccountDevicesGroup(account)
  SettingsGroup(footer = "Takes this $DEVICE_NOUN off the account and deletes its account key. Computers you paired with a QR code keep working.") {
    SettingsItem {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Btn("Sign Out", tone = ButtonTone.Danger, small = true, hugs = true) { confirmingSignOut = true }
      }
      error?.let {
        Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          Icon(ArgusIcon.warning, null, Modifier.size(14.dp), tint = theme.error)
          Text(it, color = theme.error, style = argusFont(13))
        }
      }
    }
  }
  SettingsGroup(
    title = "Reset account",
    footer = "Only when every other device and computer on your account is lost. Everything leaves the account and has to join again.",
  ) {
    SettingsItem {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Btn("Reset Account", tone = ButtonTone.Secondary, small = true, hugs = true, onClick = onReset)
      }
    }
  }

  if (confirmingSignOut) {
    ConfirmDialog(
      "Sign out of your account?", "Sign out", { scope.launch { account.signOut() } }, { confirmingSignOut = false },
      message = "This $DEVICE_NOUN is taken off the account and its account key is deleted. Computers you paired with a QR code keep working.",
      destructive = true,
    )
  }
  removing?.let { host ->
    ConfirmDialog(
      "Remove “${host.name}” from your account?", "Remove", { scope.launch { account.remove(host.id) } }, { removing = null },
      message = "Your devices stop connecting to it through the account. Link it again with a new code.", destructive = true,
    )
  }
  renaming?.let { host ->
    TextPromptDialog("Rename “${host.name}”", host.name, "Rename", { scope.launch { account.rename(host.id, it) } }, { renaming = null })
  }
}

/** Another device removed this phone from the account: said above every tab, with Join again opening Account. */
@Composable
fun AccountRemovedNotice(modifier: Modifier = Modifier) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val phase by app.account.phase.collectAsState()
  val removed by app.account.removed.collectAsState()
  if (phase != AccountStore.Phase.SignedOut || !removed) return
  AccountRemovedBanner(
    onSignIn = { if (router.frontRoute != Route.Account) router.push(Route.Account) },
    onDismiss = { app.account.dismissRemovedNotice() },
    modifier = modifier.padding(horizontal = 12.dp, vertical = 6.dp),
  )
}
