package dev.houwert.argus.app.screens.account

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.core.account.JoinFlow
import dev.houwert.argus.core.account.canReset
import dev.houwert.argus.core.account.confirmApprovedJoin
import dev.houwert.argus.core.account.confirmJoinCode
import dev.houwert.argus.core.account.rejectApprovedJoin
import dev.houwert.argus.core.account.rejectJoinCode
import dev.houwert.argus.core.account.retryJoin
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.CheckCodeCard
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.TitleText
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.icons.SfSymbol
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * Account on a phone the account doesn't know yet: it asked to join, and a device already on the
 * account approves it after both show the same 6-digit code.
 */
@Composable
fun ColumnScope.JoinAccountView(account: AccountStore, onReset: () -> Unit) {
  val join by account.join.collectAsState()
  val error by account.error.collectAsState()
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val ended = @Composable { title: String, body: String ->
    EmptyState(SfSymbol["xmark.circle"], title, Modifier.heightIn(max = 280.dp), body = body)
    Btn("Ask again") { scope.launch { account.retryJoin() } }
  }
  when (val flow = join) {
    JoinFlow.Idle, JoinFlow.Requesting -> Loading("Asking your account")
    JoinFlow.Waiting -> EmptyState(
      SfSymbol["hourglass"], "Approve this $DEVICE_NOUN", Modifier.heightIn(max = 300.dp),
      body = "Your account already has devices. Open Argus on one of them (your other phone, the Mac app, or Settings, Account " +
        "on a computer) and approve this $DEVICE_NOUN there.",
    )
    is JoinFlow.Compare -> {
      TitleText("Compare the codes")
      MutedText("${flow.approverName} shows a code too. Only confirm if they're the same.")
      CheckCodeCard(flow.sas)
      Btn("Codes match") { scope.launch { account.confirmJoinCode() } }
      Btn("They don't match", tone = ButtonTone.Danger) { scope.launch { account.rejectJoinCode() } }
    }
    is JoinFlow.Confirmed -> Loading("Confirmed here. Finish on ${flow.approverName}")
    is JoinFlow.AlreadyApproved -> {
      TitleText("${flow.approverName} approved this $DEVICE_NOUN")
      MutedText("Check that Settings, Account, Devices on ${flow.approverName} shows this code next to this $DEVICE_NOUN.")
      CheckCodeCard(flow.sas)
      Btn("Codes match") { scope.launch { account.confirmApprovedJoin() } }
      Btn("Not mine", tone = ButtonTone.Danger) { scope.launch { account.rejectApprovedJoin() } }
    }
    JoinFlow.Denied -> ended("Not approved", "The request was turned down. Ask again when you're at your other device.")
    JoinFlow.Expired -> ended("The request expired", "Approve it within 10 minutes. Ask again to get a new one.")
    is JoinFlow.Failed -> ended("This $DEVICE_NOUN didn't join", flow.message)
  }
  error?.let { Banner(it, tone = Tone.Danger) }
  Btn("Pair with a QR code instead", tone = ButtonTone.Secondary, icon = Icon.qrCode) { router.push(Route.Pair) }
  if (account.canReset) {
    Field(
      "Nobody left to approve?",
      caption = "Lost every device and computer on your account? Reset it from this $DEVICE_NOUN and link your computers again.",
    ) {
      Btn("Reset account", tone = ButtonTone.Ghost, onClick = onReset)
    }
  }
  Btn("Sign out", tone = ButtonTone.Ghost) { scope.launch { account.signOut() } }
}
