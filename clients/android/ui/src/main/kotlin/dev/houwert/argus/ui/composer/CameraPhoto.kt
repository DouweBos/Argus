package dev.houwert.argus.ui.composer

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageDecoder
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

/** A full-size composer photo: a cache file the camera app writes, read back upright. */
internal object CameraPhoto {
  fun allowed(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

  fun newFile(context: Context): File =
    File(context.cacheDir, "camera").apply { mkdirs() }.resolve("${UUID.randomUUID()}.jpg")

  fun uri(context: Context, file: File): Uri =
    FileProvider.getUriForFile(context, "${context.packageName}.argus.camera", file)

  /** ImageDecoder applies the EXIF rotation, so the photo goes out the way it was held. */
  fun read(file: File): PendingImage? = runCatching {
    val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, _, _ ->
      decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
    }
    ImageAttachments.pending(bitmap).also { bitmap.recycle() }
  }.getOrNull()
}
