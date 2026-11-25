package dev.houwert.argus.ui.transcript

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.files.FilePreviewKind
import dev.houwert.argus.core.files.MarkdownImageLine
import dev.houwert.argus.core.files.MarkdownTarget
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.images.RemoteImages
import dev.houwert.argus.ui.mermaid.MermaidRenderer
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * A Markdown file being previewed: where its relative images and links point, and how to follow
 * them. Transcripts have none, so they render as before.
 */
class MarkdownDocument(
  /** Worktree-relative, the base for `![](img/a.png)` and `[guide](guide.md)`. */
  val path: String,
  /** A worktree file's bytes, or null when it can't be read. */
  val loadFile: suspend (String) -> ByteArray?,
  /** A followed link: another file, a heading here, or the web. */
  val open: (MarkdownTarget) -> Unit,
  /** Each heading's anchor and its top within the rendered page, for `#anchor` links to scroll to. */
  val headings: MutableMap<String, Float> = mutableMapOf(),
)

val LocalMarkdownDocument = staticCompositionLocalOf<MarkdownDocument?> { null }

/** Images in a row that wraps, as badges sit in a README. */
@Composable
internal fun MarkdownImages(images: List<MarkdownImageLine.Image>) {
  if (images.size == 1) {
    MarkdownImage(images[0])
  } else {
    FlowRow(spacing = 4.dp, rowSpacing = 4.dp, packed = true) { images.forEach { MarkdownImage(it) } }
  }
}

/** One image: a worktree file read through the host, an SVG drawn by the diagram renderer, or a web image. */
@Composable
private fun MarkdownImage(image: MarkdownImageLine.Image) {
  val theme = ArgusTheme.colors
  val document = LocalMarkdownDocument.current
  var loaded by remember(image) { mutableStateOf<Pair<ImageBitmap, Float>?>(null) }
  var failed by remember(image) { mutableStateOf(false) }
  LaunchedEffect(image, document) {
    loaded = document?.let { load(image.source, it) }
    failed = loaded == null
  }
  val shown = loaded
  when {
    shown != null -> {
      val (bitmap, scale) = shown
      // At its own size (in dp for a diagram's scale, pixels as dp for a photo), never blown up.
      val width = (bitmap.width / scale).dp
      val height = (bitmap.height / scale).dp
      Image(bitmap, image.alt.ifEmpty { "Image" }, Modifier.sizeIn(maxWidth = width, maxHeight = height), contentScale = ContentScale.Fit)
    }
    failed -> Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(dev.houwert.argus.ui.icons.Icon.image, null, Modifier.size(14.dp), tint = theme.textMuted)
      Text(image.alt.ifEmpty { image.source }, color = theme.textMuted, style = argusFont(12))
    }
    else -> CircularProgressIndicator(Modifier.size(16.dp), color = theme.textMuted, strokeWidth = 2.dp)
  }
}

/** The bitmap and its pixels per dp. */
private suspend fun load(source: String, document: MarkdownDocument): Pair<ImageBitmap, Float>? {
  val target = MarkdownTarget.resolve(source, document.path) ?: return null
  val (bytes, svg) = when (target) {
    is MarkdownTarget.File -> document.loadFile(target.path) to FilePreviewKind.isSvg(target.path)
    is MarkdownTarget.External -> {
      if (!RemoteImages.loadable(target.url)) return null
      fetch(target.url) to target.url.substringBefore('?').lowercase().endsWith(".svg")
    }
    is MarkdownTarget.Anchor -> return null
  }
  bytes ?: return null
  if (svg || looksLikeSvg(bytes)) {
    val diagram = MermaidRenderer.rasterizeSvg(bytes) ?: return null
    val bitmap = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(diagram.png, 0, diagram.png.size) } ?: return null
    return bitmap.asImageBitmap() to diagram.scale
  }
  return withContext(Dispatchers.Default) { decodeBounded(bytes) }?.let { it to 1f }
}

fun looksLikeSvg(bytes: ByteArray): Boolean {
  val head = String(bytes, 0, minOf(bytes.size, 256), Charsets.UTF_8).trimStart()
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.contains("<svg"))
}

/** Decoded no larger than [maxSide] pixels a side, so a huge photo can't exhaust memory. */
fun decodeBounded(bytes: ByteArray, maxSide: Int = 4096): ImageBitmap? {
  val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
  if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
  var sample = 1
  while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxSide) sample *= 2
  val options = BitmapFactory.Options().apply { inSampleSize = sample }
  return runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap() }.getOrNull()
}

private val http by lazy { OkHttpClient() }

/** https only (checked by the caller), capped like the host's own reads. */
private suspend fun fetch(url: String): ByteArray? = withContext(Dispatchers.IO) {
  runCatching {
    http.newCall(Request.Builder().url(url).build()).execute().use { response ->
      val body = response.body ?: return@use null
      if (!response.isSuccessful || body.contentLength() > 8L shl 20) null else body.bytes()
    }
  }.getOrNull()
}

@androidx.compose.ui.tooling.preview.Preview(name = "Markdown preview", heightDp = 640)
@Composable
private fun MarkdownDocumentPreview() {
  ArgusTheme(dark = false) {
    val document = remember { MarkdownDocument("docs/README.md", loadFile = { null }, open = {}) }
    androidx.compose.runtime.CompositionLocalProvider(LocalMarkdownDocument provides document) {
      MarkdownView(
        """
        # Argus
        See the [guide](guide.md) and [the source](../src/a.ts#L12).

        ![CI](https://example.com/ci.svg) ![Screenshot](img/shot.png)

        - [x] Mermaid in transcripts
        - [ ] PDF previews

        ```mermaid
        flowchart LR
          A --> B
        ```
        """.trimIndent(),
        Modifier.background(ArgusTheme.colors.bg).padding(16.dp),
      )
    }
  }
}
