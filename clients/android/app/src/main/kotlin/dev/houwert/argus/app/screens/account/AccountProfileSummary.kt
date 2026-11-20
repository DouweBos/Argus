package dev.houwert.argus.app.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.ui.components.AccountAvatar
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * Avatar, name and email of the signed-in person, or the sign-in prompt: the Settings header row and
 * the Account screen's header. `compact` is a narrow row that names the account rather than pitching it.
 */
@Composable
fun AccountProfileSummary(account: AccountStore, avatarSize: Dp = 48.dp, modifier: Modifier = Modifier, compact: Boolean = false) {
  val theme = ArgusTheme.colors
  val phase by account.phase.collectAsState()
  val stored by account.profile.collectAsState()
  val profile = if (phase == AccountStore.Phase.SignedOut) null else stored
  Row(
    modifier.semantics(mergeDescendants = true) {},
    horizontalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    AccountAvatar(profile?.initials, imageUrl = profile?.imageUrl, size = avatarSize)
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(
        AccountProfileText.title(phase, profile, compact), color = theme.text,
        style = argusFont(if (compact) 13 else 17, if (compact) FontWeight.Medium else FontWeight.SemiBold),
        maxLines = if (compact) 2 else 1, overflow = TextOverflow.Ellipsis,
      )
      AccountProfileText.subtitle(phase, profile, compact)?.let {
        Text(it, color = theme.textSecondary, style = argusFont(if (compact) 11 else 14), maxLines = if (compact) 2 else 1, overflow = TextOverflow.MiddleEllipsis)
      }
    }
  }
}
