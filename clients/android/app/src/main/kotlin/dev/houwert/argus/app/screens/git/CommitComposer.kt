package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.core.git.CommitMessage
import dev.houwert.argus.core.stores.CommitIdentity
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.branchLog
import dev.houwert.argus.core.stores.commit
import dev.houwert.argus.core.stores.commitIdentity
import dev.houwert.argus.core.stores.draftCommitMessage
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Chip
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * Summary and description over a strip of options, as the Mac's commit composer: Draft, Amend,
 * Sign off and Sign chips, and who the commit is authored as. [busy] is shared with the card
 * around it, so only one git action runs at a time.
 */
@Composable
fun CommitComposer(
  sessionId: String,
  allowsAmend: Boolean,
  changeSummary: String,
  busy: String?,
  onBusy: (String?) -> Unit,
  onCommitted: suspend (String) -> Unit,
) {
  val host = LocalAppStore.current.host
  val scope = rememberCoroutineScope()
  var summary by rememberSaveable(sessionId) { mutableStateOf("") }
  var description by rememberSaveable(sessionId) { mutableStateOf("") }
  var beforeAmend by remember { mutableStateOf<CommitMessage?>(null) }
  var amend by rememberSaveable { mutableStateOf(false) }
  var signOff by rememberSaveable { mutableStateOf(false) }
  var sign by rememberSaveable { mutableStateOf(false) }
  var identity by remember { mutableStateOf<CommitIdentity?>(null) }
  var draftError by remember { mutableStateOf<String?>(null) }
  val message = CommitMessage(summary, description)
  LaunchedEffect(sessionId) { identity = host.commitIdentity(sessionId) }

  fun set(next: CommitMessage) {
    summary = next.summary
    description = next.description
  }

  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    MessageFields(summary, { summary = it }, description, { description = it })
    draftError?.let { Banner(it, tone = Tone.Danger) }
    FlowRow(spacing = 6.dp, rowSpacing = 6.dp, packed = true) {
      Chip(if (busy == "draft") "Drafting" else "Draft", icon = Icon.draft, contentDescription = "Draft a message with Claude") {
        if (busy != null) return@Chip
        onBusy("draft")
        draftError = null
        scope.launch {
          try {
            host.draftCommitMessage(sessionId, allChanges = true)?.let(::set)
          } catch (e: Exception) {
            draftError = HostStore.describe(e)
          }
          onBusy(null)
        }
      }
      if (allowsAmend) {
        OptionChip("Amend", amend) {
          amend = !amend
          if (amend) {
            // Amending starts from the last commit's message, as git's own editor would.
            val typed = message
            beforeAmend = typed
            scope.launch {
              val last = host.branchLog(sessionId, "HEAD", 1)?.firstOrNull() ?: return@launch
              if (amend && CommitMessage(summary, description) == typed) {
                set(CommitMessage.parse(if (last.body.isEmpty()) last.subject else "${last.subject}\n\n${last.body}"))
              }
            }
          } else {
            beforeAmend?.let(::set)
            beforeAmend = null
          }
        }
      }
      OptionChip("Sign off", signOff) { signOff = !signOff }
      if (identity?.canSign == true) OptionChip("Sign", sign) { sign = !sign }
      identity?.label?.let { Chip(it, icon = Icon.person, contentDescription = "Commits as $it") }
    }
    MutedText(changeSummary)
    Btn(
      if (busy == "commit") "Committing" else if (amend) "Amend" else "Commit all",
      small = true, icon = Icon.check, enabled = !message.isEmpty && busy == null, busy = busy == "commit",
    ) {
      onBusy("commit")
      val amending = amend
      scope.launch {
        val output = host.commit(sessionId, message.text, amending, signOff, sign)
        onBusy(null)
        if (output == null) return@launch
        set(CommitMessage())
        beforeAmend = null
        amend = false
        onCommitted(if (amending) "Amended the last commit." else "Committed.")
      }
    }
  }
}

@Composable
private fun OptionChip(label: String, on: Boolean, toggle: () -> Unit) {
  Chip(label, icon = if (on) Icon.check else null, tone = if (on) Tone.Accent else null, contentDescription = if (on) "$label, on" else "$label, off", onClick = toggle)
}

/** One field box, the summary over the description, like the Mac's. */
@Composable
private fun MessageFields(summary: String, onSummary: (String) -> Unit, description: String, onDescription: (String) -> Unit) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  Column(Modifier.fillMaxWidth().background(theme.bgTertiary, shape).border(1.dp, theme.border, shape)) {
    Field(summary, onSummary, "Summary", argusFont(15, FontWeight.Medium), singleLine = true)
    Box(Modifier.fillMaxWidth().height(1.dp).background(theme.border))
    Field(description, onDescription, "Description", argusFont(15), singleLine = false)
  }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, placeholder: String, style: TextStyle, singleLine: Boolean) {
  val theme = ArgusTheme.colors
  BasicTextField(
    value, onChange, Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 9.dp),
    textStyle = style.copy(color = theme.text),
    singleLine = singleLine, minLines = if (singleLine) 1 else 2, maxLines = if (singleLine) 1 else 8,
    cursorBrush = SolidColor(theme.accent),
    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = if (singleLine) ImeAction.Next else ImeAction.Default),
    decorationBox = { inner ->
      Box {
        if (value.isEmpty()) Text(placeholder, color = theme.textMuted, style = style)
        inner()
      }
    },
  )
}
