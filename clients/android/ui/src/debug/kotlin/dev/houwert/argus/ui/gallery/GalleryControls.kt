package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.AccentButton
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.components.ActionTile
import dev.houwert.argus.ui.components.ActionTiles
import dev.houwert.argus.ui.components.ArgusSwitch
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Chip
import dev.houwert.argus.ui.components.FlatIconButton
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.PickerSheet
import dev.houwert.argus.ui.components.PillAction
import dev.houwert.argus.ui.components.PillActionGroup
import dev.houwert.argus.ui.components.PillGroup
import dev.houwert.argus.ui.components.PillItem
import dev.houwert.argus.ui.components.QuietCheckbox
import dev.houwert.argus.ui.components.QuietField
import dev.houwert.argus.ui.components.QuietTab
import dev.houwert.argus.ui.components.SecondaryButton
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.BrandIcons
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.Tone

@Composable
internal fun ButtonsPage() {
  Story("Btn") {
    Btn("Start session", icon = Icon.plus) {}
    Btn("Pair a computer", tone = ButtonTone.Secondary, icon = Icon.qrCode) {}
    Btn("Delete session", tone = ButtonTone.Danger, icon = Icon.trash) {}
    Btn("Not now", tone = ButtonTone.Ghost) {}
    Btn("Sign in with GitHub", tone = ButtonTone.Secondary, icon = BrandIcons.github) {}
    Btn("Merging", busy = true) {}
    Btn("Start session", enabled = false) {}
    Btn("Retry", tone = ButtonTone.Secondary, enabled = false) {}
  }
  Story("Small and hugging, in a FlowRow") {
    FlowRow {
      Btn("Approve", small = true, icon = Icon.check) {}
      Btn("Deny", tone = ButtonTone.Danger, small = true) {}
      Btn("Mark as done", tone = ButtonTone.Secondary, small = true) {}
      Btn("Snooze", tone = ButtonTone.Ghost, small = true, icon = Icon.snooze) {}
    }
  }
  Story("Icon buttons") {
    HRow {
      IconBtn(Icon.refresh, "Refresh") {}
      IconBtn(Icon.share, "Share") {}
      IconBtn(Icon.trash, "Delete", tint = dev.houwert.argus.ui.theme.ArgusTheme.colors.error) {}
      IconBtn(Icon.ellipsis, "More", enabled = false) {}
      FlatIconButton(Icon.gear, "Settings") {}
      FlatIconButton(Icon.home, "Home", selected = true) {}
    }
  }
  Story("Quiet controls") {
    var tab by remember { mutableStateOf("Changes") }
    var amend by remember { mutableStateOf(true) }
    var signOff by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
      for (t in listOf("Changes", "History", "Stashes")) QuietTab(t, tab == t) { tab = t }
    }
    HRow {
      QuietCheckbox("Amend", amend, { amend = it })
      QuietCheckbox("Sign off", signOff, { signOff = it })
      QuietCheckbox("Disabled", false, {}, enabled = false)
    }
    HRow {
      AccentButton("Commit") {}
      AccentButton("Commit", enabled = false) {}
      SecondaryButton("Discard") {}
      AccentLink("View on GitHub") {}
    }
    QuietField(query, { query = it }, "Filter branches", Modifier.fillMaxWidth())
  }
  Story("Pills") {
    var selected by remember { mutableStateOf("dev") }
    PillGroup(framed = true) {
      PillItem(Icon.terminal, "Terminal", badge = 2) {}
      PillItem(Icon.play, "Dev", title = "Dev", selected = selected == "dev") { selected = "dev" }
      PillItem(Icon.simulator, "Device") {}
      PillItem(Icon.web, "Browser", enabled = false) {}
    }
    PillActionGroup(
      listOf("Fetch", "Pull", "Push", "Branch", "Stash", "Tag").map { PillAction(it, it, Icon.refresh) {} },
      Modifier.width(170.dp),
      framed = true,
    )
  }
  Story("Action tiles") {
    ActionTiles(
      listOf(
        ActionTile("Commit", Icon.check) {}, ActionTile("Push", Icon.push) {}, ActionTile("Branch", Icon.branch) {},
        ActionTile("Merge", Icon.merge, disabled = true) {},
      )
    )
  }
  Story("Segmented control") {
    var mode by remember { mutableStateOf("ask") }
    SegmentedControl(mode, listOf("ask" to "Ask", "edit" to "Accept edits", "plan" to "Plan"), onChange = { mode = it })
  }
  Story("Text fields") {
    var name by remember { mutableStateOf("") }
    var branch by remember { mutableStateOf("feat/android-design-system") }
    var notes by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("hunter2") }
    ThemedTextField(name, { name = it }, "Session name", input = TextInput.Name)
    ThemedTextField(branch, { branch = it }, "Branch", mono = true, input = TextInput.Code)
    ThemedTextField(notes, { notes = it }, "What should the agent do", multiline = true)
    ThemedTextField(token, { token = it }, "Token", secure = true)
  }
  Story("Chips and menu chips") {
    var runner by remember { mutableStateOf("") }
    var autonomy by remember { mutableStateOf("draft") }
    var picking by remember { mutableStateOf(false) }
    var picked by remember { mutableStateOf(setOf("opus")) }
    FlowRow(spacing = 6.dp, packed = true) {
      Chip("main", icon = Icon.branch, mono = true)
      Chip("3 files", tone = Tone.Accent)
      Chip("Failing", tone = Tone.Danger, icon = Icon.warning)
      Chip("", icon = Icon.filter, contentDescription = "Filter") {}
      MenuChip(
        "Runner", runner,
        listOf(
          PickerOption("", "Default", "Use the computer's default"), PickerOption("codex", "Codex"),
          PickerOption("gemini", "Gemini CLI", "Not installed on this computer", disabled = true),
        ),
        { runner = it }, icon = Icon.terminal,
      )
      MenuChip("Autonomy", autonomy, listOf(PickerOption("draft", "Draft"), PickerOption("pr", "Open a PR")), { autonomy = it }, showsTitle = true)
      Chip("Pick a model", icon = Icon.model) { picking = true }
    }
    if (picking) {
      PickerSheet(
        "Model",
        listOf(
          PickerOption("opus", "Opus", "Most capable"), PickerOption("sonnet", "Sonnet", "Fast and capable"),
          PickerOption("haiku", "Haiku", "Fastest"), PickerOption("legacy", "Legacy", "Retired", disabled = true),
        ),
        picked, { picked = setOf(it) }, { picking = false },
      )
    }
  }
  Story("Switch") {
    var on by remember { mutableStateOf(true) }
    HRow {
      ArgusSwitch(on, { on = it })
      ArgusSwitch(!on, { on = !it })
      ArgusSwitch(true, null, enabled = false)
    }
  }
  Box(Modifier.height(24.dp))
}
