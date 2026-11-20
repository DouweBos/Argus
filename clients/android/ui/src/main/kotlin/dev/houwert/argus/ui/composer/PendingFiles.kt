package dev.houwert.argus.ui.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.icons.FileTypeIcon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import java.util.Locale
import java.util.UUID

/** A non-image file waiting to go out with the next message. */
data class PendingFile(
  val name: String,
  val size: Long,
  /** Where the session's agent reads it; null while it uploads. */
  val path: String? = null,
  val id: String = UUID.randomUUID().toString(),
) {
  val isUploading: Boolean get() = path == null

  companion object {
    /** The line the message carries, so the agent knows to open them. */
    fun mentions(files: List<PendingFile>): String? {
      val paths = files.mapNotNull { it.path }
      if (paths.isEmpty()) return null
      val list = paths.joinToString(" ") { "@" + it.replace(" ", "\\ ") }
      return "Attached ${if (paths.size == 1) "file" else "files"}: $list"
    }

    /** "12 KB", "3.4 MB": a file's size as the chip shows it. */
    fun formatSize(bytes: Long): String = when {
      bytes < 1_000 -> "$bytes bytes"
      bytes < 1_000_000 -> "${bytes / 1_000} KB"
      else -> String.format(Locale.ROOT, "%.1f MB", bytes / 1_000_000.0)
    }
  }
}

/** A pending file in the composer: its type icon, name and size, or a spinner while it uploads. */
@Composable
fun PendingFileChip(file: PendingFile, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  Row(
    modifier
      .height(56.dp)
      .clip(shape)
      .background(theme.surface)
      .border(1.dp, theme.border, shape)
      .padding(6.dp)
      .clearAndSetSemantics {
        contentDescription = if (file.isUploading) "${file.name}, uploading" else "Attached file ${file.name}"
      },
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(
      Modifier.size(44.dp).clip(RoundedCornerShape(ArgusMetrics.radiusSmall - 2.dp)).background(theme.bgTertiary),
      contentAlignment = Alignment.Center,
    ) { FileTypeIcon(file.name, size = 22.dp) }
    Column(Modifier.widthIn(max = 160.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(file.name, color = theme.text, style = argusFont(12), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
      Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        if (file.isUploading) CircularProgressIndicator(Modifier.size(10.dp), color = theme.textMuted, strokeWidth = 1.5.dp)
        Text(
          if (file.isUploading) "Uploading" else PendingFile.formatSize(file.size),
          color = theme.textMuted,
          style = argusFont(10),
          maxLines = 1,
        )
      }
    }
  }
}
