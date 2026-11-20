package dev.houwert.argus.app.screens.account

import android.text.format.DateUtils
import androidx.compose.ui.graphics.vector.ImageVector
import dev.houwert.argus.core.account.AccountResetNotice
import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.core.account.IdentityAction
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountProfile
import dev.houwert.argus.ui.components.CheckCode
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.icons.SfSymbol
import java.text.DateFormat
import java.util.Date

/** How a device on the account is named and drawn, the same as on the Mac and the iPhone. */
object AccountMemberText {
  fun icon(member: AccountMember?): ImageVector = when (member?.kind) {
    "ios" -> SfSymbol["iphone"]
    "mac" -> SfSymbol["laptopcomputer"]
    "web" -> SfSymbol["globe"]
    else -> Icon.desktop
  }

  fun kind(member: AccountMember?): String {
    member ?: return ""
    if (member.role == AccountMember.Role.Host) return if (member.platform == "linux") "Linux computer" else "Mac computer"
    return when (member.kind) {
      // The wire kind phones share; see ACCOUNT_DEVICE_KIND.
      "ios" -> "Phone"
      "mac" -> "Mac app"
      "web" -> "Browser"
      else -> "Desktop app"
    }
  }

  /** Kind, date, and the code it was approved with, so a device approved while away can check it. */
  fun detail(member: AccountMember, code: String?): String {
    val base = "${kind(member)} · added ${added(member)}"
    return code?.let { "$base · code ${CheckCode.grouped(it)}" } ?: base
  }

  fun added(member: AccountMember): String = DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(member.createdAt.toLong()))
}

/** "Online", or "Offline · last seen 2 hours ago". */
object AccountPresenceText {
  fun text(online: Boolean, lastSeen: Double?, nowMs: Long = System.currentTimeMillis()): String {
    if (online) return "Online"
    lastSeen ?: return "Offline"
    val seen = DateUtils.getRelativeTimeSpanString(lastSeen.toLong(), nowMs, DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE)
    return "Offline · last seen $seen"
  }
}

/** What the account header says in each phase. */
object AccountProfileText {
  fun title(phase: AccountStore.Phase, profile: AccountProfile?, compact: Boolean = false): String {
    if (phase == AccountStore.Phase.SignedOut) return if (compact) "Argus account" else "Sign in to Argus"
    return profile?.displayName ?: "Argus account"
  }

  fun subtitle(phase: AccountStore.Phase, profile: AccountProfile?, compact: Boolean = false): String? = when (phase) {
    AccountStore.Phase.SignedOut -> if (compact) "Not signed in" else "Reach your computers without a QR code"
    AccountStore.Phase.Loading, AccountStore.Phase.SigningIn, AccountStore.Phase.SettingUp -> profile?.subtitle ?: "Checking your account"
    AccountStore.Phase.AwaitingApproval -> "Waiting for device approval"
    AccountStore.Phase.Ready -> profile?.subtitle ?: if (profile?.displayName == null) "Signed in" else null
  }
}

/** The sign-in form's heading: plain sign-in, or the identity action that asked for it. */
object AccountSignInCopy {
  fun title(action: IdentityAction?): String = when (action) {
    IdentityAction.Reset -> "Sign in again to reset your account"
    null -> "Sign in to Argus"
  }

  fun detail(action: IdentityAction?, deviceNoun: String): String? = when (action) {
    IdentityAction.Reset ->
      "Resetting needs proof that it's you. This $deviceNoun stays on your account either way; once you're signed in, choose Reset account again."
    null -> null
  }
}

object AccountResetText {
  fun notice(notice: AccountResetNotice, deviceNoun: String): String {
    val by = notice.byName?.let { " from “$it”" } ?: ""
    val on = notice.atMs?.let { " on ${DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it.toLong()))}" } ?: ""
    val approver = notice.byName ?: "that device"
    return "It was reset$by$on. This $deviceNoun left it. Approve it from $approver to come back."
  }
}

/** What this device is called in the account copy. */
internal const val DEVICE_NOUN = "phone"
