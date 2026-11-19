package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.RemoteAgentCapabilities
import dev.houwert.argus.kit.protocol.generated.RemoteTokenUsage
import java.util.Locale

/** Context-window sizing for the fill meter, ported from `contextWindow.ts`. */
object ContextWindow {
  const val DEFAULT_LIMIT = 200_000
  const val ONE_MILLION = 1_000_000

  private val oneMillionPattern = Regex("""\[1m]|\b1\s*m(illion)?\s*context\b""", RegexOption.IGNORE_CASE)
  private val claudeIdPattern = Regex("""^claude-([a-z]+-)?\d+""", RegexOption.IGNORE_CASE)

  /** A 1M-context variant announces itself in the model id or its copy; there is no structured flag on the wire. */
  fun limit(model: String?, capabilities: RemoteAgentCapabilities?): Int {
    val info = capabilities?.models?.firstOrNull { it.value == model }
      ?: capabilities?.models?.firstOrNull { it.value == "default" }
    val haystack = listOfNotNull(model, info?.value, info?.displayName, info?.description).joinToString(" ")
    if (oneMillionPattern.containsMatchIn(haystack)) return ONE_MILLION
    return claudeIdLimit(model) ?: DEFAULT_LIMIT
  }

  /** The Claude 5 family runs a 1M window; null for ids that aren't Claude's. */
  internal fun claudeIdLimit(id: String?): Int? {
    val match = id?.let { claudeIdPattern.find(it) } ?: return null
    val major = match.value.split('-').last().toIntOrNull() ?: return null
    return if (major >= 5) ONE_MILLION else DEFAULT_LIMIT
  }

  /** All four counts occupy the window, cache reads included. */
  fun tokensInContext(usage: RemoteTokenUsage?): Int {
    if (usage == null) return 0
    return (usage.inputTokens + usage.outputTokens + (usage.cacheReadInputTokens ?: 0.0) +
      (usage.cacheCreationInputTokens ?: 0.0)).toInt()
  }

  fun format(count: Int): String = when {
    count >= 1_000_000 -> String.format(Locale.ROOT, "%.1fM", count / 1_000_000.0)
    count >= 1_000 -> "${count / 1000}k"
    else -> "$count"
  }
}
