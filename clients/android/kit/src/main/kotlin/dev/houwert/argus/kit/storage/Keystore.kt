package dev.houwert.argus.kit.storage

import kotlinx.serialization.json.Json

/**
 * This device's pairings, sealed in a [SecretStore]. Several computers can be
 * paired; one is active at a time, and unpairing one never touches another.
 */
class Keystore(private val secrets: SecretStore) {
  private val lock = Any()

  fun load(): PairedHosts = synchronized(lock) {
    val data = secrets.read(ACCOUNT) ?: return PairedHosts()
    runCatching { json.decodeFromString(PairedHosts.serializer(), data.decodeToString()) }.getOrDefault(PairedHosts())
  }

  fun save(state: PairedHosts) = synchronized(lock) {
    secrets.write(ACCOUNT, json.encodeToString(PairedHosts.serializer(), state).encodeToByteArray())
  }

  /** Add (or re-pair) a computer and make it the active one. */
  fun add(identity: DeviceIdentity): PairedHosts = mutate { it.adding(identity) }

  fun remove(deviceId: String): PairedHosts = mutate { it.removing(deviceId) }

  fun setActive(deviceId: String?): PairedHosts = mutate { it.copy(activeId = deviceId) }

  fun update(deviceId: String, patch: (DeviceIdentity) -> DeviceIdentity): PairedHosts = mutate { it.updating(deviceId, patch) }

  /** Another secret under this store, e.g. the account keys. */
  fun readItem(account: String): ByteArray? = secrets.read(account)
  fun writeItem(data: ByteArray, account: String) = secrets.write(account, data)
  fun deleteItem(account: String) = secrets.delete(account)

  private fun mutate(change: (PairedHosts) -> PairedHosts): PairedHosts = synchronized(lock) {
    val next = change(load())
    save(next)
    next
  }

  companion object {
    const val ACCOUNT = "argus.hosts"
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
  }
}
