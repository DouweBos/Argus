package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.stores.commitDiff
import dev.houwert.argus.core.stores.compareBranches
import dev.houwert.argus.kit.protocol.generated.RemoteBranchCompare
import dev.houwert.argus.kit.protocol.generated.RemoteCommitSummary
import dev.houwert.argus.kit.util.DiffParser
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.CommitRow
import dev.houwert.argus.ui.components.FileDiffCard
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.theme.Tone
import java.time.Instant
import java.time.OffsetDateTime

/** One commit's diff, file by file. */
@Composable
fun CommitScreen(sessionId: String, hash: String, subject: String) {
  val host = LocalAppStore.current.host
  var diff by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(sessionId, hash) { diff = host.commitDiff(sessionId, hash) ?: "" }
  val files = remember(diff) { diff?.let(DiffParser::parse).orEmpty() }
  GitScaffold(hash.take(8)) {
    Screen {
      Card {
        BodyText(subject)
        MonoText(hash, size = 11, maxLines = 1)
      }
      when {
        diff == null -> Loading("Reading the commit")
        files.isEmpty() -> MutedText("No file changes.")
        else -> {
          SectionHeader("Files", count = files.size)
          for (file in files) FileDiffCard(file)
        }
      }
    }
  }
}

/** Where two branches diverged: the commits only one side has. */
@Composable
fun BranchCompareScreen(sessionId: String, left: String, right: String) {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  var result by remember { mutableStateOf<RemoteBranchCompare?>(null) }
  var loaded by remember { mutableStateOf(false) }
  LaunchedEffect(sessionId, left, right) {
    result = host.compareBranches(sessionId, left, right)
    loaded = true
  }
  GitScaffold("$left ↔ $right") {
    Screen {
      val compare = result
      when {
        compare != null -> {
          Card {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
              val base = compare.mergeBase
              if (base != null) {
                MutedText("Merge base")
                MonoText(base.take(8), size = 12)
              } else {
                MutedText("No shared history")
              }
              Spacer(Modifier.weight(1f))
              if (compare.wouldConflict) Badge("Conflicts likely", tone = Tone.Danger)
              else if (compare.mergeBase != null) Badge("Merges cleanly", tone = Tone.Success)
            }
          }
          Side("Only on $left", compare.leftOnly) { router.push(Route.Commit(sessionId, it.hash, it.subject)) }
          Side("Only on $right", compare.rightOnly) { router.push(Route.Commit(sessionId, it.hash, it.subject)) }
        }
        loaded -> MutedText("Couldn't compare these branches.")
        else -> Loading("Comparing")
      }
    }
  }
}

@Composable
private fun Side(title: String, commits: List<RemoteCommitSummary>, onOpen: (RemoteCommitSummary) -> Unit) {
  SectionHeader(title, count = commits.size)
  if (commits.isEmpty()) MutedText("Nothing.")
  for (commit in commits) {
    CommitRow(commit.subject, commit.hash, commit.author, Labels.timeAgo(commit.timestamp)) { onOpen(commit) }
  }
}

/** Git's ISO date as epoch ms; null when it doesn't parse. */
internal fun isoMillis(iso: String): Double? =
  runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli().toDouble() }.getOrNull()
    ?: runCatching { Instant.parse(iso).toEpochMilli().toDouble() }.getOrNull()
