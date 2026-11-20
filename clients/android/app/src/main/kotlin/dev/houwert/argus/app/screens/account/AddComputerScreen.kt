package dev.houwert.argus.app.screens.account

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.core.account.LinkFlow
import dev.houwert.argus.core.account.confirmLink
import dev.houwert.argus.core.account.denyLink
import dev.houwert.argus.core.account.link
import dev.houwert.argus.core.account.resetLink
import dev.houwert.argus.kit.account.AccountCodec
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.CheckCodeCard
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.TitleText
import dev.houwert.argus.ui.icons.SfSymbol
import dev.houwert.argus.ui.theme.Tone

/** Add a computer to the account by the code it shows (`argus-host login`, or signing in to Argus). */
@Composable
fun AddComputerScreen() {
  val account = LocalAppStore.current.account
  val router = LocalRouter.current
  val link by account.link.collectAsState()
  LaunchedEffect(Unit) {
    // A link already under way (handed over by a paired computer) stays.
    if (account.link.value is LinkFlow.Done || account.link.value is LinkFlow.Failed) account.resetLink()
  }
  DisposableEffect(Unit) {
    onDispose { if (account.link.value is LinkFlow.Confirm) account.perform { denyLink() } }
  }
  AppScreen("Add a Computer") {
    Screen {
      when (val flow = link) {
        LinkFlow.Idle, is LinkFlow.Failed -> EnterCode(account, (flow as? LinkFlow.Failed)?.message)
        is LinkFlow.Working -> Loading(flow.message)
        is LinkFlow.Confirm -> {
          TitleText("Compare the codes")
          MutedText("${flow.hostName} shows a code too. Only confirm if they're the same.")
          CheckCodeCard(flow.sas)
          Btn("Codes match") { account.perform { confirmLink() } }
          Btn("They don't match", tone = ButtonTone.Danger) { account.perform { denyLink() } }
        }
        is LinkFlow.Done -> {
          EmptyState(
            SfSymbol["checkmark.circle"], "${flow.hostName} is on your account", Modifier.heightIn(max = 300.dp),
            body = "It shows up under Computers and connects without a QR code.",
          )
          Btn("Done") {
            account.resetLink()
            router.pop()
          }
        }
      }
    }
  }
}

@Composable
private fun ColumnScope.EnterCode(account: AccountStore, failure: String?) {
  var code by rememberSaveable { mutableStateOf("") }
  val valid = AccountCodec.normalizeUserCode(code).length == 9
  val submit = { if (valid) account.perform { link(code) } }
  MutedText("On the computer, run argus-host login or sign in to Argus. Type the code it shows.")
  ThemedTextField(code, { code = it }, "WDJB-MJHT", mono = true, input = TextInput.Code, onSubmit = { submit() })
  Btn("Continue", enabled = valid) { submit() }
  failure?.let { Banner(it, tone = Tone.Danger) }
}
