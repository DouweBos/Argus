package dev.houwert.argus.ui.transcript

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.provider.MediaStore
import android.widget.Toast
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.loadImage
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.argusFont
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val MAX_SCALE = 4f
private const val DOUBLE_TAP_SCALE = 2.5f
private const val DISMISS_DISTANCE = 120f

/** What a viewer action did, for telemetry. */
enum class ImageViewerAction { Save, Share }

/**
 * The full-screen image pager: pinch, double-tap, pan, swipe down to dismiss, swipe across to
 * page. Save and Share act on the image on screen. Colours are the media canvas's, not the theme's.
 */
@Composable
fun ImageViewerOverlay(viewer: ImageViewerState, host: HostStore, onAction: (ImageViewerAction) -> Unit = {}) {
  if (!viewer.isPresented) return
  val ids = viewer.imageIds
  val pager = rememberPagerState(viewer.currentIndex ?: 0) { ids.size }
  var zoomed by remember { mutableStateOf(false) }
  var dismissProgress by remember { mutableFloatStateOf(0f) }
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  fun close() {
    zoomed = false
    dismissProgress = 0f
    viewer.dismiss()
  }
  LaunchedEffect(pager) { snapshotFlow { pager.currentPage }.collect { viewer.current = ids.getOrNull(it) ?: viewer.current } }

  Dialog(::close, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 1 - dismissProgress))) {
      HorizontalPager(pager, Modifier.fillMaxSize(), userScrollEnabled = !zoomed, key = { ids[it] }) { page ->
        ZoomablePage(
          host, viewer.agentKey, ids[page], isCurrent = page == pager.currentPage,
          onZoomChange = { zoomed = it }, onDismissProgress = { dismissProgress = it }, onDismiss = ::close,
        )
      }
      Row(
        Modifier.fillMaxWidth().safeDrawingPadding().padding(8.dp).alpha(1 - dismissProgress),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        val current = viewer.current
        if (current != null) {
          val item = ImageViewerItem(current, host.imageCache.value[host.imageKey(viewer.agentKey, current)])
          if (item.data != null) {
            IconBtn(Icon.download, "Save image", tint = Color.White) {
              scope.launch {
                val saved = saveToGallery(context, item)
                Toast.makeText(context, if (saved) "Saved to Pictures" else "Couldn't save the image", Toast.LENGTH_SHORT).show()
                if (saved) onAction(ImageViewerAction.Save)
              }
            }
            IconBtn(Icon.share, "Share image", tint = Color.White) {
              scope.launch { if (share(context, item)) onAction(ImageViewerAction.Share) }
            }
          }
        }
        Spacer(Modifier.weight(1f))
        IconBtn(Icon.close, "Close", tint = Color.White, onClick = ::close)
      }
      viewer.positionLabel?.let {
        Text(
          it, Modifier.align(Alignment.BottomCenter).safeDrawingPadding().padding(bottom = 12.dp).alpha(1 - dismissProgress),
          color = Color.White.copy(alpha = 0.7f), style = argusFont(12),
        )
      }
    }
  }
}

/** One page: loads its own bytes and owns its zoom, so swiping away and back starts fresh. */
@Composable
private fun ZoomablePage(
  host: HostStore,
  agentKey: String,
  imageId: String,
  isCurrent: Boolean,
  onZoomChange: (Boolean) -> Unit,
  onDismissProgress: (Float) -> Unit,
  onDismiss: () -> Unit,
) {
  val uri by rememberCachedImage(host, agentKey, imageId)
  val image = rememberDecoded(uri)
  val scale = remember { Animatable(1f) }
  var offset by remember { mutableStateOf(Offset.Zero) }
  val drop = remember { Animatable(0f) }
  val scope = rememberCoroutineScope()
  LaunchedEffect(agentKey, imageId) { host.loadImage(agentKey, imageId) }
  LaunchedEffect(isCurrent) {
    if (!isCurrent) {
      scale.snapTo(1f)
      offset = Offset.Zero
    }
  }
  LaunchedEffect(isCurrent) { snapshotFlow { scale.value > 1.01f }.collect { if (isCurrent) onZoomChange(it) } }

  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    if (image == null) {
      CircularProgressIndicator(Modifier.size(24.dp), color = Color.White, strokeWidth = 2.dp)
      return@Box
    }
    Image(
      image, null,
      Modifier.fillMaxSize()
        .pointerInput(imageId) {
          detectTapGestures(
            onDoubleTap = {
              scope.launch {
                if (scale.value > 1.01f) {
                  offset = Offset.Zero
                  scale.animateTo(1f)
                } else {
                  scale.animateTo(DOUBLE_TAP_SCALE)
                }
              }
            },
            onTap = { onDismiss() },
          )
        }
        .pointerInput(imageId) {
          awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false)
            var dragging = false
            var travel = Offset.Zero
            do {
              val event = awaitPointerEvent()
              val pressed = event.changes.filter { it.pressed }
              if (pressed.size >= 2) {
                // Pinch: scale about the centroid's movement, clamped.
                val a = pressed[0]
                val b = pressed[1]
                val before = (a.previousPosition - b.previousPosition).getDistance()
                val after = (a.position - b.position).getDistance()
                if (before > 0f) scope.launch { scale.snapTo((scale.value * after / before).coerceIn(1f, MAX_SCALE)) }
                if (scale.value <= 1f) offset = Offset.Zero
                event.changes.forEach { it.consume() }
              } else if (pressed.size == 1) {
                val change = pressed[0]
                val delta = change.positionChange()
                if (scale.value > 1.01f) {
                  offset += delta
                  change.consume()
                } else {
                  travel += delta
                  // At rest, a downward drag means "put this away"; a sideways one is the pager's.
                  if (!dragging && travel.y > 24f && travel.y > abs(travel.x) * 1.5f) dragging = true
                  if (dragging) {
                    scope.launch { drop.snapTo(maxOf(0f, travel.y)) }
                    onDismissProgress(minOf(1f, travel.y / (DISMISS_DISTANCE * density)))
                    change.consume()
                  }
                }
              }
            } while (event.changes.any { it.pressed })
            if (dragging) {
              if (drop.value > DISMISS_DISTANCE * density) {
                onDismiss()
              } else {
                onDismissProgress(0f)
                scope.launch { drop.animateTo(0f) }
              }
            }
          }
        }
        .graphicsLayer {
          scaleX = scale.value
          scaleY = scale.value
          translationX = offset.x
          translationY = offset.y + drop.value
        },
      contentScale = ContentScale.Fit,
    )
  }
}

/** Into Pictures/Argus; no permission needed from Android 10 on. */
private suspend fun saveToGallery(context: Context, item: ImageViewerItem): Boolean = withContext(Dispatchers.IO) {
  val data = item.data ?: return@withContext false
  runCatching {
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, item.fileName)
      put(MediaStore.Images.Media.MIME_TYPE, item.mediaType)
      put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Argus")
    }
    val resolver = context.contentResolver
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return@runCatching false
    resolver.openOutputStream(uri)?.use { it.write(data) } ?: return@runCatching false
    true
  }.getOrDefault(false)
}

/** Through the share sheet, from a cache file [SharedImageProvider] serves. */
private suspend fun share(context: Context, item: ImageViewerItem): Boolean {
  val data = item.data ?: return false
  val file = withContext(Dispatchers.IO) {
    runCatching {
      SharedImageProvider.directory(context).resolve(item.fileName).apply { writeBytes(data) }
    }.getOrNull()
  } ?: return false
  val uri = SharedImageProvider.uri(context, file)
  val send = Intent(Intent.ACTION_SEND).setType(item.mediaType).putExtra(Intent.EXTRA_STREAM, uri)
    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
  context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  return true
}
