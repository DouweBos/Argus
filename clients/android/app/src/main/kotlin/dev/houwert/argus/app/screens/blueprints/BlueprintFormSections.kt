package dev.houwert.argus.app.screens.blueprints

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.core.blueprints.BlueprintForm
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.ui.blueprints.ReviseBlueprintSheet
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsItem
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.components.SettingsToggleRow
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** Every field of a blueprint as groups, for the editor. The phone has no folder picker, so folders are typed paths on the computer. */
@Composable
fun BlueprintFormSections(form: BlueprintForm, onChange: (BlueprintForm) -> Unit, runners: List<RemoteRunner>, enabled: Boolean) {
  Basics(form, onChange, enabled)
  References(form, onChange, enabled)
  Scaffold(form, onChange, enabled)
  Repository(form, onChange, enabled)
  Agent(form, onChange, runners, enabled)
  Instructions(form, onChange, enabled)
}

@Composable
private fun Basics(form: BlueprintForm, onChange: (BlueprintForm) -> Unit, enabled: Boolean) {
  SettingsGroup(footer = "New projects are created inside this folder on the computer.") {
    SpacedItem(8) {
      ThemedTextField(form.name, { onChange(form.copy(name = it)) }, "Name", input = TextInput.Name, enabled = enabled)
      ThemedTextField(form.summary, { onChange(form.copy(summary = it)) }, "What it makes", multiline = true, lines = 1..3, enabled = enabled)
    }
    SettingsRow("Folder", stacked = true) {
      ThemedTextField(form.parentDir, { onChange(form.copy(parentDir = it)) }, "~/Work", mono = true, input = TextInput.Code, enabled = enabled)
    }
  }
}

@Composable
private fun References(form: BlueprintForm, onChange: (BlueprintForm) -> Unit, enabled: Boolean) {
  val theme = ArgusTheme.colors
  val projects by LocalAppStore.current.host.projects.collectAsState()
  val unreferenced = projects.filter { project -> form.references.none { it.path == project.repoRoot } }
  SettingsGroup(title = "Reference projects", footer = "The agent reads these first and copies their layout, tooling and setup.") {
    form.references.forEach { reference ->
      Row(
        Modifier.fillMaxWidth().padding(start = 14.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
      ) {
        Icon(ArgusIcon.folder, null, Modifier.padding(top = 2.dp).size(18.dp), tint = theme.textSecondary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
          Text(reference.name, color = theme.text, style = argusFont(15), maxLines = 1, overflow = TextOverflow.Ellipsis)
          ThemedTextField(
            reference.note,
            { note -> onChange(form.copy(references = form.references.map { if (it.path == reference.path) it.copy(note = note) else it })) },
            "What to take from it", multiline = true, lines = 1..3, enabled = enabled,
          )
        }
        if (enabled) IconBtn(ArgusIcon.close, "Remove ${reference.name}", size = 16.dp) { onChange(form.removingReference(reference.path)) }
      }
    }
    SettingsItem {
      var open by remember { mutableStateOf(false) }
      Box {
        Btn("Add project", tone = ButtonTone.Ghost, small = true, hugs = true, icon = ArgusIcon.plus, enabled = enabled && unreferenced.isNotEmpty()) {
          open = true
        }
        DropdownMenu(open, { open = false }, containerColor = theme.surface) {
          unreferenced.forEach { project ->
            DropdownMenuItem(
              text = { Text(project.name) },
              onClick = {
                open = false
                onChange(form.addingReference(project.repoRoot))
              },
            )
          }
        }
      }
    }
  }
}

@Composable
private fun Scaffold(form: BlueprintForm, onChange: (BlueprintForm) -> Unit, enabled: Boolean) {
  SettingsGroup(title = "Scaffold") {
    SpacedItem(8) {
      SegmentedControl(form.scaffold, BlueprintForm.ScaffoldKind.entries.map { it to it.label }) {
        if (enabled) onChange(form.copy(scaffold = it))
      }
      if (form.scaffold == BlueprintForm.ScaffoldKind.GithubTemplate) {
        ThemedTextField(form.templateRepo, { onChange(form.copy(templateRepo = it)) }, "owner/name", mono = true, input = TextInput.Code, enabled = enabled)
      }
    }
  }
}

@Composable
private fun Repository(form: BlueprintForm, onChange: (BlueprintForm) -> Unit, enabled: Boolean) {
  SettingsGroup(title = "Repository", footer = "Project settings are the setup steps, run commands and other checked-in Argus settings.") {
    SettingsToggleRow("Create a GitHub repository", form.githubEnabled, { onChange(form.copy(githubEnabled = it)) }, enabled = enabled)
    if (form.githubEnabled) {
      SettingsRow("Owner", stacked = true) {
        ThemedTextField(form.owner, { onChange(form.copy(owner = it)) }, "Your account", input = TextInput.Code, enabled = enabled)
      }
      SettingsRow("Visibility") {
        Choice("Visibility", form.visibility, BlueprintForm.Visibility.entries.map { PickerOption(it, it.label) }, enabled) {
          onChange(form.copy(visibility = it))
        }
      }
    }
    SettingsRow("Copy project settings") {
      Choice(
        "Copy project settings", form.copySettingsFrom,
        listOf(PickerOption<String?>(null, "None")) + form.references.map { PickerOption<String?>(it.path, it.name) }, enabled,
      ) { onChange(form.copy(copySettingsFrom = it)) }
    }
  }
}

@Composable
private fun Agent(form: BlueprintForm, onChange: (BlueprintForm) -> Unit, runners: List<RemoteRunner>, enabled: Boolean) {
  val runner = form.runner?.let { id -> runners.firstOrNull { it.id == id } }
  SettingsGroup(title = "First agent") {
    if (runners.isNotEmpty()) {
      SettingsRow("Runner") {
        Choice("Runner", form.runner, listOf(PickerOption<String?>(null, "Default")) + runners.map { PickerOption<String?>(it.id, it.displayName) }, enabled) {
          // Model ids don't carry across runners, so a switch drops the model.
          if (it != form.runner) onChange(form.copy(runner = it, model = null))
        }
      }
    }
    val models = runner?.models.orEmpty()
    if (models.isNotEmpty()) {
      SettingsRow("Model") {
        Choice("Model", form.model, listOf(PickerOption<String?>(null, "Default")) + models.map { PickerOption<String?>(it.value, it.displayName) }, enabled) {
          onChange(form.copy(model = it))
        }
      }
    } else {
      SettingsRow("Model", stacked = true) {
        ThemedTextField(form.model ?: "", { onChange(form.copy(model = it.ifEmpty { null })) }, "Default", mono = true, input = TextInput.Code, enabled = enabled)
      }
    }
  }
}

@Composable
private fun Instructions(form: BlueprintForm, onChange: (BlueprintForm) -> Unit, enabled: Boolean) {
  var revising by rememberSaveable { mutableStateOf(false) }
  SettingsGroup(
    title = "Instructions",
    footer = "Markdown. {{name}}, {{description}}, {{repo}} and {{path}} are filled in for each project.",
  ) {
    SpacedItem(8) {
      ThemedTextField(
        form.instructions, { onChange(form.copy(instructions = it)) }, "What the first agent should do", multiline = true, lines = 6..24,
        mono = true, enabled = enabled,
      )
      if (enabled) {
        Btn("Revise with Claude", tone = ButtonTone.Secondary, small = true, hugs = true, icon = ArgusIcon.draft, enabled = form.instructions.isNotBlank()) {
          revising = true
        }
      }
    }
  }
  if (revising) {
    ReviseBlueprintSheet(LocalAppStore.current.blueprints, form, onApply = { onChange(form.copy(instructions = it)) }, onDismiss = { revising = false })
  }
}

@Composable
private fun <T> Choice(title: String, value: T, options: List<PickerOption<T>>, enabled: Boolean, onPick: (T) -> Unit) {
  MenuChip(title, value, options.map { it.copy(disabled = !enabled) }, { if (it != value) onPick(it) })
}

/** [SettingsItem] with its children spaced, for a few fields stacked in one cell. */
@Composable
private fun SpacedItem(spacing: Int, content: @Composable () -> Unit) {
  SettingsItem { Column(verticalArrangement = Arrangement.spacedBy(spacing.dp)) { content() } }
}
