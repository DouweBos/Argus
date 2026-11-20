package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.push
import dev.houwert.argus.ui.components.ArgusSwitch
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.PullRequestLabels
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * Open a pull request for a session's branch: a title, a description started from the repo's
 * template (or filled in by Claude), draft or not, then push the branch and open it.
 */
@Composable
fun OpenPullRequestSheet(sessionId: String, defaultTitle: String, onDismiss: () -> Unit, onOpened: (String) -> Unit) {
  val app = LocalAppStore.current
  val host = app.host
  val store = app.pullRequests
  val scope = rememberCoroutineScope()
  val uri = LocalUriHandler.current
  val clipboard = LocalClipboardManager.current
  host.sessionsByRepo.collectAsState().value
  val session = host.session(sessionId)
  var title by rememberSaveable { mutableStateOf(defaultTitle) }
  var summary by rememberSaveable { mutableStateOf("") }
  var draft by rememberSaveable { mutableStateOf(true) }
  var busy by remember { mutableStateOf<String?>(null) }
  var error by remember { mutableStateOf<String?>(null) }
  var created by rememberSaveable { mutableStateOf<String?>(null) }
  var confirming by remember { mutableStateOf(false) }
  val trimmedTitle = title.trim()
  val canOpen = busy == null && session != null && trimmedTitle.isNotEmpty()

  LaunchedEffect(sessionId) {
    if (summary.isEmpty()) store.template(sessionId)?.let { if (summary.isEmpty()) summary = it }
  }

  FormSheet("New pull request", null, cancelLabel = if (created == null) "Cancel" else "Done", onDismiss = onDismiss) {
    val url = created
    if (url != null) {
      Card(tone = Tone.Success) {
        SectionHeader("Pull request opened")
        MutedText(url, maxLines = 2)
        FlowRow(packed = true) {
          Btn(PullRequestLabels.openOn(url), small = true, icon = Icon.openExternal, hugs = true) { runCatching { uri.openUri(url) } }
          Btn("Copy link", tone = ButtonTone.Secondary, small = true, icon = Icon.copy, hugs = true) { clipboard.setText(AnnotatedString(url)) }
        }
      }
    } else {
      Field("Pull request", caption = session?.let { "${it.branch} → ${it.baseBranch ?: "base"}" }) {
        ThemedTextField(title, { title = it }, "Title")
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          MutedText("Open as a draft", androidx.compose.ui.Modifier.weight(1f))
          ArgusSwitch(draft, { draft = it })
        }
      }
      Field("Description") {
        ThemedTextField(summary, { summary = it }, "What changed and why", multiline = true, lines = 4..14)
        Btn(
          if (busy == "Filling in") "Filling in" else "Fill in with Claude", tone = ButtonTone.Secondary, small = true,
          icon = Icon.agent, hugs = true, enabled = busy == null && session != null, busy = busy == "Filling in",
        ) {
          val current = session ?: return@Btn
          busy = "Filling in"
          error = null
          scope.launch {
            try {
              val drafted = store.fill(current.id, trimmedTitle.ifEmpty { current.branch })
              if (drafted == null) {
                error = "Claude couldn't fill in the description. Check that `claude` is installed and signed in on the computer."
              } else {
                summary = drafted.body ?: summary
                // A title the user typed stays; the branch-name default doesn't.
                val proposed = drafted.title
                if (proposed != null && (trimmedTitle.isEmpty() || title == defaultTitle || title == current.branch)) title = proposed
              }
            } catch (e: Exception) {
              error = "Couldn't fill in the description — ${HostStore.describe(e)}"
            }
            busy = null
          }
        }
      }
      Btn(busy ?: if (draft) "Push and open draft" else "Push and open", enabled = canOpen) { confirming = true }
    }
    error?.let { Banner(it, tone = Tone.Danger) }
  }

  if (confirming) {
    ConfirmDialog(
      "Open this pull request?",
      "${session?.branch ?: "The branch"} is pushed, then a PR into ${session?.baseBranch ?: "its base"} is opened as you.",
      if (draft) "Push and Open Draft" else "Push and Open",
      onDismiss = { confirming = false },
    ) {
      val current = session ?: return@ConfirmDialog
      error = null
      scope.launch {
        busy = "Pushing"
        host.clearError()
        if (host.push(current.id) == null) {
          error = "Couldn't push ${current.branch}" + (host.lastError.value?.let { " — $it" } ?: "")
          busy = null
          return@launch
        }
        busy = "Opening"
        val url = store.create(current.id, trimmedTitle, summary, draft)
        busy = null
        if (url != null) {
          created = url
          onOpened(url)
        } else {
          error = store.error.value
        }
      }
    }
  }
}
