package dev.houwert.argus.ui.automations

import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.houwert.argus.ui.transcript.MarkdownView

/** A report's or a memory's markdown, selectable, rendered as the transcript renders it. */
@Composable
fun ReportMarkdown(text: String, modifier: Modifier = Modifier, baseSize: Int = 15) {
  SelectionContainer(modifier) { MarkdownView(text, baseSize = baseSize) }
}
