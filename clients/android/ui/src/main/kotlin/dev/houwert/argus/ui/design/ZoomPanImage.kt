package dev.houwert.argus.ui.design

import android.graphics.BitmapFactory
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.SfSymbol
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlin.math.min
import kotlin.math.roundToInt

/** PNG bytes as a bitmap, decoded once per array; null when they aren't an image. */
@Composable
fun rememberPngBitmap(data: ByteArray?): ImageBitmap? =
  remember(data) { data?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() } }

/**
 * A PNG fitted to its box that pinches to zoom and, once zoomed, drags to pan, with buttons for
 * the same. `overlay` draws over the image at its fitted size and moves with it; it gets the
 * zoom, to keep strokes thin. One finger at fit scale is left to the scroll around it.
 */
@Composable
fun ZoomPanImage(
  data: ByteArray?,
  label: String,
  modifier: Modifier = Modifier,
  overlay: (@Composable (fitted: DpSize, zoom: Float) -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val image = rememberPngBitmap(data)
  var scale by remember(data) { mutableFloatStateOf(1f) }
  var offset by remember(data) { mutableStateOf(Offset.Zero) }
  fun fit() {
    scale = 1f
    offset = Offset.Zero
  }
  val shownScale by animateFloatAsState(scale, label = "zoom")
  BoxWithConstraints(modifier.clipToBounds().background(theme.bgSecondary)) {
    val box = DpSize(maxWidth, maxHeight)
    Box(
      Modifier.fillMaxSize()
        .pointerInput(data) {
          awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false)
            do {
              val event = awaitPointerEvent()
              val pressed = event.changes.count { it.pressed }
              if (pressed > 1 || scale > 1f) {
                scale = (scale * event.calculateZoom()).coerceIn(0.5f, 8f)
                offset = if (scale > 1f) offset + event.calculatePan() else Offset.Zero
                event.changes.forEach { if (it.positionChanged()) it.consume() }
              }
            } while (event.changes.any { it.pressed })
            if (scale <= 1f) fit()
          }
        }
        .graphicsLayer {
          scaleX = shownScale
          scaleY = shownScale
          translationX = offset.x
          translationY = offset.y
        },
      contentAlignment = Alignment.Center,
    ) {
      if (image == null) {
        CircularProgressIndicator(Modifier.size(20.dp), color = theme.textMuted, strokeWidth = 2.dp)
      } else {
        val fitted = fitted(image, box)
        Box(Modifier.size(fitted)) {
          Image(image, label, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
          overlay?.invoke(fitted, shownScale)
        }
      }
    }
    Row(
      Modifier.align(Alignment.BottomEnd).padding(8.dp).background(theme.surface, CircleShape).border(1.dp, theme.border, CircleShape),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      IconBtn(SfSymbol["minus.magnifyingglass"], "Zoom out", size = 18.dp) {
        scale = (scale / 1.5f).coerceIn(0.5f, 8f)
        if (scale <= 1f) offset = Offset.Zero
      }
      val interaction = rememberInteraction()
      Text(
        "${(scale * 100).roundToInt()}%",
        Modifier.widthIn(min = 44.dp).argusClickable(interaction, shape = RoundedCornerShape(6.dp), label = "Fit") { fit() }
          .semantics { contentDescription = "Fit" },
        color = theme.textSecondary, style = argusFont(12),
      )
      IconBtn(SfSymbol["plus.magnifyingglass"], "Zoom in", size = 18.dp) { scale = (scale * 1.5f).coerceIn(0.5f, 8f) }
    }
  }
}

@Composable
private fun fitted(image: ImageBitmap, box: DpSize): DpSize {
  val density = LocalDensity.current
  if (image.width <= 0 || image.height <= 0) return DpSize.Zero
  val width = with(density) { image.width.toDp() }
  val height = with(density) { image.height.toDp() }
  val factor = min(box.width / width, box.height / height)
  return DpSize(width * factor, height * factor)
}
