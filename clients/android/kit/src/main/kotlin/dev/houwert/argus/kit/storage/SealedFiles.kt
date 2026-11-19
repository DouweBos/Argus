package dev.houwert.argus.kit.storage

import java.util.concurrent.ConcurrentHashMap

/**
 * Files sealed under a key that never leaves this device. The app seals them
 * with an Android Keystore AES-GCM key; tests use [InMemorySealedFiles].
 */
interface SealedFiles {
  /** A folder inside this one, sealed under the same key. */
  fun folder(name: String): SealedFiles
  fun read(name: String): ByteArray?
  fun write(data: ByteArray, name: String): Boolean
  fun remove(name: String)
  fun names(): List<String>
  fun removeAll()

  companion object {
    /** Only characters safe in a file name survive. */
    fun safeName(name: String): String = name.filter { it.isLetterOrDigit() || it in "-_." }
  }
}

class InMemorySealedFiles private constructor(
  private val root: ConcurrentHashMap<String, ByteArray>,
  private val prefix: String,
) : SealedFiles {
  constructor() : this(ConcurrentHashMap(), "")

  override fun folder(name: String) = InMemorySealedFiles(root, "$prefix${SealedFiles.safeName(name)}/")
  override fun read(name: String) = root["$prefix${SealedFiles.safeName(name)}"]?.copyOf()
  override fun write(data: ByteArray, name: String): Boolean {
    root["$prefix${SealedFiles.safeName(name)}"] = data.copyOf()
    return true
  }
  override fun remove(name: String) { root.remove("$prefix${SealedFiles.safeName(name)}") }
  override fun names() = root.keys.filter { it.startsWith(prefix) }.map { it.removePrefix(prefix) }.filter { '/' !in it }
  override fun removeAll() { root.keys.removeAll { it.startsWith(prefix) } }
}
