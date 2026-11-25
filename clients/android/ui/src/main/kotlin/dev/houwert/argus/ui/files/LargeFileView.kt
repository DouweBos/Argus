package dev.houwert.argus.ui.files

import android.text.format.Formatter
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.files.LargeFilePager
import dev.houwert.argus.ui.code.CodeView
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import java.text.NumberFormat
import kotlinx.coroutines.launch

/** A file too large to open whole: read-only, a page at a time, under a banner saying why. */
@Composable
fun LargeFileView(pager: LargeFilePager, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val state by pager.state.collectAsState()
  val size = Formatter.formatShortFileSize(context, pager.size)
  LaunchedEffect(pager) { if (pager.state.value.page == null && !pager.state.value.binary) pager.start() }

  Column(modifier.fillMaxSize().background(theme.bg)) {
    Banner(
      "At $size this file is too large to show in full on a phone, so it opens read-only, a page at a time.",
      Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
      tone = Tone.Accent,
      title = "Read-only: large file",
    )
    val page = state.page
    Box(Modifier.weight(1f).fillMaxWidth()) {
      when {
        state.binary -> EmptyState(Icon.file, "Binary file", body = "This file isn't text, so there's nothing to page through.")
        page != null -> key(page.offset) { CodeView(page.lines.joinToString("\n"), null, firstLine = page.firstLine) }
        state.failure != null -> EmptyState(Icon.warning, "Can't read this file", body = state.failure)
        else -> Loading("Opening file")
      }
    }
    if (page != null) {
      Box(Modifier.fillMaxWidth().height(1.dp).background(theme.border))
      Row(
        Modifier.fillMaxWidth().background(theme.bgSecondary).padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        val numbers = NumberFormat.getIntegerInstance()
        val last = page.firstLine + maxOf(0, page.lines.size - 1)
        val percent = (pager.progress * 100).toInt()
        Text(
          "Lines ${numbers.format(page.firstLine)}–${numbers.format(last)} · $percent% of $size",
          Modifier.weight(1f), color = theme.textSecondary, style = argusFont(11), maxLines = 1,
        )
        if (state.loading) CircularProgressIndicator(Modifier.height(14.dp), strokeWidth = 2.dp, color = theme.textMuted)
        Btn("Previous", tone = ButtonTone.Secondary, small = true, icon = Icon.chevronLeft, hugs = true, enabled = state.hasPrevious && !state.loading) {
          scope.launch { pager.previous() }
        }
        Btn("Next", tone = ButtonTone.Secondary, small = true, icon = Icon.chevronRight, hugs = true, enabled = pager.hasNext && !state.loading) {
          scope.launch { pager.next() }
        }
      }
    }
  }
}
