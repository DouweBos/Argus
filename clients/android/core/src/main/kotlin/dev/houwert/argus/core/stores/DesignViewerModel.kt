package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.crypto.ArgusBase64
import dev.houwert.argus.kit.protocol.generated.DesignComparison
import dev.houwert.argus.kit.protocol.generated.FigmaFrameDetails
import dev.houwert.argus.kit.protocol.generated.FigmaLayer
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import java.net.URI
import java.net.URLDecoder
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Figma links the design viewer opens in place of the browser. */
object FigmaLink {
  /** A figma.com design, file or prototype link. */
  fun isDesign(raw: String): Boolean {
    val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return false
    val host = uri.host?.lowercase() ?: return false
    if (host != "figma.com" && !host.endsWith(".figma.com")) return false
    val first = uri.path.orEmpty().split('/').firstOrNull { it.isNotEmpty() }
    return first in setOf("design", "file", "proto")
  }
}

/** A device the computer can screenshot for a compare. */
data class DesignCompareTarget(val platform: RemotePlatform, val deviceKey: String, val name: String) {
  val id: String get() = "${platform.rawValue}:$deviceKey"
}

/**
 * One Figma frame in the design viewer: its render, layers, comments and the file's other frames
 * to move to, plus a compare against a device. Mutate from the store's (main) dispatcher.
 */
class DesignViewerModel(
  url: String,
  /** The file version the session captured the frame at; null outside a session. */
  val sessionVersion: String? = null,
  private val host: HostStore,
) {
  enum class SelectionSource(val raw: String) { Canvas("canvas"), Tree("tree") }

  private val _url = MutableStateFlow(url)
  val url: StateFlow<String> = _url.asStateFlow()
  private val _details = MutableStateFlow<FigmaFrameDetails?>(null)
  val details: StateFlow<FigmaFrameDetails?> = _details.asStateFlow()
  /** The frame as PNG bytes, decoded once. */
  private val _image = MutableStateFlow<ByteArray?>(null)
  val image: StateFlow<ByteArray?> = _image.asStateFlow()
  private val _loadError = MutableStateFlow<String?>(null)
  val loadError: StateFlow<String?> = _loadError.asStateFlow()
  private val _comparison = MutableStateFlow<DesignComparison?>(null)
  val comparison: StateFlow<DesignComparison?> = _comparison.asStateFlow()
  private val _comparing = MutableStateFlow(false)
  val comparing: StateFlow<Boolean> = _comparing.asStateFlow()
  private val _compareError = MutableStateFlow<String?>(null)
  val compareError: StateFlow<String?> = _compareError.asStateFlow()
  /** Frames visited before this one, to step back to. */
  private val _history = MutableStateFlow(emptyList<String>())
  val history: StateFlow<List<String>> = _history.asStateFlow()
  private val _layerTree = MutableStateFlow(DesignLayerTree.Empty)
  val layerTree: StateFlow<DesignLayerTree> = _layerTree.asStateFlow()
  private val _selectedLayerId = MutableStateFlow<String?>(null)
  val selectedLayerId: StateFlow<String?> = _selectedLayerId.asStateFlow()
  /** Layers whose children the list hides. */
  private val _collapsed = MutableStateFlow(emptySet<String>())
  val collapsed: StateFlow<Set<String>> = _collapsed.asStateFlow()

  /** Called on the first layer picked in each frame, to measure the feature. */
  var onFirstSelection: ((SelectionSource) -> Unit)? = null
  private var selectedOnce = false

  /** The designer has published a newer version of the file since the session started. */
  val designChanged: Boolean
    get() {
      val current = _details.value?.file?.version ?: return false
      return sessionVersion != null && sessionVersion != current
    }

  /** Epoch milliseconds of the file's last edit. */
  val lastModified: Double? get() = _details.value?.file?.lastModified

  /** Share of differing pixels as a whole percentage, for the compare's label. */
  val differingPercent: Int? get() = _comparison.value?.let { (it.differingFraction * 100).roundToInt() }

  suspend fun load() {
    val asked = _url.value
    try {
      val found = host.figmaFrameDetails(asked)
      if (asked != _url.value) return
      _details.value = found
      _layerTree.value = DesignLayerTree(found?.layers.orEmpty())
      _image.value = found?.let { ArgusBase64.decode(it.frame.image) }
      _loadError.value = if (found == null) "Figma couldn't render this link. Open a frame link, with node-id in it." else null
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      if (asked != _url.value) return
      _loadError.value = HostStore.describe(e)
    }
  }

  /** Another frame of the file, keeping this one to step back to. */
  suspend fun open(frameUrl: String) {
    if (frameUrl == _url.value) return
    _history.value = _history.value + _url.value
    show(frameUrl)
  }

  suspend fun back() {
    val previous = _history.value.lastOrNull() ?: return
    _history.value = _history.value.dropLast(1)
    show(previous)
  }

  suspend fun compare(target: DesignCompareTarget) {
    _comparing.value = true
    val asked = _url.value
    try {
      val result = host.compareDesign(asked, target.platform, target.deviceKey)
      if (asked != _url.value) return
      _comparison.value = result
      _compareError.value = null
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      if (asked != _url.value) return
      _compareError.value = HostStore.describe(e)
    } finally {
      _comparing.value = false
    }
  }

  fun clearComparison() {
    _comparison.value = null
    _compareError.value = null
  }

  val selectedLayer: FigmaLayer? get() = _layerTree.value.layer(_selectedLayerId.value)

  /** Picks a layer, opening its ancestors in the list; null clears. */
  fun select(id: String?, source: SelectionSource) {
    _selectedLayerId.value = id
    if (id == null) return
    _collapsed.value = _collapsed.value - _layerTree.value.ancestors(id).toSet()
    if (!selectedOnce) {
      selectedOnce = true
      onFirstSelection?.invoke(source)
    }
  }

  /** Picks the layer under `point` in frame points; empty space clears. */
  fun select(point: FramePoint) = select(_layerTree.value.hit(point)?.id, SelectionSource.Canvas)

  fun toggleCollapsed(id: String) {
    _collapsed.value = if (id in _collapsed.value) _collapsed.value - id else _collapsed.value + id
  }

  /** Whether `frameUrl` is the frame on screen, for marking it in the file's outline. */
  fun isCurrent(frameUrl: String): Boolean {
    val nodeId = _details.value?.ref?.nodeId ?: return false
    return nodeId(frameUrl) == nodeId
  }

  private suspend fun show(next: String) {
    _url.value = next
    _details.value = null
    _image.value = null
    _layerTree.value = DesignLayerTree.Empty
    _selectedLayerId.value = null
    _collapsed.value = emptySet()
    selectedOnce = false
    _loadError.value = null
    clearComparison()
    load()
  }

  companion object {
    /** The file version `session` captured `url`'s frame at; its first frame's when the link isn't one of its own. */
    fun sessionVersion(url: String, session: RemoteSession): String? =
      session.designRefs?.firstOrNull { it.url == url }?.version ?: session.designRefs?.firstOrNull()?.version

    /** `1:2` from a link's `node-id=1-2`. */
    internal fun nodeId(raw: String): String? {
      val query = runCatching { URI(raw).rawQuery }.getOrNull() ?: return null
      return query.split('&')
        .map { it.split('=', limit = 2) }
        .firstOrNull { it[0] == "node-id" }
        ?.getOrNull(1)
        ?.let { URLDecoder.decode(it, "UTF-8") }
        ?.replace('-', ':')
    }
  }
}
