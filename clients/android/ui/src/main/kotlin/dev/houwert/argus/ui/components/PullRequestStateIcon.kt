package dev.houwert.argus.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import dev.houwert.argus.ui.icons.BrandIcons
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusColors
import dev.houwert.argus.ui.theme.ArgusTheme

/** GitHub's glyph per pull request state, so a PR reads the same here as on github.com. */
fun SessionPullRequestState.icon(): ImageVector =
  when (this) {
    SessionPullRequestState.draft -> BrandIcons.pullRequestDraft
    SessionPullRequestState.merged -> BrandIcons.merge
    SessionPullRequestState.closed -> BrandIcons.pullRequestClosed
    else -> BrandIcons.pullRequest
  }

fun SessionPullRequestState.color(theme: ArgusColors): Color =
  when (this) {
    SessionPullRequestState.draft -> theme.prDraft
    SessionPullRequestState.merged -> theme.prMerged
    SessionPullRequestState.closed -> theme.prClosed
    else -> theme.prOpen
  }

/**
 * A pull request's state icon in GitHub's hue, with an eye beside it while an agent watches it.
 * A phone row is one tap target, so it's only a badge; `label` is what TalkBack reads
 * (`PullRequestLabels.state`).
 */
@Composable
fun PullRequestStateIcon(
  state: SessionPullRequestState,
  label: String,
  modifier: Modifier = Modifier,
  size: Dp = 14.dp,
  watching: Boolean = false,
) {
  val theme = ArgusTheme.colors
  Row(
    modifier.clearAndSetSemantics { contentDescription = label },
    horizontalArrangement = Arrangement.spacedBy(2.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    // The octicons are inset on their canvas, so draw them a size up to match the glyph.
    Icon(state.icon(), null, Modifier.size(size * 1.2f), tint = state.color(theme))
    if (watching) Icon(Icon.eye, null, Modifier.size(size * 0.9f), tint = theme.textSecondary)
  }
}
