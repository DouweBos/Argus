package dev.houwert.argus.ui.files

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.withContext

/**
 * A PDF's pages, top to bottom, with "3 of 12" over them. Pinch zooms the whole column; once
 * zoomed, a drag pans sideways and scrolls the pages. Rendered by the platform's [PdfRenderer].
 */
@Composable
fun PdfDocumentView(bytes: ByteArray, modifier: Modifier = Modifier) {
  val context = LocalContext.current
  val opened by produceState<Result<PdfPages>?>(null, bytes) {
    value = withContext(PdfPages.thread) { runCatching { PdfPages.open(context, bytes) } }
  }
  val pages = opened?.getOrNull()
  DisposableEffect(pages) { onDispose { pages?.close() } }
  when {
    opened == null -> Loading("Opening PDF", modifier)
    pages == null -> EmptyState(Icon.warning, "Can't show this PDF", modifier, body = "It may be damaged or password protected.")
    else -> Pages(pages, modifier)
  }
}

@Composable
private fun Pages(pages: PdfPages, modifier: Modifier) {
  val theme = ArgusTheme.colors
  val list = rememberLazyListState()
  var scale by remember(pages) { mutableFloatStateOf(1f) }
  var offsetX by remember(pages) { mutableFloatStateOf(0f) }
  BoxWithConstraints(modifier.fillMaxSize().clipToBounds().background(theme.bg)) {
    val widthPx = with(LocalDensity.current) { maxWidth.roundToPx() }
    LazyColumn(
      Modifier.fillMaxSize()
        .zoomable(list, { scale }, { scale = it }, { offsetX }, { offsetX = it }, widthPx)
        .graphicsLayer {
          scaleX = scale
          scaleY = scale
          translationX = offsetX
        },
      state = list,
      contentPadding = PaddingValues(12.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      itemsIndexed(pages.sizes) { index, size ->
        Page(pages, index, size.first.toFloat() / size.second, widthPx)
      }
    }
    PageIndicator(list, pages.count, Modifier.align(Alignment.TopCenter).padding(top = 8.dp))
  }
}

@Composable
private fun Page(pages: PdfPages, index: Int, aspect: Float, widthPx: Int) {
  // Twice the column's width, so a pinch to 2× stays sharp; capped to keep each page's bitmap small.
  val renderWidth = (widthPx * 2).coerceIn(1, 2048)
  val bitmap by produceState(pages.cached(index, renderWidth), pages, index, renderWidth) {
    if (value == null) value = withContext(PdfPages.thread) { runCatching { pages.render(index, renderWidth) }.getOrNull() }
  }
  Box(Modifier.fillMaxWidth().aspectRatio(aspect.coerceIn(0.1f, 10f)).background(Color.White)) {
    bitmap?.let { Image(it, "Page ${index + 1}", Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
  }
}

@Composable
private fun PageIndicator(list: LazyListState, count: Int, modifier: Modifier) {
  val theme = ArgusTheme.colors
  val page by remember(list) {
    derivedStateOf {
      val visible = list.layoutInfo.visibleItemsInfo
      // The page covering most of the viewport's top half.
      val first = visible.firstOrNull()
      if (first != null && first.offset + first.size / 2 < 0 && visible.size > 1) visible[1].index + 1 else list.firstVisibleItemIndex + 1
    }
  }
  Text(
    "$page of $count",
    modifier.background(theme.surface.copy(alpha = 0.92f), CircleShape).padding(horizontal = 10.dp, vertical = 4.dp),
    color = theme.textSecondary, style = argusFont(12),
  )
}

/**
 * Two fingers zoom; once zoomed, one finger pans sideways and scrolls the list. At fit scale a
 * single finger is left to the list's own scrolling.
 */
private fun Modifier.zoomable(
  list: LazyListState,
  scale: () -> Float,
  setScale: (Float) -> Unit,
  offsetX: () -> Float,
  setOffsetX: (Float) -> Unit,
  widthPx: Int,
) = pointerInput(list, widthPx) {
  awaitEachGesture {
    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
    do {
      val event = awaitPointerEvent(PointerEventPass.Initial)
      val pressed = event.changes.count { it.pressed }
      if (pressed > 1 || scale() > 1f) {
        val next = (scale() * event.calculateZoom()).coerceIn(1f, 5f)
        setScale(next)
        val pan = event.calculatePan()
        val limit = widthPx * (next - 1f) / 2f
        setOffsetX((offsetX() + pan.x).coerceIn(-limit, limit))
        list.dispatchRawDelta(-pan.y / next)
        event.changes.forEach { if (it.positionChanged()) it.consume() }
      }
    } while (event.changes.any { it.pressed })
    if (scale() <= 1f) setOffsetX(0f)
  }
}

/** An open PDF: its page sizes, and pages rendered on demand. Touch it only on [thread]. */
private class PdfPages(private val file: File, private val descriptor: ParcelFileDescriptor, private val renderer: PdfRenderer) {
  val count = renderer.pageCount
  /** Width × height in points. */
  val sizes: List<Pair<Int, Int>> = (0 until count).map { index -> renderer.openPage(index).use { it.width to it.height } }
  private val bitmaps = object : LruCache<Pair<Int, Int>, ImageBitmap>(48 * 1024 * 1024) {
    override fun sizeOf(key: Pair<Int, Int>, value: ImageBitmap) = value.width * value.height * 4
  }
  @Volatile private var closed = false

  fun cached(index: Int, width: Int): ImageBitmap? = bitmaps.get(index to width)

  fun render(index: Int, width: Int): ImageBitmap? {
    if (closed) return null
    val (pageWidth, pageHeight) = sizes[index]
    val height = (width.toLong() * pageHeight / pageWidth.coerceAtLeast(1)).toInt().coerceIn(1, 4096)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(AndroidColor.WHITE)
    renderer.openPage(index).use { it.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
    return bitmap.asImageBitmap().also { bitmaps.put(index to width, it) }
  }

  fun close() {
    if (closed) return
    closed = true
    // Behind any render still queued on the same thread.
    CoroutineScope(thread).launch {
      runCatching { renderer.close() }
      runCatching { descriptor.close() }
      file.delete()
      bitmaps.evictAll()
    }
  }

  companion object {
    /** PdfRenderer allows one page open at a time, so every call runs here. */
    @OptIn(ExperimentalCoroutinesApi::class)
    val thread = Dispatchers.IO.limitedParallelism(1)

    fun open(context: Context, bytes: ByteArray): PdfPages {
      val directory = File(context.cacheDir, "pdf-previews").apply { mkdirs() }
      val file = File(directory, "${UUID.randomUUID()}.pdf")
      file.writeBytes(bytes)
      val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
      return try {
        PdfPages(file, descriptor, PdfRenderer(descriptor))
      } catch (error: Exception) {
        descriptor.close()
        file.delete()
        throw error
      }
    }
  }
}
