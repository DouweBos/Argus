package dev.houwert.argus.ui.files

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.files.Notebook
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import dev.houwert.argus.ui.transcript.CodeBlockView
import dev.houwert.argus.ui.transcript.LocalMarkdownDocument
import dev.houwert.argus.ui.transcript.MarkdownDocument
import dev.houwert.argus.ui.transcript.MarkdownView
import dev.houwert.argus.ui.transcript.decodeBounded
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A Jupyter notebook as its author saw it: Markdown cells rendered, code highlighted, saved outputs below. */
@Composable
fun NotebookView(text: String, document: MarkdownDocument, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val parsed by produceState<Result<Notebook>?>(null, text) {
    value = withContext(Dispatchers.Default) { runCatching { Notebook.parse(text) } }
  }
  val notebook = parsed?.getOrNull()
  Box(modifier.fillMaxSize().background(theme.bg)) {
    when {
      parsed == null -> Loading("Opening notebook")
      notebook == null -> EmptyState(
        Icon.file, "Can't read this notebook",
        body = "It isn't a notebook file Argus can parse. Its source is still there to read.",
      )
      else -> CompositionLocalProvider(LocalMarkdownDocument provides document) {
        SelectionContainer {
          LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            itemsIndexed(notebook.cells) { _, cell -> NotebookCell(cell, notebook.language) }
          }
        }
      }
    }
  }
}

@Composable
private fun NotebookCell(cell: Notebook.Cell, language: String) {
  val theme = ArgusTheme.colors
  when (cell) {
    is Notebook.Cell.Markdown -> MarkdownView(cell.text)
    is Notebook.Cell.Raw -> Text(cell.text, color = theme.textSecondary, style = argusFont(12, mono = true))
    is Notebook.Cell.Code -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Text(cell.executionCount?.let { "In [$it]" } ?: "In [ ]", color = theme.textMuted, style = argusFont(11, FontWeight.Medium, mono = true))
      CodeBlockView(cell.source, language = language)
      cell.outputs.forEach { NotebookOutput(it) }
    }
  }
}

@Composable
private fun NotebookOutput(output: Notebook.Output) {
  val theme = ArgusTheme.colors
  when (output) {
    is Notebook.Output.Text -> OutputBlock(output.text, if (output.isError) theme.error else theme.text, if (output.isError) theme.errorSoft else Color.Transparent)
    is Notebook.Output.Error -> Column(
      Modifier.fillMaxWidth().clip(RoundedCornerShape(ArgusMetrics.radiusSmall)).background(theme.errorSoft).padding(8.dp),
      verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
      Text(if (output.value.isEmpty()) output.name else "${output.name}: ${output.value}", color = theme.error, style = argusFont(12, FontWeight.SemiBold, mono = true))
      if (output.traceback.isNotEmpty()) {
        Text(
          output.traceback, Modifier.horizontalScroll(rememberScrollState()),
          color = theme.textSecondary, style = argusFont(11, mono = true), softWrap = false,
        )
      }
    }
    is Notebook.Output.Image -> {
      val image = remember(output) { decodeBounded(output.bytes) }
      if (image != null) {
        Image(image, "Cell output image", Modifier.fillMaxWidth().heightIn(max = 360.dp), contentScale = ContentScale.Fit)
      }
    }
    is Notebook.Output.Html -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
      if (output.plain == null) Text("HTML output, shown as source", color = theme.textMuted, style = argusFont(10, FontWeight.SemiBold))
      OutputBlock(output.plain ?: output.html, theme.text, Color.Transparent)
    }
    is Notebook.Output.Markdown -> MarkdownView(output.text)
  }
}

@Composable
private fun OutputBlock(text: String, color: Color, background: Color) {
  val theme = ArgusTheme.colors
  Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).background(background)) {
    Box(Modifier.width(2.dp).fillMaxHeight().background(theme.border))
    Text(
      text.removeSuffix("\n"),
      Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 4.dp),
      color = color, style = argusFont(12, mono = true), softWrap = false,
    )
  }
}
