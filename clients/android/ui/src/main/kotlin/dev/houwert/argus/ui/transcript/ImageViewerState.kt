package dev.houwert.argus.ui.transcript

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * One full-screen image presenter per transcript. Holds image ids, not decoded images: a message
 * can carry several and only the tapped one is surely loaded, so the pager resolves the rest as you reach them.
 */
@Stable
class ImageViewerState {
  var agentKey by mutableStateOf("")
    private set
  var imageIds by mutableStateOf(emptyList<String>())
    private set
  var current by mutableStateOf<String?>(null)

  val isPresented: Boolean get() = current != null

  fun present(agentKey: String, imageIds: List<String>, at: Int) {
    if (at !in imageIds.indices) return
    this.agentKey = agentKey
    this.imageIds = imageIds
    current = imageIds[at]
  }

  fun dismiss() {
    current = null
    imageIds = emptyList()
  }

  val currentIndex: Int? get() = current?.let { imageIds.indexOf(it).takeIf { i -> i >= 0 } }

  /** "2 of 3", or null for a lone image. */
  val positionLabel: String?
    get() {
      val index = currentIndex ?: return null
      return if (imageIds.size > 1) "${index + 1} of ${imageIds.size}" else null
    }

  /** Step to the next image, wrapping; false when there is nowhere to go. */
  fun next(): Boolean = page(1)

  fun previous(): Boolean = page(-1)

  private fun page(step: Int): Boolean {
    val index = currentIndex ?: return false
    if (imageIds.size < 2) return false
    current = imageIds[(index + step + imageIds.size) % imageIds.size]
    return true
  }
}
