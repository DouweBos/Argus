package dev.houwert.argus.app.screens.files

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.format.Formatter
import android.webkit.MimeTypeMap
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import dev.houwert.argus.core.files.SessionFilePaths
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.icons.FileTypeIcon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import java.io.File
import java.util.UUID

/**
 * A Word, Excel, PowerPoint, Keynote, Pages or Numbers file: Android has no system previewer, so it
 * opens read-only in an app that can show it, through a private copy shared by content URI.
 */
@Composable
internal fun OfficeFilePreview(path: String, bytes: ByteArray, onShown: () -> Unit) {
  val theme = ArgusTheme.colors
  val context = LocalContext.current
  var failure by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(Unit) { onShown() }
  Column(
    Modifier.fillMaxSize().padding(24.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    FileTypeIcon(path, size = 48.dp)
    Text(SessionFilePaths.fileName(path), color = theme.text, style = argusFont(16), textAlign = TextAlign.Center)
    Text(
      "${Formatter.formatShortFileSize(context, bytes.size.toLong())} · This phone can't preview it here, but an installed app can open a read-only copy.",
      color = theme.textSecondary, style = argusFont(13), textAlign = TextAlign.Center,
    )
    Btn("Open With", hugs = true) {
      failure = openWith(context, path, bytes)
    }
    failure?.let { Text(it, color = theme.error, style = argusFont(13), textAlign = TextAlign.Center) }
  }
}

/** Null when an app took it; otherwise why not. */
private fun openWith(context: Context, path: String, bytes: ByteArray): String? {
  val folder = File(context.cacheDir, "previews/${UUID.randomUUID()}").apply { mkdirs() }
  // Earlier copies go: each open makes a fresh one.
  File(context.cacheDir, "previews").listFiles()?.filter { it != folder }?.forEach { it.deleteRecursively() }
  val file = File(folder, SessionFilePaths.fileName(path).ifEmpty { "document" })
  return try {
    file.writeBytes(bytes)
    // The camera's provider also shares `previews/` from the cache.
    val uri: Uri = FileProvider.getUriForFile(context, "${context.packageName}.argus.camera", file)
    val extension = file.extension.lowercase()
    val type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
    val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(view, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    null
  } catch (e: ActivityNotFoundException) {
    "No app on this phone opens this kind of document."
  } catch (e: Exception) {
    "The document couldn't be handed to another app."
  }
}
