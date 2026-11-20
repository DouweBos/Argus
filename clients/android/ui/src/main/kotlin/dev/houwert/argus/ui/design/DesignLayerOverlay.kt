package dev.houwert.argus.ui.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.DesignLayerTree
import dev.houwert.argus.core.stores.DesignViewerModel
import dev.houwert.argus.core.stores.FramePoint
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** Over the frame's render: outlines the selected layer with its size, and picks the layer under a tap. */
@Composable
fun DesignLayerOverlay(model: DesignViewerModel, frameWidth: Double, frameHeight: Double, fitted: DpSize, zoom: Float) {
  val theme = ArgusTheme.colors
  val density = LocalDensity.current
  val selectedId by model.selectedLayerId.collectAsState()
  val tree by model.layerTree.collectAsState()
  // Screen dp per frame point.
  val factor = if (frameWidth > 0) fitted.width.value / frameWidth.toFloat() else 0f
  val selected = tree.layer(selectedId)
  val rect = selected?.let(DesignLayerTree::rect)
  Box(
    Modifier.fillMaxSize()
      .semantics { contentDescription = "Tap a layer to inspect it" }
      .pointerInput(factor) {
        detectTapGestures { at ->
          if (factor <= 0f) return@detectTapGestures
          val dp = with(density) { Offset(at.x.toDp().value, at.y.toDp().value) }
          model.select(FramePoint((dp.x / factor).toDouble(), (dp.y / factor).toDouble()))
        }
      }
  ) {
    if (rect != null && factor > 0f) {
      val stroke = 1.5f / zoom.coerceAtLeast(0.01f)
      Canvas(Modifier.fillMaxSize()) {
        val unit = density.density * factor
        drawRect(
          theme.accent, Offset(rect.x.toFloat() * unit, rect.y.toFloat() * unit),
          Size(rect.width.toFloat() * unit, rect.height.toFloat() * unit), style = Stroke(stroke * density.density),
        )
      }
      DesignLayersText.size(selected)?.let { size ->
        Text(
          size,
          Modifier.offset((rect.x.toFloat() * factor).dp, (rect.maxY.toFloat() * factor).dp + 4.dp / zoom)
            .scale(1f / zoom.coerceAtLeast(0.01f))
            .background(theme.accent, RoundedCornerShape(3.dp))
            .padding(horizontal = 4.dp, vertical = 1.dp),
          color = theme.onAccent, style = argusFont(10, FontWeight.SemiBold),
        )
      }
    }
  }
}
