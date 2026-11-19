package dev.houwert.argus.kit.storage

import java.util.concurrent.ConcurrentHashMap
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json

/** Non-secret preference keys; the same names as the iPhone app's. */
object PreferenceKey {
  const val DEVICE_NAME = "device.name"
  const val THEME = "argus.theme"
  const val COLOR_THEME = "argus.colorTheme"
  const val PUSH_ENABLED = "push.enabled"
  const val AUTO_EXPAND_IMAGE_READS = "transcript.autoExpandImageReads"
  const val DEFAULT_PERMISSION_MODE = "agent.defaultPermissionMode"
  /** The project the last Linear issue was started in. */
  const val ISSUE_START_PROJECT = "issue.startProject"
  const val PUSH_TOKEN = "push.token"
  /** Join requests a wake-up push already announced, so each is shown once. */
  const val ACCOUNT_PROMPTED_JOINS = "account.promptedJoins"
  const val AGENT_HOSTS = "agent.hosts"
  const val PENDING_DECISIONS = "permission.pending"
  const val TELEMETRY_ID = "telemetry.id"
  const val TELEMETRY_MODE = "telemetry.mode"
  const val TELEMETRY_CONSENT_SEEN = "telemetry.consent.seen"

  fun draft(agentId: String) = "argus.draft.$agentId"
  fun linkedProjects(agentId: String) = "argus.linked.$agentId"
}

/**
 * A synchronous string key/value store. The app backs it with DataStore
 * (cached in memory, written through); tests use [InMemoryKeyValueStore].
 */
interface KeyValueStore {
  fun string(key: String): String?
  fun set(key: String, value: String?)
}

class InMemoryKeyValueStore : KeyValueStore {
  private val values = ConcurrentHashMap<String, String>()
  override fun string(key: String): String? = values[key]
  override fun set(key: String, value: String?) {
    if (value == null) values.remove(key) else values[key] = value
  }
}

/** Typed access over a [KeyValueStore]; structured values are stored as JSON. */
class Preferences(val store: KeyValueStore) {
  fun string(key: String): String? = store.string(key)
  fun set(value: String?, key: String) = store.set(key, value)
  fun remove(key: String) = store.set(key, null)

  fun bool(key: String): Boolean? = store.string(key)?.toBooleanStrictOrNull()
  fun set(value: Boolean, key: String) = store.set(key, value.toString())

  fun <T> decode(key: String, serializer: KSerializer<T>): T? =
    store.string(key)?.let { runCatching { json.decodeFromString(serializer, it) }.getOrNull() }

  fun <T> encode(value: T, serializer: KSerializer<T>, key: String) = store.set(key, json.encodeToString(serializer, value))

  companion object {
    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
  }
}
