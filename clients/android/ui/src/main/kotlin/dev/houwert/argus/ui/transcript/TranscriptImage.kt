package dev.houwert.argus.ui.transcript

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.loadImage
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext

/** Decoded images by data URI, so a recycled row doesn't decode again. */
private object DecodedImages {
  private val cache = object : LruCache<String, ImageBitmap>(48 * 1024 * 1024) {
    override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
  }

  fun cached(uri: String): ImageBitmap? = cache.get(uri)

  suspend fun decode(uri: String): ImageBitmap? = cached(uri) ?: withContext(Dispatchers.Default) {
    val bytes = ImageViewerItem.parse(uri)?.first ?: return@withContext null
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()?.also { cache.put(uri, it) }
  }
}

/** This image's data URI from the store's cache, recomposing only when this entry changes. */
@Composable
internal fun rememberCachedImage(host: HostStore, agentKey: String, imageId: String): State<String?> {
  val key = host.imageKey(agentKey, imageId)
  val flow = remember(host, key) { host.imageCache.map { it[key] }.distinctUntilChanged() }
  return flow.collectAsState(host.imageCache.value[key])
}

@Composable
internal fun rememberDecoded(uri: String?): ImageBitmap? {
  val decoded by produceState(uri?.let(DecodedImages::cached), uri) {
    value = uri?.let { DecodedImages.decode(it) }
  }
  return decoded
}

/**
 * A transcript image, fetched lazily by id and cached in the store. [siblings] is the set it
 * belongs to (the message's attachments, or a tool result's images), so opening one pages across them.
 */
@Composable
fun TranscriptImage(imageId: String, modifier: Modifier = Modifier, siblings: List<String>? = null, maxHeight: Dp = 220.dp) {
  val env = transcriptEnvironment
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  val uri by rememberCachedImage(env.host, env.agentKey, imageId)
  val image = rememberDecoded(uri)
  LaunchedEffect(env.agentKey, imageId) { env.host.loadImage(env.agentKey, imageId) }
  if (image != null) {
    val group = siblings ?: listOf(imageId)
    val aspect = if (image.height > 0) image.width.toFloat() / image.height else 1f
    // Capped in width too, so it measures as wide as it draws.
    Image(
      image, "Open image",
      modifier
        .sizeIn(maxWidth = maxHeight * aspect, maxHeight = maxHeight)
        .clip(shape)
        .argusClickable(rememberInteraction(), shape = shape, label = "Open image") {
          env.imageViewer.present(env.agentKey, group, group.indexOf(imageId).coerceAtLeast(0))
        },
      contentScale = ContentScale.Fit,
    )
  } else {
    Box(
      modifier.size(width = maxHeight, height = minOf(80.dp, maxHeight)).clip(shape).background(theme.bgHover),
      contentAlignment = Alignment.Center,
    ) {
      CircularProgressIndicator(Modifier.size(16.dp), color = theme.textMuted, strokeWidth = 2.dp)
    }
  }
}
