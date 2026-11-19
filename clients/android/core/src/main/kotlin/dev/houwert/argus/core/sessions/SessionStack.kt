package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteSession

/** Sessions stacked on one another: each child branches from its parent's branch. */
object SessionStack {
  data class Entry(
    val session: RemoteSession,
    /** 0 for a session on the base branch, 1 for one stacked on it, and so on. */
    val depth: Int,
  ) {
    val id: String get() = session.id
  }

  /** An item placed in a list that may split a stack, as the attention sections do. */
  data class Placed<T>(
    val item: T,
    /** Depth under parents in the same list; a child whose parent is elsewhere starts at 0. */
    val depth: Int,
    /** Its parent, when that sits in another list (a different section, folded away). */
    val parentElsewhere: RemoteSession?,
  )

  /** Where stack placement put a session: its depth, and its parent when that's in another list. */
  data class Nesting(val depth: Int, val parentElsewhere: RemoteSession?) {
    /** "On top of …" when its parent is in another list. */
    val caption: String? get() = caption(parentElsewhere)

    companion object {
      val none = Nesting(0, null)
    }
  }

  data class Arranged<T>(val items: List<T>, val nesting: Map<String, Nesting>)

  /**
   * [items] in their order, each stacked one moved under its parent when the parent is in the same
   * list. Items with no session stay where they are.
   */
  fun <T> place(items: List<T>, session: (T) -> RemoteSession?, all: List<RemoteSession> = emptyList()): List<Placed<T>> {
    val ids = items.mapNotNull { session(it)?.id }.toSet()
    val byId = HashMap<String, RemoteSession>()
    for (s in all) byId.putIfAbsent(s.id, s)
    fun parentHere(item: T): String? = session(item)?.parentSessionId?.takeIf { it in ids }
    val children = items.filter { parentHere(it) != null }.groupBy { parentHere(it) ?: "" }
    val index = HashMap<String, Int>()
    items.forEachIndexed { i, item -> session(item)?.let { index.putIfAbsent(it.id, i) } }
    val out = mutableListOf<Placed<T>>()
    val seen = mutableSetOf<Int>()
    fun visit(i: Int, depth: Int) {
      if (!seen.add(i)) return
      val item = items[i]
      val parentId = session(item)?.parentSessionId
      val elsewhere = if (depth == 0) parentId?.let { if (it in ids) null else byId[it] } else null
      out += Placed(item, depth, elsewhere)
      val id = session(item)?.id ?: return
      for (child in children[id].orEmpty()) {
        session(child)?.let { index[it.id] }?.let { visit(it, depth + 1) }
      }
    }
    items.forEachIndexed { i, item -> if (parentHere(item) == null) visit(i, 0) }
    // A parent cycle has no top; keep its sessions rather than drop them.
    for (i in items.indices) if (i !in seen) visit(i, 0)
    return out
  }

  /** [sessions] in their order, every stacked one under its parent; an absent parent leaves its child on top. */
  fun ordered(sessions: List<RemoteSession>): List<Entry> = place(sessions, { it }).map { Entry(it.item, it.depth) }

  /**
   * [items] reordered so stacked sessions follow their parents, with each one's nesting by id.
   * Compare runs group from this order: a compare slot is never stacked, so it keeps its place.
   */
  fun <T> arrange(items: List<T>, session: (T) -> RemoteSession?, all: List<RemoteSession>): Arranged<T> {
    val placed = place(items, session, all)
    val nesting = HashMap<String, Nesting>()
    for (entry in placed) session(entry.item)?.id?.let { nesting[it] = Nesting(entry.depth, entry.parentElsewhere) }
    return Arranged(placed.map { it.item }, nesting)
  }

  /** "On top of …", for a stacked session shown away from its parent. */
  fun caption(parentElsewhere: RemoteSession?): String? =
    parentElsewhere?.let { "On top of ${it.displayName ?: it.branch}" }

  /** How many sessions each one is stacked on, for indenting its row. */
  fun depths(sessions: List<RemoteSession>): Map<String, Int> {
    val out = HashMap<String, Int>()
    for (entry in ordered(sessions)) out.putIfAbsent(entry.id, entry.depth)
    return out
  }

  /** The bottom of the session's stack. */
  fun root(id: String, sessions: List<RemoteSession>): RemoteSession? {
    val byId = HashMap<String, RemoteSession>()
    for (s in sessions) byId.putIfAbsent(s.id, s)
    var current = byId[id] ?: return null
    val seen = mutableSetOf<String>()
    while (true) {
      val parent = current.parentSessionId?.let { byId[it] } ?: break
      if (!seen.add(current.id)) break
      current = parent
    }
    return current
  }

  /** Every session in the same stack as [id], bottom first; empty when it isn't stacked. */
  fun members(id: String, sessions: List<RemoteSession>): List<RemoteSession> {
    val root = root(id, sessions) ?: return emptyList()
    val ordered = ordered(sessions)
    val start = ordered.indexOfFirst { it.id == root.id }
    if (start < 0) return emptyList()
    val members = mutableListOf(ordered[start].session)
    for (entry in ordered.drop(start + 1)) {
      if (entry.depth <= 0) break
      members += entry.session
    }
    return if (members.size > 1) members else emptyList()
  }
}
