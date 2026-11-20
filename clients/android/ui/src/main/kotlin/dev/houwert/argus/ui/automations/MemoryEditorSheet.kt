package dev.houwert.argus.ui.automations

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationMemory
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationMemoryType
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/** A blank memory, as "Add memory" opens one. */
fun newAutomationMemory() = RemoteAutomationMemory(name = "", description = "", type = RemoteAutomationMemoryType.project, body = "", updatedAt = 0.0)

/**
 * One automation memory: read it, or with control edit or delete it. `memory == null` adds a
 * new one. [save] gets the draft and the name it was opened as; both actions return success.
 */
@Composable
fun MemoryEditorSheet(
  memory: RemoteAutomationMemory?,
  hasControl: Boolean,
  error: String?,
  save: suspend (draft: RemoteAutomationMemory, previousName: String?) -> Boolean,
  delete: suspend (name: String) -> Boolean,
  onDismiss: () -> Unit,
) {
  var draft by remember(memory) { mutableStateOf(memory ?: newAutomationMemory()) }
  var editing by remember(memory) { mutableStateOf(memory == null) }
  var saving by remember { mutableStateOf(false) }
  var confirmingDelete by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  val canSave = listOf(draft.name, draft.description, draft.body).all { it.isNotBlank() } && !saving

  FormSheet(
    title = if (memory == null) "Add Memory" else draft.name,
    onDismiss = onDismiss,
    onCancel = {
      // Cancelling an edit returns to reading it, as the iPhone's sheet does.
      if (editing && memory != null) {
        draft = memory
        editing = false
      } else {
        onDismiss()
      }
    },
    dismissLabel = if (editing && memory != null) "Cancel" else "Close",
    confirmLabel = when {
      !hasControl -> null
      editing -> if (saving) "Saving" else "Save"
      else -> "Edit"
    },
    confirmEnabled = !editing || canSave,
    onConfirm = {
      if (!editing) {
        editing = true
      } else {
        saving = true
        scope.launch {
          val ok = save(draft, memory?.name)
          saving = false
          if (ok) onDismiss()
        }
      }
    },
  ) {
    if (error != null) Banner(error, tone = Tone.Danger)
    if (editing) {
      MemoryFields(draft) { draft = it }
    } else if (memory != null) {
      Card {
        Badge(memory.type.rawValue)
        MutedText(memory.description)
      }
      Card { ReportMarkdown(memory.body, baseSize = 14) }
      if (hasControl) Btn("Delete memory", tone = ButtonTone.Danger, small = true) { confirmingDelete = true }
    }
  }

  if (confirmingDelete && memory != null) {
    ConfirmDialog(
      title = "Delete this memory?", message = "Future runs won't see it.", confirmLabel = "Delete",
      onConfirm = {
        confirmingDelete = false
        scope.launch { if (delete(memory.name)) onDismiss() }
      },
      onDismiss = { confirmingDelete = false },
    )
  }
}

@Composable
fun MemoryFields(draft: RemoteAutomationMemory, onChange: (RemoteAutomationMemory) -> Unit) {
  Field("Name", caption = "Lowercase kebab-case; also the file name.") {
    ThemedTextField(draft.name, { onChange(draft.copy(name = it)) }, "session-merge-flow", mono = true, input = TextInput.Code)
  }
  Field("Type") {
    SegmentedControl(
      draft.type,
      RemoteAutomationMemoryType.entries.map { it to it.rawValue.replaceFirstChar(Char::uppercase) },
    ) { onChange(draft.copy(type = it)) }
  }
  Field("Description", caption = "One line, shown in the index every run reads.") {
    ThemedTextField(draft.description, { onChange(draft.copy(description = it)) }, "Where session merges are implemented")
  }
  Field("Memory") {
    ThemedTextField(draft.body, { onChange(draft.copy(body = it)) }, "Markdown", multiline = true, lines = 8..24, mono = true)
  }
}

/** A destructive confirmation: Cancel, and the action in the error colour. */
@Composable
fun ConfirmDialog(title: String, message: String, confirmLabel: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
  val theme = ArgusTheme.colors
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text(title) },
    text = { Text(message) },
    confirmButton = { TextButton(onConfirm) { Text(confirmLabel, color = theme.error) } },
    dismissButton = { TextButton(onDismiss) { Text("Cancel") } },
    containerColor = theme.surface,
    titleContentColor = theme.text,
    textContentColor = theme.textSecondary,
  )
}
