package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.ForkedChat
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.MessageForkTarget
import dev.houwert.argus.core.stores.fork
import dev.houwert.argus.core.stores.isOptimistic
import dev.houwert.argus.core.stores.rewind
import dev.houwert.argus.core.transcript.copyText
import dev.houwert.argus.core.transcript.editableText
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.FormSheet
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** What a message's long-press menu offers. */
enum class MessageMenuAction { Copy, Edit, Fork }

/**
 * The menu's wiring, from the screen that owns the transcript. Absent, messages have no menu.
 * [canChange]: edit and fork act on a live conversation the device may control; otherwise only copy.
 */
class MessageMenu(val canChange: Boolean, val perform: (MessageMenuAction, RemoteMessage) -> Unit)

/** The actions [menu] offers on [message]: copy for any text, edit for your own and fork for both while live. */
internal fun menuActions(menu: MessageMenu?, message: RemoteMessage): List<MessageMenuAction> {
  if (menu == null || HostStore.isOptimistic(message.id)) return emptyList()
  return buildList {
    if (message.copyText != null) add(MessageMenuAction.Copy)
    if (menu.canChange) {
      if (message.role == RemoteMessageRole.user) add(MessageMenuAction.Edit)
      add(MessageMenuAction.Fork)
    }
  }
}

private val MessageMenuAction.label: String
  get() = when (this) {
    MessageMenuAction.Copy -> "Copy"
    MessageMenuAction.Edit -> "Edit"
    MessageMenuAction.Fork -> "Fork from Here"
  }

private val MessageMenuAction.icon: ImageVector
  get() = when (this) {
    MessageMenuAction.Copy -> Icon.copy
    MessageMenuAction.Edit -> Icon.pencil
    MessageMenuAction.Fork -> Icon.branch
  }

/**
 * Long-press opens the message's actions in a sheet; TalkBack gets them as named actions too, since
 * a long-press alone is out of its reach.
 */
@OptIn(ExperimentalFoundationApi::class)
internal fun Modifier.messageMenu(menu: MessageMenu?, message: RemoteMessage): Modifier = composed {
  val actions = remember(menu, message) { menuActions(menu, message) }
  if (actions.isEmpty() || menu == null) return@composed this
  var open by remember { mutableStateOf(false) }
  val haptics = LocalHapticFeedback.current
  if (open) MessageActionsSheet(actions, onPick = { menu.perform(it, message) }, onDismiss = { open = false })
  this
    .semantics {
      customActions = actions.map { action -> CustomAccessibilityAction(action.label) { menu.perform(action, message); true } }
    }
    .combinedClickable(
      interactionSource = remember { MutableInteractionSource() },
      indication = null,
      onClick = {},
      onLongClickLabel = "Message actions",
      onLongClick = {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        open = true
      },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MessageActionsSheet(actions: List<MessageMenuAction>, onPick: (MessageMenuAction) -> Unit, onDismiss: () -> Unit) {
  val theme = ArgusTheme.colors
  val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  val scope = rememberCoroutineScope()
  ModalBottomSheet(onDismiss, sheetState = state, containerColor = theme.bg, contentColor = theme.text) {
    Column(Modifier.navigationBarsPadding().padding(bottom = 8.dp)) {
      for (action in actions) {
        Row(
          Modifier.fillMaxWidth()
            .argusClickable(rememberInteraction(), label = action.label) {
              scope.launch { state.hide() }.invokeOnCompletion {
                onDismiss()
                onPick(action)
              }
            }
            .padding(horizontal = 20.dp, vertical = 14.dp),
          horizontalArrangement = Arrangement.spacedBy(14.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Icon(action.icon, null, Modifier.size(20.dp), tint = theme.textSecondary)
          Text(action.label, color = theme.text, style = argusFont(16))
        }
      }
    }
  }
}

/**
 * Edit one of your messages: the conversation rewinds to it and the edit is sent in its place,
 * everything after it discarded. [finished] says whether the host took it.
 */
@Composable
fun MessageEditSheet(
  host: HostStore,
  agentKey: String,
  message: RemoteMessage,
  onDismiss: () -> Unit,
  finished: (Boolean) -> Unit,
) {
  val theme = ArgusTheme.colors
  var draft by rememberSaveable(message.id) { mutableStateOf(message.editableText) }
  var working by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val focus = remember { FocusRequester() }
  val trimmed = draft.trim()
  val unchanged = trimmed == message.editableText.trim()
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
  FormSheet(
    "Edit Message", onDismiss,
    confirmLabel = if (working) "Restoring" else "Edit & Restore",
    confirmEnabled = trimmed.isNotEmpty() && !unchanged && !working,
    onConfirm = {
      working = true
      error = null
      scope.launch {
        try {
          host.rewind(agentKey, message, trimmed)
          finished(true)
          onDismiss()
        } catch (failure: Exception) {
          finished(false)
          error = HostStore.describe(failure)
          working = false
        }
      }
    },
  ) {
    Field("MESSAGE", caption = "Replaces this message. The conversation rewinds to it and everything after it is discarded.") {
      ThemedTextField(draft, { draft = it }, "Message", Modifier.focusRequester(focus), multiline = true, lines = 4..16)
    }
    error?.let { Text(it, color = theme.error, style = ArgusTheme.typography.footnote) }
  }
}

/**
 * Fork the chat up to a message into a new agent: in a new session branched at that point, or
 * beside this one. [finished] gets where it went (null when the host refused) and which way.
 */
@Composable
fun MessageForkSheet(
  host: HostStore,
  agentKey: String,
  message: RemoteMessage,
  onDismiss: () -> Unit,
  finished: (ForkedChat?, MessageForkTarget) -> Unit,
) {
  val theme = ArgusTheme.colors
  var target by rememberSaveable { mutableStateOf(MessageForkTarget.Session) }
  var summary by rememberSaveable { mutableStateOf("") }
  var branch by rememberSaveable { mutableStateOf("") }
  var working by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val canSubmit = !working && (target == MessageForkTarget.Agent || summary.isNotBlank())
  FormSheet(
    "Fork Chat", onDismiss,
    confirmLabel = if (working) "Forking" else "Fork",
    confirmEnabled = canSubmit,
    onConfirm = {
      working = true
      error = null
      val into = target
      scope.launch {
        try {
          val forked = host.fork(
            agentKey, message, into,
            description = if (into == MessageForkTarget.Session) summary else null,
            branch = if (into == MessageForkTarget.Session) branch else null,
          )
          onDismiss()
          finished(forked, into)
        } catch (failure: Exception) {
          finished(null, into)
          error = HostStore.describe(failure)
          working = false
        }
      }
    },
  ) {
    SegmentedControl(
      target, listOf(MessageForkTarget.Session to "New session", MessageForkTarget.Agent to "New agent here"),
    ) { target = it }
    if (target == MessageForkTarget.Session) {
      Field("DESCRIPTION", caption = "A fresh worktree branched from this point, with the chat up to this message.") {
        ThemedTextField(summary, { summary = it }, "What's this fork for?")
      }
      Field("BRANCH", caption = "Generated from the description when empty.") {
        ThemedTextField(branch, { branch = it }, "Branch", input = TextInput.Code)
      }
    } else {
      MutedText("A new agent in this session's worktree, with the chat up to this message.")
    }
    error?.let { Text(it, color = theme.error, style = ArgusTheme.typography.footnote) }
  }
}
