package dev.houwert.argus.ui.composer

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.Chip
import dev.houwert.argus.ui.icons.Icon

/**
 * Replies the user might send next, suggested once a turn ends: chips while the input is empty,
 * ghost text completing a typed prefix, and Tab to take either. Picking one fills, never sends.
 */
object FollowUps {
  /** The rest of the suggestion `text` is a prefix of; null when empty, unmatched or already complete. */
  fun completion(text: String, items: List<String>): String? {
    if (text.isBlank() || '\n' in text) return null
    val match = items.firstOrNull { it.length > text.length && it.lowercase().startsWith(text.lowercase()) }
    return match?.drop(text.length)
  }

  /** What Tab fills the input with: the completion, or the first suggestion into an empty input. */
  fun accepted(text: String, items: List<String>): String? {
    completion(text, items)?.let { return text + it }
    if (text.isBlank()) return items.firstOrNull()
    return null
  }
}

/** The chips above the input. */
@Composable
internal fun FollowUpSuggestionRow(items: List<String>, modifier: Modifier = Modifier, pick: (String) -> Unit) {
  Row(
    modifier.horizontalScroll(rememberScrollState()).semantics { contentDescription = "Suggested replies" },
    horizontalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    for (item in items) Chip(item, icon = Icon.reply) { pick(item) }
  }
}
