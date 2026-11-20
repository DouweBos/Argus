package dev.houwert.argus.app.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.core.account.ApprovalFlow
import dev.houwert.argus.core.account.approve
import dev.houwert.argus.core.account.confirmApproval
import dev.houwert.argus.core.account.denyApproval
import dev.houwert.argus.core.account.refreshRequests
import dev.houwert.argus.core.account.resetApproval
import dev.houwert.argus.kit.account.AccountJoinRequestInfo
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.CheckCodeCard
import dev.houwert.argus.ui.components.ConfirmDialog
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.TitleText
import dev.houwert.argus.ui.icons.SfSymbol
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.delay

/** Approving a phone, Mac or computer that asked to join: compare the 6-digit code it shows, then add it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApproveJoinSheet(account: AccountStore, request: AccountJoinRequestInfo, onClose: () -> Unit) {
  val approval by account.approval.collectAsState()
  val name = request.subject?.member?.name ?: "This device"
  LaunchedEffect(request.requestId) { account.approve(request) }
  DisposableEffect(request.requestId) {
    onDispose {
      // Closed mid-compare: the request is refused, so the other device stops waiting.
      if (account.approval.value is ApprovalFlow.Confirm) account.perform { denyApproval() }
      account.resetApproval()
    }
  }
  ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = ArgusTheme.colors.bg) {
    Column(
      Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp).navigationBarsPadding().heightIn(min = 240.dp),
      verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      TitleText("Approve $name")
      when (val flow = approval) {
        ApprovalFlow.Idle, is ApprovalFlow.Working -> Loading("Checking $name")
        is ApprovalFlow.Confirm -> {
          MutedText("${flow.name} shows a code too. Only add it if they're the same.")
          CheckCodeCard(flow.sas)
          Btn("Codes match, add it") { account.perform { confirmApproval() } }
          Btn("They don't match", tone = ButtonTone.Danger) {
            account.perform {
              denyApproval()
              onClose()
            }
          }
        }
        is ApprovalFlow.Done -> {
          EmptyState(
            SfSymbol["checkmark.circle"], "${flow.name} is on your account", Modifier.heightIn(max = 260.dp),
            body = if (flow.role == AccountMember.Role.Host) "It shows up under Computers and connects without a QR code."
            else "It can now reach every computer on your account.",
          )
          Btn("Done", onClick = onClose)
        }
        is ApprovalFlow.Failed -> {
          Banner(flow.message, tone = Tone.Danger)
          Btn("Close", tone = ButtonTone.Secondary, onClick = onClose)
        }
      }
    }
  }
}

/**
 * While the app is open and signed in: someone waiting to join gets a prompt wherever the user is, and
 * Review opens the code comparison. Place once near the root.
 */
@Composable
fun JoinRequestPrompt(account: AccountStore) {
  val phase by account.phase.collectAsState()
  val requests by account.requests.collectAsState()
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  var asking by remember { mutableStateOf<AccountJoinRequestInfo?>(null) }
  var reviewing by remember { mutableStateOf<AccountJoinRequestInfo?>(null) }
  val seen = remember { mutableSetOf<String>() }
  // A request lives 10 minutes; checking every 30 s while open catches it.
  LaunchedEffect(phase == AccountStore.Phase.Ready) {
    if (phase != AccountStore.Phase.Ready) return@LaunchedEffect
    lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
      while (true) {
        account.refreshRequests()
        delay(30_000)
      }
    }
  }
  LaunchedEffect(requests.map { it.requestId }) {
    // Approved or denied elsewhere meanwhile: the question is moot.
    if (asking?.let { a -> requests.none { it.requestId == a.requestId } } == true) asking = null
    if (asking != null || reviewing != null) return@LaunchedEffect
    val next = requests.firstOrNull { it.requestId !in seen } ?: return@LaunchedEffect
    seen += next.requestId
    asking = next
  }
  asking?.let { request ->
    ConfirmDialog(
      "${request.subject?.member?.name ?: "A device"} wants to join your account", "Review", { reviewing = request }, { asking = null },
      message = "You'll compare a 6-digit code on both screens. Didn't just sign in on it? Choose Cancel and deny it in Settings, Account.",
    )
  }
  reviewing?.let { ApproveJoinSheet(account, it) { reviewing = null } }
}
