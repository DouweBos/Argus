package dev.houwert.argus.app.screens.teammates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.app.screens.automations.BarTextAction
import dev.houwert.argus.app.screens.automations.rememberHostAccess
import dev.houwert.argus.core.automations.Autonomy
import dev.houwert.argus.core.stores.TeammatesStore
import dev.houwert.argus.core.stores.reviseSoul
import dev.houwert.argus.core.teammates.TeammateText
import dev.houwert.argus.core.teammates.symbol
import dev.houwert.argus.core.teammates.teammateAvatar
import dev.houwert.argus.kit.protocol.generated.AutonomyLevel
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.TeammateColor
import dev.houwert.argus.kit.protocol.generated.TeammateSymbol
import dev.houwert.argus.kit.protocol.generated.UpdateTeammateInput
import dev.houwert.argus.kit.protocol.generated.UpdateTeammateInputScope
import dev.houwert.argus.ui.automations.AutomationFieldsText
import dev.houwert.argus.ui.automations.ReportMarkdown
import dev.houwert.argus.ui.automations.ReviseTextCopy
import dev.houwert.argus.ui.automations.ReviseTextSheet
import dev.houwert.argus.ui.automations.SwitchRow
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.ToggleList
import dev.houwert.argus.ui.teammates.TeammateAvatar
import dev.houwert.argus.ui.teammates.TeammateColorPicker
import dev.houwert.argus.ui.teammates.TeammateSymbolPicker
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/** What the profile edits; saved in one go. */
private data class ProfileDraft(
  val name: String,
  val handle: String,
  val tagline: String,
  val color: TeammateColor,
  val symbol: TeammateSymbol?,
  val enabled: Boolean,
  val autonomy: Autonomy?,
  val repoRoots: List<String>,
  val soul: String,
) {
  companion object {
    fun of(detail: MethodsTypes.TeammatesGetResult): ProfileDraft {
      val t = detail.teammate
      return ProfileDraft(
        t.name, t.handle, t.tagline, t.color, t.avatar.symbol, t.enabled, Autonomy.fromRaw(t.autonomy?.rawValue),
        t.scope.repoRoots, detail.soul,
      )
    }
  }
}

/**
 * Who a teammate is: identity, colour and symbol, its soul, autonomy and scope. Saving is
 * explicit; deleting asks whether its duties stay behind. Without control it only reads.
 */
@Composable
fun TeammateProfileScreen(id: String, label: String) {
  val store = LocalAppStore.current.teammates
  val router = LocalRouter.current
  val access = rememberHostAccess()
  val scope = rememberCoroutineScope()
  val detailById by store.detailById.collectAsState()
  val error by store.error.collectAsState()
  val detail = detailById[id]
  var saved by remember { mutableStateOf<ProfileDraft?>(null) }
  var draft by remember { mutableStateOf<ProfileDraft?>(null) }
  var saving by remember { mutableStateOf(false) }
  var confirmingDelete by remember { mutableStateOf(false) }

  LaunchedEffect(id) {
    store.loadDetail(id)?.let { ProfileDraft.of(it) }?.let {
      saved = it
      draft = it
    }
  }

  val current = draft
  val canSave = current != null && current != saved && current.name.isNotBlank() && current.handle.isNotBlank() && !saving

  AppScreen(
    "Profile",
    actions = {
      if (access.hasControl) {
        BarTextAction(if (saving) "Saving" else "Save", enabled = canSave && access.ready) {
          val edit = current ?: return@BarTextAction
          saving = true
          scope.launch {
            if (save(store, id, saved, edit)) saved = edit
            saving = false
          }
        }
      }
    },
  ) {
    Screen {
      error?.let { Banner(it, tone = Tone.Danger, onDismiss = store::clearError) }
      when {
        current == null || detail == null -> Loading("Reading ${label.ifBlank { "the teammate" }}")
        !access.hasControl -> ReadOnlyProfile(current)
        else -> {
          ProfileFields(current, reviseError = error, revise = { store.reviseSoul(current.name, current.soul, it) }) { draft = it }
          Btn("Delete teammate", tone = ButtonTone.Danger, small = true) { confirmingDelete = true }
        }
      }
    }
  }

  if (confirmingDelete) {
    DeleteDialog(
      name = current?.name ?: label,
      dutyCount = detail?.duties?.size ?: 0,
      onDelete = { keepDuties ->
        confirmingDelete = false
        scope.launch {
          // The profile and the conversation beneath it are gone with it.
          if (store.delete(id, keepDuties)) router.popToRoot()
        }
      },
      onDismiss = { confirmingDelete = false },
    )
  }
}

/** Identity first, then the soul, then what it may touch. */
@Composable
private fun ProfileFields(
  draft: ProfileDraft,
  reviseError: String?,
  revise: suspend (instruction: String) -> String?,
  onChange: (ProfileDraft) -> Unit,
) {
  var revising by rememberSaveable { mutableStateOf(false) }
  Field("Identity") {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
      TeammateAvatar(draft.name, draft.color, teammateAvatar(draft.symbol), size = 48.dp)
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ThemedTextField(draft.name, { onChange(draft.copy(name = it)) }, "Name", input = TextInput.Name)
        ThemedTextField(draft.handle, { onChange(draft.copy(handle = it)) }, "handle", mono = true, input = TextInput.Code)
      }
    }
    ThemedTextField(draft.tagline, { onChange(draft.copy(tagline = it)) }, "What it does, in a line")
    SwitchRow("Enabled", draft.enabled) { onChange(draft.copy(enabled = it)) }
  }
  Field("Colour") { TeammateColorPicker(draft.color, { onChange(draft.copy(color = it)) }) }
  Field("Symbol") { TeammateSymbolPicker(draft.name, draft.color, draft.symbol, { onChange(draft.copy(symbol = it)) }) }
  Field("Soul", caption = "Its persona and standing instructions, in Markdown. Every duty and conversation reads it.") {
    ThemedTextField(draft.soul, { onChange(draft.copy(soul = it)) }, "Markdown", multiline = true, lines = 8..30, mono = true)
    Btn("Rewrite with Claude", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.draft, enabled = draft.soul.isNotBlank()) {
      revising = true
    }
  }
  if (revising) {
    // The rewrite lands in the draft; nothing is saved until Save.
    ReviseTextSheet(ReviseTextCopy.soul, reviseError, revise, onApply = { onChange(draft.copy(soul = it)) }, onDismiss = { revising = false })
  }
  Field(
    "Autonomy",
    caption = draft.autonomy?.caption ?: "A ceiling over every duty and the conversation; the computer's own cap still applies.",
  ) {
    MenuChip(
      "Autonomy", draft.autonomy?.rawValue ?: "",
      listOf(PickerOption("", "Inherit", "Use the computer's default")) +
        Autonomy.allRungs.map { PickerOption(it.rawValue, it.label, it.caption) },
      { onChange(draft.copy(autonomy = Autonomy.fromRaw(it))) }, showsTitle = true,
    )
  }
  ScopeField(draft, onChange)
}

@Composable
private fun ScopeField(draft: ProfileDraft, onChange: (ProfileDraft) -> Unit) {
  val projects by LocalAppStore.current.host.projects.collectAsState()
  Field("Scope", caption = "The repos it may read and work in.") {
    ToggleList(
      AutomationFieldsText.projectOptions(projects, draft.repoRoots), draft.repoRoots, { onChange(draft.copy(repoRoots = it)) },
      title = "Projects", emptyMessage = "This computer has no projects registered.",
    )
  }
}

@Composable
private fun ReadOnlyProfile(draft: ProfileDraft) {
  val theme = ArgusTheme.colors
  Card {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
      TeammateAvatar(draft.name, draft.color, teammateAvatar(draft.symbol), size = 48.dp)
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(draft.name, color = theme.text, style = ArgusTheme.typography.headline)
        MutedText(TeammateText.handle(draft.handle))
      }
      Badge(if (draft.enabled) "Enabled" else "Paused", tone = if (draft.enabled) Tone.Success else Tone.Muted)
    }
    if (draft.tagline.isNotBlank()) MutedText(draft.tagline)
    MutedText("Autonomy: ${draft.autonomy?.label ?: "Inherit"}")
    if (draft.repoRoots.isNotEmpty()) MutedText("Projects: ${draft.repoRoots.joinToString(", ") { it.substringAfterLast('/') }}", maxLines = 3)
  }
  Field("Soul") { ReportMarkdown(draft.soul.ifBlank { "No soul written yet." }, baseSize = 14) }
  MutedText("This device can read a teammate's profile but not change it.")
}

/** Its duties can outlive it as standalone, paused automations, or go with it. */
@Composable
private fun DeleteDialog(name: String, dutyCount: Int, onDelete: (keepDuties: Boolean) -> Unit, onDismiss: () -> Unit) {
  val theme = ArgusTheme.colors
  val duties = if (dutyCount == 1) "its duty" else "its $dutyCount duties"
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("Delete $name?") },
    text = {
      Text(
        if (dutyCount == 0) "Its conversations and memory go with it."
        else "Its conversations and memory go with it. Keep $duties as paused automations, or delete them too?",
      )
    },
    confirmButton = {
      Row {
        if (dutyCount > 0) TextButton({ onDelete(true) }) { Text("Keep duties") }
        TextButton({ onDelete(false) }) { Text(if (dutyCount > 0) "Delete all" else "Delete", color = theme.error) }
      }
    },
    dismissButton = { TextButton(onDismiss) { Text("Cancel") } },
    containerColor = theme.surface,
    titleContentColor = theme.text,
    textContentColor = theme.textSecondary,
  )
}

/** The identity patch, then the soul when it changed. */
private suspend fun save(
  store: TeammatesStore,
  id: String,
  saved: ProfileDraft?,
  draft: ProfileDraft,
): Boolean {
  val patch = UpdateTeammateInput(
    name = draft.name.trim(), handle = draft.handle.trim(), tagline = draft.tagline.trim(), color = draft.color,
    avatar = teammateAvatar(draft.symbol), enabled = draft.enabled,
    scope = UpdateTeammateInputScope(draft.repoRoots), autonomy = draft.autonomy?.let { AutonomyLevel(it.rawValue) },
  )
  store.update(id, patch, clearAutonomy = draft.autonomy == null) ?: return false
  return draft.soul == saved?.soul || store.saveSoul(id, draft.soul)
}
