package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.usage.UsageLimitFormat
import dev.houwert.argus.core.usage.UsageMetric
import dev.houwert.argus.core.usage.UsageModelKey
import dev.houwert.argus.core.usage.UsagePriceDraft
import dev.houwert.argus.core.usage.UsageTab
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.TitleBar
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.usage.AgentUsageLimits
import dev.houwert.argus.ui.usage.LocalUsageNavigation
import dev.houwert.argus.ui.usage.UsageLimitsStrip
import dev.houwert.argus.ui.usage.UsageLimitsView
import dev.houwert.argus.ui.usage.UsageModelDetailView
import dev.houwert.argus.ui.usage.UsageModelFilterEditor
import dev.houwert.argus.ui.usage.UsageNavigation
import dev.houwert.argus.ui.usage.UsagePriceEditor
import dev.houwert.argus.ui.usage.UsageSummaryView
import dev.houwert.argus.ui.usage.UsageTabs

/** The Usage screens, one at a time at full size, against [UsageFixtures]. */
internal enum class UsageStory(val title: String) {
  Limits("Limits"),
  Pooled("Limits, pooled"),
  Loading("Limits, loading"),
  Failed("Limits, failed"),
  Cost("Cost"),
  Tokens("Tokens"),
  Model("Model detail"),
  Unpriced("Model, unpriced"),
  Prices("Model prices"),
  PricesViewOnly("Model prices, view only"),
  Models("Counted models"),
  Strip("Strip and agent limits"),
}

@Composable
internal fun UsagePage(initial: UsageStory = UsageStory.Limits) {
  var story by rememberSaveable { mutableStateOf(initial) }
  Column(Modifier.fillMaxSize()) {
    Box(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
      MenuChip("Story", story, UsageStory.entries.map { PickerOption(it, it.title) }, { story = it }, showsTitle = true)
    }
    // Rows open nothing in the gallery, but the price action and chevrons show.
    val navigation = remember { UsageNavigation({ _, _, _ -> }, {}, {}) }
    CompositionLocalProvider(LocalUsageNavigation provides navigation) {
      Box(Modifier.weight(1f)) { Story(story) }
    }
  }
}

@Composable
private fun Story(story: UsageStory) {
  when (story) {
    UsageStory.Limits -> Tabbed(UsageTab.Limits) { UsageLimitsView(UsageFixtures.limits, null, false) {} }
    UsageStory.Pooled -> Tabbed(UsageTab.Limits) { UsageLimitsView(UsageFixtures.pooledLimits, null, false) {} }
    UsageStory.Loading -> Tabbed(UsageTab.Limits) { UsageLimitsView(null, null, true) {} }
    UsageStory.Failed -> Tabbed(UsageTab.Limits) { UsageLimitsView(null, "The computer didn't answer in time.", false) {} }
    UsageStory.Cost, UsageStory.Tokens -> {
      val tab = if (story == UsageStory.Cost) UsageTab.Cost else UsageTab.Tokens
      val summary = remember { UsageFixtures.summary }
      Tabbed(tab) { UsageSummaryView(tab.metric!!, summary.range, {}, summary, null, false) {} }
    }
    UsageStory.Model, UsageStory.Unpriced -> {
      val summary = remember { UsageFixtures.summary }
      val key = if (story == UsageStory.Model) UsageModelKey("claude-code", "claude-opus-5-5") else UsageModelKey("opencode", "qwen3-coder-30b")
      Column {
        TitleBar("Model usage", onBack = {})
        UsageModelDetailView(UsageMetric.Cost, key, summary, null, false) {}
      }
    }
    UsageStory.Prices, UsageStory.PricesViewOnly -> {
      var draft by remember { mutableStateOf(UsagePriceDraft(UsageFixtures.prices)) }
      Column {
        TitleBar("Model prices", onBack = {})
        UsagePriceEditor(draft, { draft = it }, story == UsageStory.Prices, null, false, onCancel = {}, onSave = {})
      }
    }
    UsageStory.Models -> {
      var filter by remember { mutableStateOf(UsageFixtures.filter) }
      Column {
        TitleBar("Counted models", onBack = {})
        UsageModelFilterEditor(filter, UsageFixtures.runnerOptions, canEdit = true, error = null) { filter = it }
      }
    }
    UsageStory.Strip -> Screen {
      dev.houwert.argus.ui.components.Card {
        SectionHeader("Usage strip")
        UsageLimitsStrip(UsageFixtures.limits)
      }
      dev.houwert.argus.ui.components.Card {
        SectionHeader("Agent on Codex")
        AgentUsageLimits(UsageLimitFormat.groups(UsageFixtures.limits, "codex"))
      }
      dev.houwert.argus.ui.components.Card {
        SectionHeader("Agent on Claude Code, three accounts")
        AgentUsageLimits(UsageLimitFormat.groups(UsageFixtures.pooledLimits, "claude-code"))
      }
    }
  }
}

/** The phone's Usage root: its title bar with Cost and Tokens' actions, then the tabs. */
@Composable
private fun Tabbed(tab: UsageTab, body: @Composable () -> Unit) {
  var current by remember(tab) { mutableStateOf(tab) }
  Column(verticalArrangement = Arrangement.Top) {
    TitleBar("Usage") {
      if (current != UsageTab.Limits) {
        IconBtn(Icon.filter, "Counted models") {}
        IconBtn(Icon.price, "Model prices") {}
      }
    }
    UsageTabs(current, { current = it }) { body() }
  }
}
