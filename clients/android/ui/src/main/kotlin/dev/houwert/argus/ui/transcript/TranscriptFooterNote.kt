package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme

/** What sits under a transcript in place of the composer: why you can't write to this agent, and what you can do instead. */
@Composable
fun TranscriptFooterNote(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
  val theme = ArgusTheme.colors
  Column(Modifier.fillMaxWidth().then(modifier).background(theme.bgSecondary)) {
    Box(Modifier.fillMaxWidth().height(0.5.dp).background(theme.border))
    Column(Modifier.fillMaxWidth().padding(ArgusMetrics.space), verticalArrangement = Arrangement.spacedBy(6.dp), content = content)
  }
}

@Composable
fun TranscriptFooterNote(text: String, modifier: Modifier = Modifier) {
  TranscriptFooterNote(modifier) { MutedText(text) }
}
