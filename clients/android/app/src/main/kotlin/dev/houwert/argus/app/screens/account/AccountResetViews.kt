package dev.houwert.argus.app.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.account.AccountResetNotice
import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.core.account.ResetFlow
import dev.houwert.argus.core.account.beginReset
import dev.houwert.argus.core.account.cancelReset
import dev.houwert.argus.core.account.confirmResetCode
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.TextKeyboard
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.TitleText
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/** Starting the account over: the warning, the emailed code that confirms it's you, and the reset. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountResetSheet(account: AccountStore, onClose: () -> Unit) {
  val reset by account.reset.collectAsState()
  val error by account.error.collectAsState()
  val phase by account.phase.collectAsState()
  val signInNeeded by account.signInNeeded.collectAsState()
  val scope = rememberCoroutineScope()
  var code by remember { mutableStateOf("") }
  var started by remember { mutableStateOf(false) }
  val close = {
    account.cancelReset()
    onClose()
  }
  val confirm = {
    val typed = code
    code = ""
    scope.launch { account.confirmResetCode(typed) }
  }
  LaunchedEffect(reset, phase, signInNeeded) {
    if (started && reset == ResetFlow.Idle && phase == AccountStore.Phase.Ready && signInNeeded == null) onClose()
    // No sign-in to prove it's you: the account screen shows one instead.
    if (signInNeeded != null) onClose()
  }
  ModalBottomSheet(onDismissRequest = close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = ArgusTheme.colors.bg) {
    Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 20.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      when (val flow = reset) {
        ResetFlow.Idle, is ResetFlow.Failed -> {
          TitleText("Reset your account?")
          BodyText(
            "Only do this if you've lost every device and computer that could approve this $DEVICE_NOUN. " +
              "Everything leaves your account: each computer has to be linked again from its own keyboard, " +
              "and your other devices ask to join again. Computers you paired with a QR code keep working.",
          )
          if (flow is ResetFlow.Failed) Banner(flow.message, tone = Tone.Danger)
          Btn("Reset account", tone = ButtonTone.Danger) {
            started = true
            scope.launch { account.beginReset() }
          }
          Btn("Cancel", tone = ButtonTone.Ghost, onClick = close)
        }
        ResetFlow.SendingCode -> Loading("Sending a code")
        ResetFlow.Resetting -> Loading("Resetting your account")
        is ResetFlow.AwaitingCode -> {
          TitleText("Confirm it's you")
          MutedText("We sent a code to ${flow.email}. Enter it to reset your account.")
          ThemedTextField(code, { code = it }, "Code", keyboard = TextKeyboard.DecimalPad, mono = true, input = TextInput.Code, onSubmit = { confirm() })
          error?.let { Banner(it, tone = Tone.Danger) }
          Btn("Confirm and reset", tone = ButtonTone.Danger, enabled = code.isNotBlank()) { confirm() }
          Btn("Cancel", tone = ButtonTone.Ghost, onClick = close)
        }
      }
    }
  }
}

/** The account was reset from another device: this one asks to join again. */
@Composable
fun AccountResetNoticeBanner(notice: AccountResetNotice, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
  Banner(
    AccountResetText.notice(notice, DEVICE_NOUN), modifier, tone = Tone.Warning, title = "Your account was reset",
    actionLabel = "Dismiss", onAction = onDismiss,
  )
}

/** Another device took this one off the account: said wherever the user is, with joining again one tap away. */
@Composable
fun AccountRemovedBanner(onSignIn: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
  Banner(
    "Sign in to ask to join again; a device still on your account approves this $DEVICE_NOUN.", modifier,
    tone = Tone.Warning, title = "This $DEVICE_NOUN was removed from your account", actionLabel = "Join again",
    actionTone = ButtonTone.Primary, onAction = onSignIn, onDismiss = onDismiss,
  )
}
