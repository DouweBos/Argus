package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.LinearComment
import dev.houwert.argus.kit.protocol.generated.LinearHistoryEvent
import dev.houwert.argus.kit.protocol.generated.LinearHistoryEventKind
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailRelationsItem

/**
 * An issue's activity the way Linear lays it out: comment threads as cards, history as one-line
 * events, long runs of events folded into "Show N events".
 */
object LinearIssueActivity {
  /** A top-level comment and its replies, oldest first. */
  data class Thread(val root: LinearComment, val replies: List<LinearComment>) {
    val id: String get() = root.id ?: "${root.createdAt}-${root.author ?: ""}"
    /** What a reply in this thread hangs off; null when Linear didn't say. */
    val replyTarget: String? get() = root.id
  }

  sealed interface Item {
    val id: String

    data class Event(val event: LinearHistoryEvent) : Item {
      override val id: String get() = "e-${event.id}"
    }

    /** Events folded away until asked for; `id` is the first one's. */
    data class Folded(val events: List<LinearHistoryEvent>) : Item {
      override val id: String get() = "f-${events.firstOrNull()?.id ?: ""}"
    }

    data class ThreadItem(val thread: Thread) : Item {
      override val id: String get() = "t-${thread.id}"
    }
  }

  /** Comments grouped under their thread's first comment. A reply whose parent isn't here starts its own thread. */
  fun threads(comments: List<LinearComment>): List<Thread> {
    val sorted = comments.sortedBy { it.createdAt }
    val ids = sorted.mapNotNull { it.id }.toSet()
    val parentOf = sorted.mapNotNull { c -> c.id?.let { id -> c.parentId?.let { id to it } } }.toMap()
    fun root(comment: LinearComment): String? {
      var current = comment.parentId
      val seen = mutableSetOf<String>()
      while (current != null && current in ids && seen.add(current)) {
        current = parentOf[current] ?: return current
      }
      return null
    }
    val replies = mutableMapOf<String, MutableList<LinearComment>>()
    val roots = mutableListOf<LinearComment>()
    for (comment in sorted) {
      val rootId = root(comment)
      if (rootId != null) replies.getOrPut(rootId) { mutableListOf() } += comment else roots += comment
    }
    return roots.map { Thread(it, it.id?.let { id -> replies[id] }.orEmpty()) }
  }

  /** Events and threads in one timeline, oldest first. A run of more than `foldAbove` events keeps its first and last two. */
  fun timeline(history: List<LinearHistoryEvent>, comments: List<LinearComment>, foldAbove: Int = 4): List<Item> {
    val merged = history.map { it.createdAt to (Item.Event(it) as Item) } + threads(comments).map { it.root.createdAt to Item.ThreadItem(it) }
    // sortedBy is stable: an event and a comment at the same instant keep event-first.
    val ordered = merged.sortedBy { it.first }.map { it.second }

    val out = mutableListOf<Item>()
    val run = mutableListOf<LinearHistoryEvent>()
    fun flush() {
      if (run.size > foldAbove) {
        out += Item.Event(run[0])
        out += Item.Folded(run.subList(1, run.size - 2).toList())
        out += run.takeLast(2).map { Item.Event(it) }
      } else {
        out += run.map { Item.Event(it) }
      }
      run.clear()
    }
    for (item in ordered) {
      if (item is Item.Event) {
        run += item.event
      } else {
        flush()
        out += item
      }
    }
    flush()
    return out
  }

  /** "Show 3 events: changed status, assignee, and cycles". */
  fun foldedSummary(events: List<LinearHistoryEvent>): String {
    val nouns = events.mapNotNull { noun(it.kind) }.distinct()
    val head = "Show ${events.size} events"
    if (nouns.isEmpty()) return head
    val list = when (nouns.size) {
      1 -> nouns[0]
      2 -> "${nouns[0]} and ${nouns[1]}"
      else -> nouns.dropLast(1).joinToString(", ") + ", and ${nouns.last()}"
    }
    return "$head: changed $list"
  }

  /** "Linear moved the issue" when no person did it. */
  fun sentence(event: LinearHistoryEvent): String = "${event.actor ?: "Linear"} ${event.text}"

  internal fun noun(kind: LinearHistoryEventKind): String? = when (kind) {
    LinearHistoryEventKind.status -> "status"
    LinearHistoryEventKind.priority -> "priority"
    LinearHistoryEventKind.assignee -> "assignee"
    LinearHistoryEventKind.estimate -> "estimate"
    LinearHistoryEventKind.cycle -> "cycles"
    LinearHistoryEventKind.project -> "project"
    LinearHistoryEventKind.labels -> "labels"
    LinearHistoryEventKind.title -> "title"
    LinearHistoryEventKind.description -> "description"
    LinearHistoryEventKind.due -> "due date"
    LinearHistoryEventKind.parent -> "parent"
    LinearHistoryEventKind.relation -> "relations"
    LinearHistoryEventKind.attachment -> "links"
    else -> null
  }

  data class RelationGroup(val title: String, val issues: List<LinearIssueDetailRelationsItem>) {
    val id: String get() = title
  }

  /** Blockers first, then what this blocks, related, duplicates and similar. */
  fun relationGroups(relations: List<LinearIssueDetailRelationsItem>): List<RelationGroup> {
    val order = listOf(
      "blocked_by" to "Blocked by", "blocks" to "Blocking", "related" to "Related",
      "duplicate_of" to "Duplicate of", "duplicate" to "Duplicated by", "similar" to "Similar",
    )
    val known = order.map { it.first }.toSet()
    val groups = order.mapNotNull { (type, title) ->
      relations.filter { it.type == type }.takeIf { it.isNotEmpty() }?.let { RelationGroup(title, it) }
    }
    val other = relations.filter { it.type !in known }
    return if (other.isEmpty()) groups else groups + RelationGroup("Linked", other)
  }

  /** Where an issue sits in an ordered list, and its neighbours. */
  data class Position(val index: Int, val total: Int, val previous: String?, val next: String?)

  fun position(identifier: String, order: List<String>): Position? {
    val index = order.indexOf(identifier)
    if (index < 0) return null
    return Position(index, order.size, order.getOrNull(index - 1), order.getOrNull(index + 1))
  }
}
