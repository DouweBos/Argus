package dev.houwert.argus.app.screens.automations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.core.automations.hasValidTrigger
import dev.houwert.argus.core.automations.newAutomationDetail
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.ui.automations.AutomationFields
import dev.houwert.argus.ui.automations.AutomationFieldsContext
import dev.houwert.argus.ui.automations.ConfirmDialog
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * Author one automation: everything the desktop editor holds, the playbook included. Saving
 * is explicit; nothing here autosaves. A null [id] creates one.
 */
@Composable
fun AutomationEditorScreen(id: String?, label: String) {
  val app = LocalAppStore.current
  val store = app.automations
  val router = LocalRouter.current
  val access = rememberHostAccess()
  val scope = rememberCoroutineScope()
  val error by store.error.collectAsState()
  val sources by store.sources.collectAsState()
  val runners by store.runners.collectAsState()
  val projects by app.host.projects.collectAsState()
  val hostAccounts by app.host.claudeAccounts.collectAsState()
  val activeAccountId by app.host.activeClaudeAccountId.collectAsState()
  var fetched by remember { mutableStateOf<Pair<List<RemoteClaudeAccount>, String?>?>(null) }
  var draft by remember { mutableStateOf(newAutomationDetail()) }
  var loaded by remember { mutableStateOf(false) }
  var saving by remember { mutableStateOf(false) }
  var confirmingDelete by remember { mutableStateOf(false) }
  val isNew = id == null
  val canSave = draft.name.isNotBlank() && draft.playbook.isNotBlank() && draft.hasValidTrigger && !saving

  LaunchedEffect(id) {
    store.loadSources()
    store.loadRunners()
    if (id != null) store.loadDetail(id)?.let { draft = it }
    loaded = true
    // The account pin needs the list; the host only pushes it once something asked.
    if (app.host.claudeAccounts.value == null) fetched = claudeAccounts(app.host)
  }

  AutomationsScaffold(
    if (isNew) "New Automation" else "Edit",
    actions = {
      BarTextAction(if (saving) "Saving" else "Save", enabled = canSave) {
        saving = true
        scope.launch {
          val saved = store.save(id, draft)
          saving = false
          if (saved != null) router.pop()
        }
      }
    },
  ) {
    Screen {
      error?.let { Banner(it, tone = Tone.Danger, onDismiss = store::clearError) }
      if (!loaded) {
        Loading("Reading the automation")
      } else {
        AutomationFields(
          draft, { draft = it },
          AutomationFieldsContext(
            sources = sources, runners = runners, projects = projects,
            accounts = hostAccounts ?: fetched?.first.orEmpty(),
            activeAccountId = if (hostAccounts != null) activeAccountId else fetched?.second,
            hasControl = access.hasControl,
            rotateWebhook = id?.let { { store.rotateWebhook(it) } },
          ),
          reviseError = error,
          revise = { instruction -> store.revisePlaybook(draft.playbook, instruction, draft.name.ifBlank { null }) },
        )
        if (!isNew) Btn("Delete automation", tone = ButtonTone.Danger, small = true) { confirmingDelete = true }
      }
    }
  }

  if (confirmingDelete && id != null) {
    ConfirmDialog(
      "Delete this automation?", "Its past runs and reports stay on the computer.", "Delete",
      onConfirm = {
        confirmingDelete = false
        scope.launch {
          // The automation this editor was opened from is gone, and so is the screen underneath it.
          if (store.delete(id)) router.popToRoot()
        }
      },
      onDismiss = { confirmingDelete = false },
    )
  }
}

/** The computer's Claude accounts, read once for the pin menu; null when it couldn't say. */
private suspend fun claudeAccounts(host: HostStore): Pair<List<RemoteClaudeAccount>, String?>? {
  val backend = host.backend ?: return null
  return runCatching { backend.request(Methods.ClaudeAccountsList, MethodsTypes.ClaudeAccountsListParams()) }
    .getOrNull()?.let { it.accounts to it.activeId }
}
