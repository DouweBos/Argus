package dev.houwert.argus.ui.composer

import android.content.ContentResolver
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The images and files waiting to go out, each with a remove badge. */
@Composable
fun PhoneAttachmentStrip(
  images: List<PendingImage>,
  files: List<PendingFile>,
  onRemoveImage: (String) -> Unit,
  onRemoveFile: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  Row(
    modifier.horizontalScroll(rememberScrollState()).padding(top = 6.dp, end = 6.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    for (image in images) {
      Box {
        ImageThumbnail(image, Modifier.size(56.dp))
        RemoveBadge("Remove image", Modifier.align(Alignment.TopEnd)) { onRemoveImage(image.id) }
      }
    }
    for (file in files) {
      Box {
        PendingFileChip(file)
        RemoveBadge("Remove ${file.name}", Modifier.align(Alignment.TopEnd)) { onRemoveFile(file.id) }
      }
    }
  }
}

/** A pending image's preview, decoded once from the bytes that will be sent. */
@Composable
internal fun ImageThumbnail(image: PendingImage, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val bitmap = remember(image.id) {
    ImageAttachments.decode(image.attachment)?.let { bytes ->
      val options = BitmapFactory.Options().apply { inSampleSize = 4 }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
    }
  }
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  if (bitmap != null) {
    Image(bitmap, "Attached image", modifier.clip(shape), contentScale = ContentScale.Crop)
  } else {
    Box(modifier.clip(shape).background(theme.bgTertiary), contentAlignment = Alignment.Center) {
      Icon(Icon.image, "Attached image", Modifier.size(20.dp), tint = theme.textMuted)
    }
  }
}

@Composable
private fun RemoveBadge(label: String, modifier: Modifier, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  // A finger-sized target around a small badge, overhanging the corner.
  Box(
    modifier.offset(x = 10.dp, y = (-10).dp).size(28.dp).argusClickable(interaction, shape = CircleShape, label = label, onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Box(Modifier.size(18.dp).background(theme.accent, CircleShape), contentAlignment = Alignment.Center) {
      Icon(Icon.close, label, Modifier.size(11.dp), tint = theme.onAccent)
    }
  }
}

/**
 * The attach button's menu, photo library, camera or a file, and the system pickers it opens.
 * Images join the image path; any other file uploads into the session as a mention.
 */
@Composable
fun PhoneAttachMenu(
  expanded: Boolean,
  onDismiss: () -> Unit,
  onAttach: (List<PendingImage>) -> Unit,
  onAttachFiles: (List<PickedFile>) -> Unit,
) {
  val theme = ArgusTheme.colors
  val resolver = LocalContext.current.contentResolver
  val scope = rememberCoroutineScope()
  val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris ->
    if (uris.isNotEmpty()) scope.launch { onAttach(readImages(resolver, uris)) }
  }
  // A preview bitmap needs no FileProvider; a full-size photo would.
  val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
    bitmap?.let(ImageAttachments::pending)?.let { onAttach(listOf(it)) }
  }
  val documents = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
    if (uris.isEmpty()) return@rememberLauncherForActivityResult
    scope.launch {
      val (images, others) = withContext(Dispatchers.IO) { uris.partition { isImage(resolver, it) } }
      if (images.isNotEmpty()) onAttach(readImages(resolver, images))
      if (others.isNotEmpty()) onAttachFiles(withContext(Dispatchers.IO) { others.map { pickedFile(resolver, it) } })
    }
  }
  DropdownMenu(expanded, onDismiss, containerColor = theme.surface) {
    AttachItem("Photo library", Icon.image) {
      onDismiss()
      photos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }
    AttachItem("Take photo", Icon.camera) {
      onDismiss()
      runCatching { camera.launch(null) }
    }
    AttachItem("Choose file", Icon.file) {
      onDismiss()
      documents.launch(arrayOf("*/*"))
    }
  }
}

@Composable
private fun AttachItem(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  DropdownMenuItem(
    text = { Text(label, color = theme.text, style = argusFont(15)) },
    leadingIcon = { Icon(icon, null, Modifier.size(18.dp), tint = theme.textSecondary) },
    onClick = onClick,
  )
}

private fun isImage(resolver: ContentResolver, uri: Uri) = resolver.getType(uri)?.startsWith("image/") == true

/** Reads picked images off the main thread; one that can't be read is skipped. */
internal suspend fun readImages(resolver: ContentResolver, uris: List<Uri>): List<PendingImage> = withContext(Dispatchers.IO) {
  uris.mapNotNull { uri ->
    runCatching { resolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()?.let { ImageAttachments.pending(it) }
  }
}

private fun pickedFile(resolver: ContentResolver, uri: Uri): PickedFile {
  var name = uri.lastPathSegment ?: "file"
  var size = 0L
  resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
    if (cursor.moveToFirst()) {
      cursor.getString(0)?.let { name = it }
      if (!cursor.isNull(1)) size = cursor.getLong(1)
    }
  }
  return PickedFile(name, size) { runCatching { resolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() }
}
