package dev.houwert.argus.core.devices

import kotlin.math.max
import kotlin.math.min

data class DSize(val width: Double, val height: Double) {
  companion object { val Zero = DSize(0.0, 0.0) }
}

data class DPoint(val x: Double, val y: Double)

data class DRect(val x: Double, val y: Double, val width: Double, val height: Double) {
  val maxX get() = x + width
  val maxY get() = y + height
  fun contains(point: DPoint) = point.x >= x && point.x < maxX && point.y >= y && point.y < maxY
}

/**
 * Where a device's picture sits in a view and how a point there maps back onto
 * the device. The framebuffer is panel-native, so a rotated device arrives
 * sideways and is turned [rotation] degrees clockwise to sit upright.
 */
data class DeviceGeometry(val coded: DSize, val stage: DSize, val rotation: Double = 0.0) {
  private val quarterTurn get() = rotation == 90.0 || rotation == 270.0
  private val known get() = coded.width > 0 && coded.height > 0 && stage.width > 0 && stage.height > 0

  /** The stream's footprint on screen, axes swapped on a quarter turn. */
  val shown: DSize get() = if (quarterTurn) DSize(coded.height, coded.width) else coded

  private val scale get() = min(stage.width / shown.width, stage.height / shown.height)

  /** The video's size before rotation; the stage until the first config lands. */
  val renderedSize: DSize get() = if (!known) stage else DSize(coded.width * scale, coded.height * scale)

  /** The upright picture's rect in the stage. */
  val pictureRect: DRect get() {
    if (!known) return DRect(0.0, 0.0, stage.width, stage.height)
    val w = shown.width * scale
    val h = shown.height * scale
    return DRect((stage.width - w) / 2, (stage.height - h) / 2, w, h)
  }

  /** A stage point to 0–1 device panel coordinates, clamped to the picture; null until the size is known. */
  fun normalize(point: DPoint): DPoint? {
    if (!known) return null
    val rect = pictureRect
    val x = min(max(0.0, (point.x - rect.x) / rect.width), 0.9999)
    val y = min(max(0.0, (point.y - rect.y) / rect.height), 0.9999)
    return unrotate(DPoint(x, y))
  }

  /** A stage point to 0–1 across the upright picture; null outside it. */
  fun uprightNormalize(point: DPoint): DPoint? {
    if (!known) return null
    val rect = pictureRect
    if (!rect.contains(point)) return null
    return DPoint((point.x - rect.x) / rect.width, (point.y - rect.y) / rect.height)
  }

  fun uprightRect(unit: DRect): DRect {
    val rect = pictureRect
    return DRect(rect.x + unit.x * rect.width, rect.y + unit.y * rect.height, unit.width * rect.width, unit.height * rect.height)
  }

  /** Undo the presentation rotation: the device wants its own panel's coordinates. */
  fun unrotate(point: DPoint): DPoint = when (rotation) {
    90.0 -> DPoint(point.y, 1 - point.x)
    180.0 -> DPoint(1 - point.x, 1 - point.y)
    270.0 -> DPoint(1 - point.y, point.x)
    else -> point
  }
}
