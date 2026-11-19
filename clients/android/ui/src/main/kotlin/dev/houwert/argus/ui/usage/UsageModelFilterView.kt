package dev.houwert.argus.ui.usage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.loadRunners
import dev.houwert.argus.core.usage.UsageModelFilterList
import dev.houwert.argus.core.usage.adding
import dev.houwert.argus.core.usage.changing
import dev.houwert.argus.core.usage.get
import dev.houwert.argus.core.usage.loadUsageModelFilter
import dev.houwert.argus.core.usage.saveUsageModelFilter
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.UsageModelFilter
import dev.houwert.argus.kit.protocol.generated.UsageModelRule
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** A runner a model rule can be scoped to. */
data class UsageModelRunnerOption(val id: String, val name: String)

/** "Counted models": the models Usage counts only and the ones it leaves out. Every change saves at once. */
@Composable
fun HostUsageModelFilterView(host: HostStore, canEdit: Boolean, modifier: Modifier = Modifier) {
  val filter by host.usageModelFilter.collectAsState()
  val failure by host.usageModelFilterError.collectAsState()
  val runners by host.runners.collectAsState()
  val connection by host.connection.collectAsState()
  val scope = rememberCoroutineScope()
  var error by remember { mutableStateOf<String?>(null) }
  suspend fun load() {
    host.loadRunners()
    host.loadUsageModelFilter()
  }
  LaunchedEffect(connection == Transport.State.Ready) { if (connection == Transport.State.Ready) load() }
  val current = filter
  when {
    current != null ->
      UsageModelFilterEditor(current, runners.map { UsageModelRunnerOption(it.id, it.displayName) }, canEdit, error, modifier) { next ->
        scope.launch { error = host.saveUsageModelFilter(next) }
      }
    failure != null ->
      EmptyState(Icon.warning, "Couldn't load counted models", modifier, body = failure, selectable = true) {
        Btn("Retry", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.refresh) { scope.launch { load() } }
      }
    else -> Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Loading("Loading counted models") }
  }
}

/** Both lists as cards of rules, each with an add row when this device may edit. */
@Composable
fun UsageModelFilterEditor(
  filter: UsageModelFilter,
  runners: List<UsageModelRunnerOption>,
  canEdit: Boolean,
  error: String?,
  modifier: Modifier = Modifier,
  onSave: (UsageModelFilter) -> Unit,
) {
  val theme = ArgusTheme.colors
  Screen(modifier) {
    if (error != null) Banner(error, tone = Tone.Danger)
    if (!canEdit) Text("Viewing only: this device can't change which models count.", color = theme.textMuted, style = argusFont(13))
    for (list in UsageModelFilterList.entries) {
      val rules = filter[list]
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        SectionHeader(list.title, count = rules.size.takeIf { it > 0 })
        Card {
          rules.forEachIndexed { index, rule ->
            UsageModelRuleRow(rule, runners, canEdit) { onSave(filter.changing(index, list, it)) }
            if (canEdit || index < rules.lastIndex) HorizontalDivider(color = theme.borderSubtle)
          }
          if (canEdit) {
            UsageModelRuleDraft(runners, key = list.name) { rule -> filter.adding(rule, list)?.let(onSave) }
          } else if (rules.isEmpty()) {
            Text(
              if (list == UsageModelFilterList.Include) "Every model counts." else "No model is left out.",
              color = theme.textMuted, style = argusFont(13),
            )
          }
        }
        Text(list.footer, color = theme.textMuted, style = argusFont(12))
      }
    }
  }
}

/** The runner a rule is scoped to: Any, or one of the host's runners, as a menu chip. */
@Composable
private fun RunnerPicker(runner: String?, runners: List<UsageModelRunnerOption>, enabled: Boolean, onPick: (String?) -> Unit) {
  // A rule for a runner since removed keeps its id rather than reading as Any.
  val options = if (runner != null && runners.none { it.id == runner }) runners + UsageModelRunnerOption(runner, runner) else runners
  val picks = listOf(PickerOption<String?>(null, "Any runner")) + options.map { PickerOption<String?>(it.id, it.name) }
  if (enabled) MenuChip("Runner", runner, picks, onPick, icon = Icon.terminal)
  else dev.houwert.argus.ui.components.Chip(picks.firstOrNull { it.value == runner }?.label ?: runner.orEmpty(), icon = Icon.terminal)
}

/** One saved rule: its model id, the runner it applies to, and Remove. */
@Composable
fun UsageModelRuleRow(rule: UsageModelRule, runners: List<UsageModelRunnerOption>, canEdit: Boolean, change: (UsageModelRule?) -> Unit) {
  val theme = ArgusTheme.colors
  Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
    Icon(Icon.usage, null, Modifier.size(16.dp), tint = theme.textMuted)
    Text(rule.model, Modifier.weight(1f), color = theme.text, style = argusFont(14, mono = true), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
    RunnerPicker(rule.runner, runners, canEdit) { change(UsageModelRule(it, rule.model)) }
    if (canEdit) IconBtn(Icon.close, "Remove ${rule.model}", size = 16.dp, tint = theme.textMuted) { change(null) }
  }
}

/** The add row under a list: a model id, its runner, and Add, stacked since the three don't fit one phone line. */
@Composable
fun UsageModelRuleDraft(runners: List<UsageModelRunnerOption>, key: String, add: (UsageModelRule) -> Unit) {
  var model by rememberSaveable(key) { mutableStateOf("") }
  var runner by rememberSaveable(key) { mutableStateOf<String?>(null) }
  val trimmed = model.trim()
  fun commit() {
    if (trimmed.isEmpty()) return
    add(UsageModelRule(runner, trimmed))
    model = ""
  }
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    ThemedTextField(model, { model = it }, "Model id, e.g. claude-haiku-4-5", mono = true, input = TextInput.Code, onSubmit = ::commit)
    Row(verticalAlignment = Alignment.CenterVertically) {
      RunnerPicker(runner, runners, enabled = true) { runner = it }
      Box(Modifier.weight(1f))
      Btn("Add", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.plus, enabled = trimmed.isNotEmpty(), onClick = ::commit)
    }
  }
}
