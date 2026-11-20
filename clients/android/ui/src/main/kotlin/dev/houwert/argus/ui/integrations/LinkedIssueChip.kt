package dev.houwert.argus.ui.integrations

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import dev.houwert.argus.kit.protocol.generated.LinkedIssue
import dev.houwert.argus.ui.components.Chip
import dev.houwert.argus.ui.icons.Icon

/** The Linear issue a session was started from; opens it, in the app with [onOpen], else in Linear. */
@Composable
fun LinkedIssueChip(issue: LinkedIssue, modifier: Modifier = Modifier, onOpen: (() -> Unit)? = null) {
  val uri = LocalUriHandler.current
  Chip(
    "${issue.identifier} ${issue.title}", modifier, icon = Icon.issue,
    contentDescription = "Open ${issue.identifier}",
    onClick = onOpen ?: { runCatching { uri.openUri(issue.url) }; Unit },
  )
}
