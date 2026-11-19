package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.GitGraphPalette
import dev.houwert.argus.ui.theme.ProjectAccent
import dev.houwert.argus.ui.theme.argusFont

@Composable
internal fun TokensPage() {
  val t = ArgusTheme.colors
  Story("Surfaces") {
    Swatches(
      "bg" to t.bg, "bgSecondary" to t.bgSecondary, "bgTertiary" to t.bgTertiary, "bgHover" to t.bgHover,
      "surface" to t.surface, "sidebar" to t.sidebar, "selection" to t.selection, "mediaBg" to t.mediaBg,
    )
  }
  Story("Lines") { Swatches("border" to t.border, "borderSubtle" to t.borderSubtle, "borderStrong" to t.borderStrong) }
  Story("Text") { Swatches("text" to t.text, "textSecondary" to t.textSecondary, "textMuted" to t.textMuted) }
  Story("Accent") {
    Swatches(
      "accent" to t.accent, "accentSoft" to t.accentSoft, "accentBorder" to t.accentBorder, "onAccent" to t.onAccent,
      "tint" to t.tint, "switchTint" to t.switchTint, "brandPurple" to t.brandPurple,
    )
  }
  Story("Status") {
    Swatches(
      "success" to t.success, "successSoft" to t.successSoft, "warning" to t.warning, "warningSoft" to t.warningSoft,
      "error" to t.error, "errorSoft" to t.errorSoft,
    )
  }
  Story("Pull requests") { Swatches("prOpen" to t.prOpen, "prDraft" to t.prDraft, "prMerged" to t.prMerged, "prClosed" to t.prClosed) }
  Story("Chart series") { Swatches(*t.chartSeries.mapIndexed { i, c -> "series ${i + 1}" to c }.toTypedArray()) }
  Story("Project accents") {
    Swatches(*listOf("argus", "website", "mobile-app", "infra", "design", "docs").map { "/r/$it" to ProjectAccent.color("/r/$it") }.toTypedArray())
  }
  Story("Git graph lanes") { Swatches(*GitGraphPalette.lanes.mapIndexed { i, c -> "lane $i" to c }.toTypedArray()) }
  Story("Syntax") {
    val s = t.syntax
    Swatches(
      "keyword" to s.keyword, "string" to s.string, "comment" to s.comment, "type" to s.type, "function" to s.function,
      "number" to s.number, "constant" to s.constant, "property" to s.property, "tag" to s.tag, "heading" to s.heading,
    )
  }
  Story("Typography") {
    val ty = ArgusTheme.typography
    listOf(
      "Large title" to ty.largeTitle, "Title" to ty.title, "Title 2" to ty.title2, "Title 3" to ty.title3,
      "Headline" to ty.headline, "Body" to ty.body, "Callout" to ty.callout, "Subheadline" to ty.subheadline,
      "Footnote" to ty.footnote, "Caption" to ty.caption, "Caption 2" to ty.caption2,
    ).forEach { (name, style) -> Text(name, color = t.text, style = style) }
    Text("let mono = 12 // monospaced", color = t.textSecondary, style = argusFont(12, mono = true))
  }
}

@Composable
private fun Swatches(vararg colors: Pair<String, Color>) {
  val t = ArgusTheme.colors
  FlowRow(spacing = 8.dp, rowSpacing = 10.dp, packed = true) {
    for ((name, color) in colors) {
      Column(Modifier.padding(end = 2.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(
          Modifier.size(width = 74.dp, height = 40.dp)
            .background(color, RoundedCornerShape(8.dp))
            .border(0.5.dp, t.borderStrong, RoundedCornerShape(8.dp))
        )
        Text(name, color = t.textSecondary, style = argusFont(10, FontWeight.Medium), maxLines = 1)
      }
    }
  }
}

@Composable
internal fun Divider() = Box(Modifier.fillMaxWidth().height(1.dp).background(ArgusTheme.colors.border))

@Composable
internal fun HRow(content: @Composable () -> Unit) =
  Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { content() }
