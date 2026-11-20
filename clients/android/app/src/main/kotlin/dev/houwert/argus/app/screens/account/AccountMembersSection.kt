package dev.houwert.argus.app.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.core.account.approvalCode
import dev.houwert.argus.core.account.deny
import dev.houwert.argus.core.account.remove
import dev.houwert.argus.core.account.rename
import dev.houwert.argus.kit.account.AccountJoinRequestInfo
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.ConfirmDialog
import dev.houwert.argus.ui.components.MenuAction
import dev.houwert.argus.ui.components.OverflowMenu
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsLayout
import dev.houwert.argus.ui.components.TextPromptDialog
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** Account, signed in: who is waiting to join, each reviewed with a code. */
@Composable
fun AccountRequestsGroup(account: AccountStore) {
  val requests by account.requests.collectAsState()
  var reviewing by remember { mutableStateOf<AccountJoinRequestInfo?>(null) }
  if (requests.isEmpty()) return
  SettingsGroup(
    title = "Waiting to join",
    footer = "Approve only a device or computer you just signed in on or started linking. You'll compare a code on both screens.",
  ) {
    for (request in requests) {
      val member = request.subject?.member
      AccountMemberRow(AccountMemberText.icon(member), ArgusTheme.colors.accent, member?.name ?: "Unknown", AccountMemberText.kind(member)) {
        Btn("Deny", tone = ButtonTone.Ghost, small = true, hugs = true) { account.perform { deny(request.requestId) } }
        Btn("Review", small = true, hugs = true) { reviewing = request }
      }
    }
  }
  reviewing?.let { ApproveJoinSheet(account, it) { reviewing = null } }
}

/** Account, signed in: the devices on the account, with rename and remove. */
@Composable
fun AccountDevicesGroup(account: AccountStore) {
  val state by account.state.collectAsState()
  var removing by remember { mutableStateOf<AccountMember?>(null) }
  var renaming by remember { mutableStateOf<AccountMember?>(null) }
  val devices = state?.liveMembers?.filter { it.role == AccountMember.Role.Device } ?: emptyList()
  SettingsGroup(title = "Devices", footer = "Removing a device disconnects it from every computer on your account.") {
    for (device in devices) {
      val isSelf = device.id == account.memberId
      AccountMemberRow(
        AccountMemberText.icon(device), ArgusTheme.colors.textSecondary,
        if (isSelf) "${device.name} (this $DEVICE_NOUN)" else device.name,
        AccountMemberText.detail(device, account.approvalCode(device.id)),
      ) {
        OverflowMenu(
          "Manage ${device.name}",
          listOfNotNull(
            MenuAction("Rename", ArgusIcon.pencil) { renaming = device },
            if (isSelf) null else MenuAction("Remove", ArgusIcon.trash, destructive = true) { removing = device },
          ),
        )
      }
    }
  }
  removing?.let { device ->
    ConfirmDialog(
      "Remove “${device.name}” from your account?", "Remove", { account.perform { remove(device.id) } }, { removing = null },
      message = "It's disconnected from every computer on your account and has to be approved again to come back.", destructive = true,
    )
  }
  renaming?.let { member ->
    TextPromptDialog("Rename “${member.name}”", member.name, "Rename", { account.perform { rename(member.id, it) } }, { renaming = null })
  }
}

/** A device or computer on the account: its kind's glyph, name and detail, then its actions. */
@Composable
internal fun AccountMemberRow(
  icon: ImageVector,
  tint: Color,
  name: String,
  detail: String,
  leading: (@Composable () -> Unit)? = null,
  actions: @Composable RowScope.() -> Unit,
) {
  val theme = ArgusTheme.colors
  Row(
    Modifier.fillMaxWidth().padding(SettingsLayout.rowPadding),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (leading != null) leading() else Icon(icon, null, Modifier.size(20.dp).width(24.dp), tint = tint)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(name, color = theme.text, style = argusFont(15), maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(detail, color = theme.textSecondary, style = argusFont(13), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
  }
}
