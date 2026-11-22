package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.Breadcrumb
import dev.houwert.argus.ui.components.BreadcrumbStep
import dev.houwert.argus.ui.components.ChangeCounts
import dev.houwert.argus.ui.components.ChromeIcon
import dev.houwert.argus.ui.components.ChromeSearchField
import dev.houwert.argus.ui.components.ContextCard
import dev.houwert.argus.ui.components.ContextCardDivider
import dev.houwert.argus.ui.components.ContextCardRow
import dev.houwert.argus.ui.components.ContextCardSegment
import dev.houwert.argus.ui.components.ContextCardSegments
import dev.houwert.argus.ui.components.FlatIconButton
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.KeyHint
import dev.houwert.argus.ui.components.KeyLegend
import dev.houwert.argus.ui.components.PanelHeader
import dev.houwert.argus.ui.components.PillTab
import dev.houwert.argus.ui.components.PillTabBar
import dev.houwert.argus.ui.components.ProjectBadge
import dev.houwert.argus.ui.components.SectionLabel
import dev.houwert.argus.ui.components.card
import dev.houwert.argus.ui.components.panel
import dev.houwert.argus.ui.icons.FileIcon
import dev.houwert.argus.ui.icons.FileTypeIconNamed
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

@Composable
internal fun ChromePage() {
  val theme = ArgusTheme.colors
  DialogStories()
  Story("Pill tab bar") {
    var tab by remember { mutableStateOf("agents") }
    PillTabBar(
      listOf(
        PillTab("home", "Home", ArgusIcon.home), PillTab("agents", "Agents", ArgusIcon.agents, badge = 3),
        PillTab("git", "Git", ArgusIcon.branch, indicator = true),
      ),
      tab, { tab = it },
    )
    var view by remember { mutableStateOf("simulate") }
    PillTabBar(
      listOf(
        PillTab("simulate", "Simulate", ArgusIcon.simulator), PillTab("inspect", "Inspect", ArgusIcon.elementPick),
        PillTab("logs", "Logs", ArgusIcon.terminal),
      ),
      view, { view = it }, compact = true, iconsOnly = true, framed = true,
    )
  }
  Story("Agent tabs") {
    var agent by remember { mutableStateOf("paused") }
    PillTabBar(
      listOf(
        PillTab("run", "Fix the sidebar", ArgusIcon.agent), PillTab("paused", "Token audit", ArgusIcon.snooze),
        PillTab("pin", "Triage", ArgusIcon.pin),
      ),
      agent, { agent = it }, compact = true,
    )
  }
  Story("Breadcrumb and badges") {
    Breadcrumb(listOf(BreadcrumbStep("Argus", badge = "Argus", badgeKey = "/r/Argus") {}, BreadcrumbStep("Unify the start composer")))
    FlowRow(spacing = 6.dp, packed = true) { for (p in galleryProjects) ProjectBadge(p, key = "/r/$p", size = 22.dp) }
    var query by remember { mutableStateOf("") }
    ChromeSearchField(query, { query = it }, Modifier.fillMaxWidth().card(4.dp))
  }
  Story("Context card") {
    var segment by remember { mutableStateOf("agent") }
    ContextCard {
      ContextCardSegments(
        listOf(
          ContextCardSegment("agent", "Agent", ArgusIcon.agents), ContextCardSegment("code", "Code", ArgusIcon.file),
          ContextCardSegment("git", "Git", ArgusIcon.branch),
        ),
        segment, { segment = it },
      ) { FlatIconButton(ArgusIcon.chevronUp, "Collapse", size = 26.dp) {} }
      ContextCardDivider()
      ContextCardRow(ArgusIcon.desktop, "This Mac")
      ContextCardRow(ChromeIcon.Symbol(ArgusIcon.openExternal), "Open in VS Code", onClick = {})
      ContextCardDivider()
      ContextCardRow(ChromeIcon.Badge("Argus", "/r/Argus"), "feat/unified-start-composer")
      ContextCardRow(ArgusIcon.file, "Changes") { ChangeCounts(10804, 3280) }
    }
  }
  Story("Panel") {
    Column(Modifier.fillMaxWidth().panel()) {
      PanelHeader("Files", detail = "3 changed") { Icon(ArgusIcon.filter, "Filter", Modifier.size(16.dp), tint = theme.textSecondary) }
      Text("Content runs to the panel's edges.", Modifier.padding(12.dp), color = theme.textSecondary, style = argusFont(13))
    }
    SectionLabel("Branches", count = 12)
  }
  Story("Keys") {
    HRow {
      KeyHint("⌘O")
      KeyHint("⇧⌘P")
      KeyHint("⌘,", boxed = false)
    }
    KeyLegend(listOf(listOf("↑", "↓") to "Navigate", listOf("Enter") to "Select", listOf("Esc") to "Close"))
  }
  Box(Modifier.height(24.dp))
}

/** Every glyph in the vocabulary, then every file-type icon. */
@Composable
internal fun IconsPage() {
  val theme = ArgusTheme.colors
  val context = LocalContext.current
  val glyphs = remember {
    ArgusIcon::class.java.declaredMethods
      .filter { it.name.startsWith("get") && it.parameterCount == 0 && it.returnType == androidx.compose.ui.graphics.vector.ImageVector::class.java }
      .map { it.name.removePrefix("get").replaceFirstChar(Char::lowercase) to it.invoke(ArgusIcon) as androidx.compose.ui.graphics.vector.ImageVector }
      .sortedBy { it.first }
  }
  val files = remember { FileIcon.allNames(FileIcon.lookup(context)) }
  LazyVerticalGrid(GridCells.Adaptive(76.dp), Modifier.fillMaxSize().background(theme.bg), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
    items(glyphs) { (name, vector) ->
      Column(Modifier.padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(vector, name, Modifier.size(22.dp), tint = theme.text)
        Text(name, color = theme.textMuted, style = argusFont(9), textAlign = TextAlign.Center, maxLines = 2)
      }
    }
    items(files) { name ->
      Column(Modifier.padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FileTypeIconNamed(name, 22.dp)
        Text(name, color = theme.textMuted, style = argusFont(9), textAlign = TextAlign.Center, maxLines = 2)
      }
    }
  }
}
