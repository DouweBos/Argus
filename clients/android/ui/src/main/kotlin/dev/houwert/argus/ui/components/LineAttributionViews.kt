package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.git.AttributionCounts
import dev.houwert.argus.core.git.LineAuthor
import dev.houwert.argus.ui.theme.ArgusColors
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

val LineAuthor.label: String get() = if (this == LineAuthor.AGENT) "Agent" else "Human"

private val LineAuthor.description: String
  get() = if (this == LineAuthor.AGENT) "Written by an agent" else "Edited by a person"

fun LineAuthor.color(theme: ArgusColors): Color = if (this == LineAuthor.AGENT) theme.attributionAgent else theme.attributionHuman

/** One line's mark: a small dot for an agent, a thin bar for a person, told apart by shape as well as colour. */
@Composable
fun AttributionMark(author: LineAuthor?, modifier: Modifier = Modifier, height: Dp = 14.dp) {
  val theme = ArgusTheme.colors
  Box(
    modifier.size(7.dp, height).then(if (author != null) Modifier.semantics { contentDescription = author.description } else Modifier),
    contentAlignment = Alignment.Center,
  ) {
    when (author) {
      LineAuthor.AGENT -> Box(Modifier.size(5.dp).background(theme.attributionAgent, CircleShape))
      LineAuthor.HUMAN -> Box(Modifier.size(2.5.dp, height).background(theme.attributionHuman, RoundedCornerShape(2.dp)))
      null -> {}
    }
  }
}

/** What the gutter marks mean, with how many of the lines shown each author has. */
@Composable
fun AttributionLegend(counts: AttributionCounts?, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Row(modifier, horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
    for ((author, count) in listOf(LineAuthor.AGENT to counts?.agent, LineAuthor.HUMAN to counts?.human)) {
      Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        AttributionMark(author, height = 10.dp)
        Text(author.label, color = theme.textSecondary, style = argusFont(11))
        if (count != null) Text("$count", color = theme.textMuted, style = argusFont(11))
      }
    }
  }
}
