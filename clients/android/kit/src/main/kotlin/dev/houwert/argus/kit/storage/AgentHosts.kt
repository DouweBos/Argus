package dev.houwert.argus.kit.storage

import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

/**
 * Which computer owns which agent. A push carries only an agent id; without this map, tapping one
 * while connected to another computer opens an empty transcript on the wrong machine.
 */
class AgentHostIndex(private val preferences: Preferences) {
  private val serializer = MapSerializer(String.serializer(), String.serializer())

  private fun load(): Map<String, String> = preferences.decode(PreferenceKey.AGENT_HOSTS, serializer) ?: emptyMap()

  fun host(agentId: String): String? = load()[agentId]

  fun remember(agentIds: List<String>, hostId: String) {
    val map = load().toMutableMap()
    for (id in agentIds) map[id] = hostId
    if (map.size > MAX_ENTRIES) {
      // Nothing here is ordered, so trim arbitrarily rather than pretend to an LRU; a miss costs one lookup.
      map.keys.take(map.size - MAX_ENTRIES).forEach(map::remove)
    }
    preferences.encode(map, serializer, PreferenceKey.AGENT_HOSTS)
  }

  fun forget(hostId: String) {
    preferences.encode(load().filterValues { it != hostId }, serializer, PreferenceKey.AGENT_HOSTS)
  }

  companion object {
    const val MAX_ENTRIES = 300
  }
}
