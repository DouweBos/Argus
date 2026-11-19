package dev.houwert.argus.app.gallery

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dev.houwert.argus.ui.gallery.ArgusGallery
import dev.houwert.argus.ui.gallery.GalleryPage

/**
 * The design-system gallery as its own launcher entry in debug builds. Extras pick the start:
 * `dark` (boolean) and `page` (a [GalleryPage] name), e.g. `am start -n … --ez dark true --es page Lists`.
 */
class GalleryActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val dark = intent.getBooleanExtra("dark", false)
    val page = GalleryPage.entries.firstOrNull { it.name == intent.getStringExtra("page") } ?: GalleryPage.Tokens
    setContent { ArgusGallery(initialDark = dark, initialPage = page) }
  }
}
