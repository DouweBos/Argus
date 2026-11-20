package dev.houwert.argus.app.platform

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import dev.houwert.argus.kit.crypto.ArgusBase64
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.util.SharedPrompt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/** What another app shared into Argus: the composer's opening draft and its images. */
data class SharedItems(val draft: String, val images: List<RemoteImageAttachment>, val hasLink: Boolean, val hasText: Boolean) {
  val isEmpty: Boolean get() = draft.isBlank() && images.isEmpty()
}

/**
 * The share target: Android's counterpart of the iPhone's share extension. Shares land in the
 * app itself, so the new-agent composer picks the computer and project as it always does and
 * takes the shared items as its draft with [take].
 */
object ShareIntake {
  private const val MAX_IMAGES = 5
  /** Past this the gateway refuses the message anyway; a screenshot is far below it. */
  private const val MAX_IMAGE_BYTES = 8 * 1024 * 1024

  private val _pending = MutableStateFlow<SharedItems?>(null)
  /** A share waiting for the composer, so it can show it before taking it. */
  val pending: StateFlow<SharedItems?> = _pending.asStateFlow()

  /** The composer takes the shared items once, as its opening draft. */
  fun take(): SharedItems? = _pending.value.also { _pending.value = null }

  fun isShare(intent: Intent): Boolean = intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE

  suspend fun receive(intent: Intent, resolver: ContentResolver): SharedItems? {
    val texts = listOfNotNull(intent.getStringExtra(Intent.EXTRA_TEXT), intent.getStringExtra(Intent.EXTRA_SUBJECT)?.takeIf { intent.getStringExtra(Intent.EXTRA_TEXT) == null })
    val uris = streams(intent)
    val images = withContext(Dispatchers.IO) { uris.take(MAX_IMAGES).mapNotNull { image(it, resolver) } }
    val items = SharedItems(
      draft = SharedPrompt.draft(emptyList(), texts),
      images = images,
      hasLink = texts.any(SharedPrompt::isLink),
      hasText = texts.any { !SharedPrompt.isLink(it) && it.isNotBlank() },
    )
    if (items.isEmpty) return null
    _pending.value = items
    return items
  }

  private fun streams(intent: Intent): List<Uri> = if (Build.VERSION.SDK_INT >= 33) {
    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
      ?: listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java))
  } else {
    @Suppress("DEPRECATION")
    intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM))
  }

  private fun image(uri: Uri, resolver: ContentResolver): RemoteImageAttachment? = runCatching {
    val type = resolver.getType(uri)?.takeIf { it.startsWith("image/") } ?: return null
    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    if (bytes.size > MAX_IMAGE_BYTES) return null
    RemoteImageAttachment(ArgusBase64.encode(bytes), type)
  }.getOrNull()
}
