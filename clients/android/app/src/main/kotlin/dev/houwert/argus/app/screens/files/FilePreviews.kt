package dev.houwert.argus.app.screens.files

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.files.FilePreviewKind
import dev.houwert.argus.core.files.MarkdownTarget
import dev.houwert.argus.core.files.SessionFilePaths
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.readFileBytes
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.design.ZoomPanImage
import dev.houwert.argus.ui.files.PdfDocumentView
import dev.houwert.argus.ui.files.NotebookView
import dev.houwert.argus.ui.files.SandboxedHtmlView
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.mermaid.MermaidRenderer
import dev.houwert.argus.ui.transcript.LocalMarkdownDocument
import dev.houwert.argus.ui.transcript.MarkdownDocument
import dev.houwert.argus.ui.transcript.MarkdownView
import dev.houwert.argus.ui.transcript.decodeBounded
import dev.houwert.argus.ui.transcript.looksLikeSvg
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A Markdown file rendered; relative images and links lead into the same worktree, never out of it. */
@Composable
internal fun MarkdownFilePreview(host: HostStore, sessionId: String, path: String, text: String, onShown: () -> Unit) {
  val router = LocalRouter.current
  val uri = LocalUriHandler.current
  val scroll = rememberScrollState()
  val scope = rememberCoroutineScope()
  val padding = with(LocalDensity.current) { 16.dp.toPx() }
  val headings = remember(sessionId, path) { mutableMapOf<String, Float>() }
  val document = remember(sessionId, path) {
    MarkdownDocument(
      path = path,
      loadFile = { relative ->
        try {
          host.readFileBytes(sessionId, relative)
        } catch (e: Exception) {
          if (HostStore.isCancellation(e)) throw e
          null
        }
      },
      open = { target ->
        when (target) {
          is MarkdownTarget.File -> router.push(Route.File(sessionId, target.path, target.line, "markdown_link"))
          is MarkdownTarget.External -> runCatching { uri.openUri(target.url) }
          is MarkdownTarget.Anchor -> headings[target.id]?.let { top ->
            scope.launch { scroll.animateScrollTo((top + padding).toInt()) }
          }
        }
      },
      headings = headings,
    )
  }
  LaunchedEffect(Unit) { onShown() }
  CompositionLocalProvider(LocalMarkdownDocument provides document) {
    MarkdownView(text, Modifier.fillMaxSize().verticalScroll(scroll).padding(16.dp))
  }
}

/** An HTML file in a sandboxed web view: worktree files only, unless [allowNetwork]. */
@Composable
internal fun HtmlFilePreview(host: HostStore, sessionId: String, path: String, text: String, allowNetwork: Boolean, onShown: () -> Unit) {
  val document = worktreeDocument(host, sessionId, path)
  LaunchedEffect(Unit) { onShown() }
  SandboxedHtmlView(text, document, allowNetwork, Modifier.fillMaxSize())
}

/** A notebook's cells and saved outputs; relative images in its Markdown come from the worktree. */
@Composable
internal fun NotebookFilePreview(host: HostStore, sessionId: String, path: String, text: String, onShown: () -> Unit) {
  val document = worktreeDocument(host, sessionId, path)
  LaunchedEffect(Unit) { onShown() }
  NotebookView(text, document)
}

/** Files a rendered page loads come from the same worktree; links open there or in the browser. */
@Composable
private fun worktreeDocument(host: HostStore, sessionId: String, path: String): MarkdownDocument {
  val router = LocalRouter.current
  val uri = LocalUriHandler.current
  return remember(sessionId, path) {
    MarkdownDocument(
      path = path,
      loadFile = { relative ->
        try {
          host.readFileBytes(sessionId, relative)
        } catch (e: Exception) {
          if (HostStore.isCancellation(e)) throw e
          null
        }
      },
      open = { target ->
        when (target) {
          is MarkdownTarget.File -> router.push(Route.File(sessionId, target.path, target.line, "markdown_link"))
          is MarkdownTarget.External -> runCatching { uri.openUri(target.url) }
          is MarkdownTarget.Anchor -> Unit
        }
      },
    )
  }
}

/** A PDF's pages or an image (an SVG drawn by the diagram renderer), from bytes the host read. */
@Composable
internal fun BinaryFilePreview(kind: FilePreviewKind, path: String, bytes: ByteArray, onShown: () -> Unit) {
  if (kind == FilePreviewKind.Office) {
    OfficeFilePreview(path, bytes, onShown)
    return
  }
  if (kind == FilePreviewKind.Pdf) {
    LaunchedEffect(Unit) { onShown() }
    PdfDocumentView(bytes, Modifier.fillMaxSize())
    return
  }
  val image by produceState<Result<ImageBitmap?>?>(null, bytes) {
    value = runCatching {
      if (FilePreviewKind.isSvg(path) || looksLikeSvg(bytes)) {
        MermaidRenderer.rasterizeSvg(bytes)?.let { diagram ->
          withContext(Dispatchers.Default) { android.graphics.BitmapFactory.decodeByteArray(diagram.png, 0, diagram.png.size) }?.asImageBitmap()
        }
      } else {
        withContext(Dispatchers.Default) { decodeBounded(bytes) }
      }
    }
  }
  val shown = image?.getOrNull()
  when {
    image == null -> Loading("Opening image")
    shown == null -> EmptyState(Icon.image, "Can't show this image", body = "This image format can't be drawn on this phone.")
    else -> {
      LaunchedEffect(Unit) { onShown() }
      ZoomPanImage(shown, SessionFilePaths.fileName(path), Modifier.fillMaxSize())
    }
  }
}
