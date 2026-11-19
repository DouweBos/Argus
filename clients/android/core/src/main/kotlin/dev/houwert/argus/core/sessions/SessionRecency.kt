package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteSession

/**
 * Newest message first. A compare run sorts by its newest slot and a stack by its newest session,
 * so each stays together; sessions with no message keep their order, last.
 */
object SessionRecency {
  fun <T> sorted(items: List<T>, session: (T) -> RemoteSession?): List<T> {
    val sessions = items.map(session)
    val byId = HashMap<String, RemoteSession>()
    for (s in sessions) if (s != null) byId.putIfAbsent(s.id, s)
    // A run, else the bottom of its stack in this list, else itself.
    fun unit(index: Int): String {
      val s = sessions[index] ?: return "item:$index"
      s.compareGroup?.id?.let { return "run:$it" }
      var current = s
      val seen = mutableSetOf(s.id)
      while (true) {
        val parent = current.parentSessionId?.let { byId[it] } ?: break
        if (!seen.add(parent.id)) break
        current = parent
      }
      return current.id
    }
    val units = items.indices.map(::unit)
    val newest = HashMap<String, Double>()
    val first = HashMap<String, Int>()
    units.forEachIndexed { index, key ->
      first.putIfAbsent(key, index)
      sessions[index]?.lastMessageAt?.let { at -> newest[key] = maxOf(newest[key] ?: at, at) }
    }
    val order = items.indices.sortedWith { a, b ->
      val x = newest[units[a]]
      val y = newest[units[b]]
      when {
        x != null && y != null && x != y -> y.compareTo(x)
        x != null && y == null -> -1
        x == null && y != null -> 1
        else -> {
          val fa = first[units[a]] ?: a
          val fb = first[units[b]] ?: b
          if (fa != fb) fa.compareTo(fb) else a.compareTo(b)
        }
      }
    }
    return order.map { items[it] }
  }

  fun sorted(sessions: List<RemoteSession>): List<RemoteSession> = sorted(sessions) { it }
}
