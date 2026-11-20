package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.FigmaLayer

/** A point in frame points. */
data class FramePoint(val x: Double, val y: Double)

/** A rectangle in frame points. */
data class FrameRect(val x: Double, val y: Double, val width: Double, val height: Double) {
  val maxX: Double get() = x + width
  val maxY: Double get() = y + height

  /** Half-open, like CoreGraphics: the far edges belong to the next rectangle. */
  fun contains(point: FramePoint): Boolean = point.x >= x && point.x < maxX && point.y >= y && point.y < maxY
}

/** A frame's flattened layers, read back as the tree they were flattened from. */
class DesignLayerTree(val layers: List<FigmaLayer>) {
  /** Each layer's parent's index; null for the root. */
  private val parents: List<Int?>
  private val indexById: Map<String, Int>

  init {
    val parents = mutableListOf<Int?>()
    val stack = ArrayDeque<Int>()
    layers.forEachIndexed { index, layer ->
      while (stack.isNotEmpty() && layers[stack.last()].depth >= layer.depth) stack.removeLast()
      parents += stack.lastOrNull()
      stack.addLast(index)
    }
    this.parents = parents
    val byId = mutableMapOf<String, Int>()
    layers.forEachIndexed { index, layer -> byId.putIfAbsent(layer.id, index) }
    indexById = byId
  }

  fun layer(id: String?): FigmaLayer? = id?.let { indexById[it] }?.let { layers[it] }

  fun hasChildren(id: String): Boolean {
    val index = indexById[id] ?: return false
    return index + 1 < layers.size && parents[index + 1] == index
  }

  /** Every layer above `id`, nearest first. */
  fun ancestors(id: String): List<String> {
    val found = mutableListOf<String>()
    var cursor = indexById[id]?.let { parents[it] }
    while (cursor != null) {
      found += layers[cursor].id
      cursor = parents[cursor]
    }
    return found
  }

  /** The rows left showing once `collapsed` layers hide their descendants. */
  fun visible(collapsed: Set<String>): List<FigmaLayer> {
    val rows = mutableListOf<FigmaLayer>()
    var hiddenBelow: Double? = null
    for (layer in layers) {
      val depth = hiddenBelow
      if (depth != null) {
        if (layer.depth > depth) continue
        hiddenBelow = null
      }
      rows += layer
      if (layer.id in collapsed) hiddenBelow = layer.depth
    }
    return rows
  }

  /** The deepest, topmost layer under `point`, as Figma's command-click picks it. Later rows draw over earlier ones. */
  fun hit(point: FramePoint): FigmaLayer? = layers.lastOrNull { rect(it)?.contains(point) ?: false }

  companion object {
    val Empty = DesignLayerTree(emptyList())

    /** Where a layer sits in frame points, when the host sent its position. */
    fun rect(layer: FigmaLayer): FrameRect? {
      val x = layer.x ?: return null
      val y = layer.y ?: return null
      val width = layer.width ?: return null
      val height = layer.height ?: return null
      return FrameRect(x, y, width, height)
    }
  }
}
