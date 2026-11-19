package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.core.stores.applyStash
import dev.houwert.argus.core.stores.dropStash
import dev.houwert.argus.core.stores.listStashes
import dev.houwert.argus.core.stores.listTags
import dev.houwert.argus.kit.protocol.generated.GitStashEntry
import dev.houwert.argus.kit.protocol.generated.GitTag
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** A session's stashes and tags, as the Mac's stash list: tap or long-press a stash for its menu. Tags are read-only. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun StashesScreen(sessionId: String, label: String) {
  val host = LocalAppStore.current.host
  val scope = rememberCoroutineScope()
  val control = hasControl()
  val clipboard = LocalClipboardManager.current
  var stashes by remember { mutableStateOf(emptyList<GitStashEntry>()) }
  var tags by remember { mutableStateOf(emptyList<GitTag>()) }
  var loaded by remember { mutableStateOf(false) }
  var refreshing by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf<Int?>(null) }
  var note by remember { mutableStateOf<String?>(null) }
  var dropping by remember { mutableStateOf<GitStashEntry?>(null) }

  suspend fun refresh() {
    stashes = host.listStashes(sessionId)
    tags = host.listTags(sessionId)
    loaded = true
  }
  LaunchedEffect(sessionId) { refresh() }

  fun apply(index: Int, drop: Boolean) {
    busy = index
    scope.launch {
      host.applyStash(sessionId, index, drop)?.let { note = it.ifEmpty { if (drop) "Popped." else "Applied." } }
      busy = null
      refresh()
    }
  }

  GitScaffold("Stashes and Tags · $label") {
    PullToRefreshBox(refreshing, onRefresh = {
      refreshing = true
      scope.launch {
        refresh()
        refreshing = false
      }
    }, Modifier.fillMaxSize()) {
      if (!loaded) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Loading("Reading stashes") }
        return@PullToRefreshBox
      }
      Screen {
        note?.let { MutedText(it, maxLines = 4) }
        ListSection(header = "Stashes · ${stashes.size}") {
          if (stashes.isEmpty()) MutedText("Nothing stashed.", Modifier.padding(16.dp))
          for (stash in stashes) {
            val index = stash.index.toInt()
            StashRow(
              stash, dim = busy == index,
              menu = if (control && busy == null) listOf(
                BranchMenuEntry.Item("Apply", Icons.download) { apply(index, drop = false) },
                BranchMenuEntry.Item("Pop", Icons.download) { apply(index, drop = true) },
                BranchMenuEntry.Item("Copy message", Icons.copy) { clipboard.setText(AnnotatedString(stash.message)) },
                BranchMenuEntry.Divider,
                BranchMenuEntry.Item("Drop", Icons.trash, destructive = true) { dropping = stash },
              ) else null,
            )
          }
        }
        ListSection(header = "Tags · ${tags.size}") {
          if (tags.isEmpty()) MutedText("No tags.", Modifier.padding(16.dp))
          for (tag in tags) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
              Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                BodyText(tag.name, Modifier.weight(1f, fill = false), maxLines = 1)
                if (tag.pushed == false) Badge("not pushed")
              }
              MutedText("${tag.commitHash.take(7)} ${tag.subject}", maxLines = 1)
            }
          }
        }
      }
    }
  }

  dropping?.let { stash ->
    ConfirmDialog("Drop this stash?", "The stashed changes are gone for good.", "Drop", destructive = true, onDismiss = { dropping = null }) {
      val index = stash.index.toInt()
      busy = index
      scope.launch {
        if (host.dropStash(sessionId, index)) note = "Dropped stash@{$index}."
        busy = null
        refresh()
      }
    }
  }
}

/** A stash as the Mac lists it: the message, then its ref, branch and age. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun StashRow(stash: GitStashEntry, dim: Boolean, menu: List<BranchMenuEntry>?) {
  val theme = ArgusTheme.colors
  var open by remember { mutableStateOf(false) }
  Box {
    Column(
      Modifier.fillMaxWidth().alpha(if (dim) 0.5f else 1f)
        .then(
          if (menu != null) {
            Modifier.semantics { onLongClick("Stash actions") { open = true; true } }
              .combinedClickable(onClickLabel = "Stash actions", onLongClick = { open = true }) { open = true }
          } else Modifier
        )
        .padding(horizontal = 16.dp, vertical = 10.dp),
      verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
      BodyText(stash.message, maxLines = 2)
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("stash@{${stash.index.toInt()}}", color = theme.textSecondary, style = argusFont(12, mono = true))
        StashText.branch(stash.message)?.let {
          Icon(Icons.branch, null, Modifier.size(12.dp), tint = theme.textSecondary)
          Text(it, color = theme.textSecondary, style = argusFont(12), maxLines = 1)
        }
        Box(Modifier.weight(1f))
        Text(StashText.whenLabel(stash.date), color = theme.textSecondary, style = argusFont(12), maxLines = 1)
      }
    }
    if (menu != null) DropdownMenu(open, { open = false }, containerColor = theme.surface) { BranchMenuItems(menu) { open = false } }
  }
}

internal object StashText {
  private val branchPattern = Regex("^(?:WIP on|On) ([^:]+):")

  /** Git names the branch in the message: "On main: …" or "WIP on main: …". */
  fun branch(message: String): String? = branchPattern.find(message)?.groupValues?.get(1)

  /** Git's ISO date as "3h ago"; the raw string if it doesn't parse. */
  fun whenLabel(iso: String): String = isoMillis(iso)?.let(Labels::timeAgo) ?: iso
}
