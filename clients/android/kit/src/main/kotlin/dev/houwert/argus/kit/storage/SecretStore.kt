package dev.houwert.argus.kit.storage

import java.util.concurrent.ConcurrentHashMap

/**
 * Small secrets kept on this device only (the Swift Keychain items). The app
 * backs it with an Android Keystore key; tests use [InMemorySecretStore].
 */
interface SecretStore {
  fun read(account: String): ByteArray?
  fun write(account: String, data: ByteArray)
  fun delete(account: String)
}

class InMemorySecretStore : SecretStore {
  private val items = ConcurrentHashMap<String, ByteArray>()
  override fun read(account: String): ByteArray? = items[account]?.copyOf()
  override fun write(account: String, data: ByteArray) { items[account] = data.copyOf() }
  override fun delete(account: String) { items.remove(account) }
}
