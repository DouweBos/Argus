package dev.houwert.argus.ui.transcript

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/** Serves the image viewer's shared files, read-only, to whoever the share sheet hands them to. */
class SharedImageProvider : ContentProvider() {
  override fun onCreate() = true

  private fun file(uri: Uri): File {
    val name = uri.lastPathSegment ?: throw FileNotFoundException()
    val dir = directory(context ?: throw FileNotFoundException())
    // Only a plain name inside the share directory; no path tricks.
    return dir.resolve(name).takeIf { it.parentFile == dir && it.exists() } ?: throw FileNotFoundException()
  }

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
    ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY)

  override fun getType(uri: Uri): String = when (uri.lastPathSegment?.substringAfterLast('.')) {
    "jpg", "jpeg" -> "image/jpeg"
    "gif" -> "image/gif"
    "webp" -> "image/webp"
    else -> "image/png"
  }

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
    val file = file(uri)
    return MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)).apply { addRow(arrayOf(file.name, file.length())) }
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0
  override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0

  companion object {
    fun directory(context: Context): File = File(context.cacheDir, "shared-images").apply { mkdirs() }

    fun uri(context: Context, file: File): Uri =
      Uri.Builder().scheme("content").authority("${context.packageName}.argus.images").appendPath(file.name).build()
  }
}
