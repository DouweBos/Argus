package dev.houwert.argus.app.storage

import android.content.Context
import dev.houwert.argus.kit.storage.SealedFiles
import java.io.File

/** Saved answers and the outbox: files sealed with a Keystore AES key, kept out of backups. */
class AndroidSealedFiles private constructor(private val directory: File, private val cipher: KeystoreCipher) : SealedFiles {
  constructor(context: Context) : this(File(context.noBackupFilesDir, "sealed"), KeystoreCipher("argus.sealed-files"))

  override fun folder(name: String) = AndroidSealedFiles(File(directory, SealedFiles.safeName(name)), cipher)

  override fun read(name: String): ByteArray? = url(name).takeIf { it.isFile }?.readBytes()?.let(cipher::open)

  override fun write(data: ByteArray, name: String): Boolean {
    directory.mkdirs()
    return atomicWrite(url(name), cipher.seal(data))
  }

  override fun remove(name: String) {
    url(name).delete()
  }

  override fun names(): List<String> = directory.list()?.toList().orEmpty()

  override fun removeAll() {
    directory.deleteRecursively()
  }

  private fun url(name: String) = File(directory, SealedFiles.safeName(name))
}
