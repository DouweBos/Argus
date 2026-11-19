package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.core.sessions.SessionStack
import dev.houwert.argus.core.stores.MergeStrategy
import dev.houwert.argus.core.stores.createSession
import dev.houwert.argus.core.stores.landStack
import dev.houwert.argus.core.stores.restack
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.ContextCardDivider
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** A session's place in its stack, with Restack, Land stack and starting a session on top of it. */
@Composable
fun StackCard(sessionId: String, onNewSessionOnTop: () -> Unit, onChanged: suspend () -> Unit) {
  val host = LocalAppStore.current.host
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  val byRepo by host.sessionsByRepo.collectAsState()
  val merged by host.mergedSessionIds.collectAsState()
  val session = host.session(sessionId) ?: return
  if (session.kind != RemoteSessionKind.worktree || session.status != RemoteSessionStatus.ready || session.compareGroup != null || sessionId in merged) return
  val members = SessionStack.members(sessionId, byRepo[session.repoRoot].orEmpty())
  var busy by remember { mutableStateOf<String?>(null) }
  var note by remember { mutableStateOf<String?>(null) }
  var confirmingLand by remember { mutableStateOf(false) }
  fun name(id: String) = members.firstOrNull { it.id == id }?.let { it.displayName ?: it.branch } ?: "a session"

  Card {
    SectionHeader("Stack")
    if (members.isEmpty()) {
      MutedText("Start a session that branches from ${session.branch}. Its pull request targets this branch.")
    } else {
      members.forEachIndexed { index, member ->
        Row(Modifier.padding(start = (maxOf(index - 1, 0) * 10).dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          Icon(if (index == 0) Icons.branch else Icons.stacked, null, Modifier.size(12.dp), tint = theme.textMuted)
          Text(
            member.displayName ?: member.branch, color = theme.text, maxLines = 1,
            style = argusFont(15, if (member.id == sessionId) FontWeight.SemiBold else FontWeight.Normal),
          )
        }
      }
    }
    note?.let { MutedText(it, maxLines = 3) }
    ContextCardDivider()
    if (members.isNotEmpty()) {
      Btn(if (busy == "restack") "Restacking" else "Restack", tone = ButtonTone.Secondary, small = true, icon = Icons.restack, enabled = busy == null, busy = busy == "restack") {
        busy = "restack"
        scope.launch {
          val result = host.restack(sessionId)
          busy = null
          if (result == null) return@launch
          val conflict = result.conflict
          note = if (conflict != null) {
            "Stopped on a conflict in ${name(conflict.sessionId)} (${conflict.files.joinToString(", ")}). Resolve it on the computer, then restack again."
          } else {
            val moved = result.restacked.size
            (if (moved == 0) "Already up to date." else "Restacked $moved session${if (moved == 1) "" else "s"}.") +
              if (result.pushed.isNotEmpty()) " Pushed ${result.pushed.size} pull request${if (result.pushed.size == 1) "" else "s"}." else ""
          }
          onChanged()
        }
      }
      Btn(if (busy == "land") "Landing" else "Land stack", tone = ButtonTone.Secondary, small = true, icon = Icons.landStack, enabled = busy == null, busy = busy == "land") {
        confirmingLand = true
      }
    }
    Btn("New session on top", tone = ButtonTone.Secondary, small = true, icon = Icons.plus, enabled = busy == null, onClick = onNewSessionOnTop)
  }

  if (confirmingLand) {
    ChoiceSheet(
      "Land all ${members.size} sessions?",
      "Bottom first, each one merges into its base: its pull request when it has one, otherwise on the computer. A conflict or a blocked pull request stops it.",
      MergeStrategy.entries.map { strategy ->
        Choice(strategy.label) {
          busy = "land"
          scope.launch {
            val result = host.landStack(sessionId, strategy)
            busy = null
            if (result == null) return@launch
            val landed = "Landed ${result.landed.size} session${if (result.landed.size == 1) "" else "s"}"
            note = result.stopped?.let { "$landed, then stopped at ${name(it.sessionId)}: ${it.reason}" } ?: "$landed."
            onChanged()
          }
        }
      },
    ) { confirmingLand = false }
  }
}

/** Name a session to stack on another; the computer branches it from that session's branch. */
@Composable
fun StackedSessionSheet(parent: RemoteSession, onDismiss: () -> Unit, onCreated: (RemoteSession) -> Unit) {
  val host = LocalAppStore.current.host
  val scope = rememberCoroutineScope()
  var description by rememberSaveable { mutableStateOf("") }
  var prompt by rememberSaveable { mutableStateOf("") }
  var creating by remember { mutableStateOf(false) }
  FormSheet("New session on top", "Create", confirmEnabled = !creating && description.isNotBlank(), onDismiss = onDismiss, onConfirm = {
    creating = true
    scope.launch {
      val session = host.createSession(
        parent.repoRoot, "", description.trim(), parentSessionId = parent.id, prompt = prompt.trim().ifEmpty { null },
      )
      creating = false
      if (session != null) {
        onDismiss()
        onCreated(session)
      }
    }
  }) {
    Field("What should it do?", caption = "Stacked on ${parent.displayName ?: parent.branch}: branches from ${parent.branch}, and its pull request targets that branch.") {
      ThemedTextField(description, { description = it }, "Describe the work", multiline = true, lines = 2..6)
    }
    Field("First prompt (optional)", caption = "An agent starts with this once the worktree is ready.") {
      ThemedTextField(prompt, { prompt = it }, "First prompt", multiline = true, lines = 3..10)
    }
  }
}
