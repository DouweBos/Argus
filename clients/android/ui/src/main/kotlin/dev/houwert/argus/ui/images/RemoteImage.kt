package dev.houwert.argus.ui.images

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import java.net.URI
import okhttp3.OkHttpClient

/**
 * A picture from the web (account photos, Linear avatars), drawn over whatever sits behind it once
 * it loads; nothing while it loads or when it fails, so a fallback underneath stays visible.
 */
@Composable
fun RemoteImage(url: String?, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
  if (!RemoteImages.loadable(url)) return
  AsyncImage(url, null, RemoteImages.loader(LocalContext.current), modifier, contentScale = contentScale)
}

object RemoteImages {
  @Volatile private var shared: ImageLoader? = null

  /** Only https: a cleartext or local URL in a payload is never fetched. */
  fun loadable(url: String?): Boolean {
    if (url.isNullOrBlank()) return false
    val uri = runCatching { URI(url) }.getOrNull() ?: return false
    return uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrEmpty()
  }

  // One loader for the app: its own OkHttp client (no cookies, no gateway credentials) and caches.
  fun loader(context: Context): ImageLoader =
    shared ?: synchronized(this) {
      shared ?: ImageLoader.Builder(context.applicationContext)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { OkHttpClient() })) }
        .crossfade(true)
        .build()
        .also { shared = it }
    }
}
