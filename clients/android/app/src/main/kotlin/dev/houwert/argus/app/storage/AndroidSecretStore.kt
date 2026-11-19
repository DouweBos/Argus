package dev.houwert.argus.app.storage

import android.content.Context
import dev.houwert.argus.kit.storage.SealedFiles
import dev.houwert.argus.kit.storage.SecretStore
import java.io.File

/** Pairings and other small secrets, each a file sealed with a Keystore AES key, excluded from backups. */
class AndroidSecretStore(context: Context) : SecretStore {
  private val dir = File(context.noBackupFilesDir, "secrets")
  private val cipher = KeystoreCipher("argus.secrets")

  override fun read(account: String): ByteArray? = file(account).takeIf { it.exists() }?.readBytes()?.let(cipher::open)

  override fun write(account: String, data: ByteArray) {
    dir.mkdirs()
    atomicWrite(file(account), cipher.seal(data))
  }

  override fun delete(account: String) {
    file(account).delete()
  }

  private fun file(account: String) = File(dir, SealedFiles.safeName(account))
}

/** Write through a temp file so a crash mid-write never leaves half a file. */
internal fun atomicWrite(target: File, bytes: ByteArray): Boolean = runCatching {
  val tmp = File(target.parentFile, "${target.name}.tmp")
  tmp.writeBytes(bytes)
  if (!tmp.renameTo(target)) {
    target.delete()
    tmp.renameTo(target)
  }
}.isSuccess
