package dev.houwert.argus.app.screens.project

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.createSession
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch

/** A new session stacked on [parent]: it branches from the parent's branch, and its PR targets it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StackedSessionSheet(host: HostStore, parent: RemoteSession, onCreated: (RemoteSession) -> Unit, onDismiss: () -> Unit) {
  var description by remember { mutableStateOf("") }
  var prompt by remember { mutableStateOf("") }
  var creating by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = ArgusTheme.colors.bg) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      Text("New session on top", color = ArgusTheme.colors.text, style = ArgusTheme.typography.headline)
      Field("What should it do?", caption = "Stacked on ${parent.displayName ?: parent.branch}: branches from ${parent.branch}, and its pull request targets that branch.") {
        ThemedTextField(description, { description = it }, "What should it do?", multiline = true, lines = 2..6)
      }
      Field("First prompt", caption = "Optional. An agent starts with this once the worktree is ready.") {
        ThemedTextField(prompt, { prompt = it }, "First prompt", multiline = true, lines = 3..10)
      }
      Row(Modifier.fillMaxWidth().padding(bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, androidx.compose.ui.Alignment.End)) {
        Btn("Cancel", tone = ButtonTone.Secondary, hugs = true, onClick = onDismiss)
        Btn("Create", hugs = true, busy = creating, enabled = !creating && description.isNotBlank()) {
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
        }
      }
    }
  }
}
