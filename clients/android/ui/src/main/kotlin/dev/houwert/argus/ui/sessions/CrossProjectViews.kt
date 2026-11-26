package dev.houwert.argus.ui.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.CrossProjectFailure
import dev.houwert.argus.core.stores.CrossProjectRepo
import dev.houwert.argus.kit.protocol.generated.RemoteSessionAvailability
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.ProjectBadge
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.composer.ComposerHost
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** Where a cross-project repository stands: setup first, then its pull request; null for a ready one without a PR. */
object CrossProjectLabels {
  fun state(repo: CrossProjectRepo): Pair<String, Tone>? {
    val session = repo.session ?: return "Loading" to Tone.Muted
    when (session.status) {
      RemoteSessionStatus.initializing -> return "Setting up" to Tone.Muted
      RemoteSessionStatus.error -> return "Setup failed" to Tone.Danger
      RemoteSessionStatus.deleting -> return "Removing" to Tone.Muted
    }
    if (session.availability == RemoteSessionAvailability.unavailable) return "Drive missing" to Tone.Warning
    val pr = session.pullRequest ?: return null
    return when (pr.state) {
      SessionPullRequestState.open -> "PR #${pr.number}" to Tone.Accent
      SessionPullRequestState.draft -> "Draft #${pr.number}" to Tone.Muted
      SessionPullRequestState.merged -> "Merged" to Tone.Success
      else -> "Closed" to Tone.Muted
    }
  }

  fun actionLabel(count: Int) = if (count == 1) "Add Worktree" else "Add Worktrees"

  fun offerText(names: List<String>, branch: String, adding: Boolean): String {
    val list = when (names.size) {
      1 -> names[0]
      2 -> "${names[0]} and ${names[1]}"
      else -> names.dropLast(1).joinToString(", ") + ", and " + names.last()
    }
    if (adding) return "Making a worktree of $list on $branch and running its setup"
    val each = if (names.size == 1) "It gets" else "Each gets"
    return "$each a worktree on $branch so the agent can change $list too, and lands on its own."
  }
}

/**
 * A cross-project session's repositories, one row each: the project, its branch and where its
 * worktree stands. Picking one opens that repository's changes, where it lands on its own.
 */
@Composable
fun CrossProjectRepoList(repos: List<CrossProjectRepo>, currentSessionId: String, modifier: Modifier = Modifier, onSelect: (CrossProjectRepo) -> Unit) {
  val theme = ArgusTheme.colors
  Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
    for (repo in repos) {
      val current = repo.sessionId == currentSessionId
      val interaction = rememberInteraction()
      val state = CrossProjectLabels.state(repo)
      Row(
        Modifier
          .fillMaxWidth()
          .argusClickable(interaction, enabled = !current, shape = RoundedCornerShape(ArgusMetrics.radiusSmall), label = "Open ${repo.name}") { onSelect(repo) }
          .background(if (current) theme.selection else androidx.compose.ui.graphics.Color.Transparent, RoundedCornerShape(ArgusMetrics.radiusSmall))
          .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        ProjectBadge(repo.name, key = repo.repoRoot, size = 20.dp)
        Column(Modifier.weight(1f)) {
          Text(repo.name, style = argusFont(14, if (current) FontWeight.SemiBold else FontWeight.Normal), color = theme.text, maxLines = 1)
          Text(repo.branch, style = argusFont(12, mono = true), color = theme.textMuted, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
        }
        state?.let { Badge(it.first, tone = it.second) }
        Spacer(Modifier.width(2.dp))
        Icon(
          if (current) Icons.check else Icons.chevronRight, contentDescription = if (current) "Shown" else null,
          tint = if (current) theme.accent else theme.textMuted, modifier = Modifier.size(16.dp),
        )
      }
    }
  }
}

/**
 * Above the composer once a message links another project: offers to give the session a
 * worktree of it on the same branch, so the agent changes both and each lands on its own.
 */
@Composable
fun CrossProjectOffer(host: ComposerHost, sessionId: String?, branch: String?, linked: List<String>, modifier: Modifier = Modifier) {
  val scope = rememberCoroutineScope()
  var declined by remember(sessionId) { mutableStateOf(emptySet<String>()) }
  var adding by remember(sessionId) { mutableStateOf(false) }
  var failures by remember(sessionId) { mutableStateOf(emptyList<CrossProjectFailure>()) }
  if (sessionId == null || branch == null || !host.hasControl) return
  val candidates = host.crossProjectCandidates(sessionId, linked).filterNot { it.repoRoot in declined }
  Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    if (candidates.isNotEmpty()) {
      val roots = candidates.map { it.repoRoot }
      Banner(
        CrossProjectLabels.offerText(candidates.map { it.name }, branch, adding), tone = Tone.Accent,
        title = "Make this a cross-project session?",
        actionLabel = if (adding) null else CrossProjectLabels.actionLabel(candidates.size), actionTone = ButtonTone.Primary,
        onAction = if (adding) null else ({
          adding = true
          scope.launch {
            val failed = host.makeCrossProject(sessionId, roots)
            adding = false
            failures = failed.orEmpty()
            if (failed == null) declined = declined + roots
          }
        }),
        onDismiss = if (adding) null else ({ declined = declined + roots }),
      )
    }
    for (failure in failures) {
      Banner(
        failure.error, tone = Tone.Danger, title = "Couldn't add ${failure.repoRoot.trimEnd('/').substringAfterLast('/')}",
        onDismiss = { failures = failures.filterNot { it.repoRoot == failure.repoRoot } },
      )
    }
  }
}
