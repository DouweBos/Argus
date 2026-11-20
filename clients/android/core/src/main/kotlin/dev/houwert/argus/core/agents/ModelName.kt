package dev.houwert.argus.core.agents

import dev.houwert.argus.kit.protocol.generated.RemoteModelInfo

/** How a model reads in a pill: "Claude Opus 5.5", not `claude-opus-5-5[1m]` or "Default (recommended)". */
object ModelName {
  /** `claude-opus-5-5[1m]` → "Claude Opus 5.5"; null for an id that isn't `claude-<family>-<version>`. */
  fun pretty(id: String): String? {
    val base = id.substringBefore('[')
    val parts = base.lowercase().split('-')
    if (parts.size < 3 || parts[0] != "claude" || parts[1].isEmpty() || !parts[1].all { it.isLetter() }) return null
    // A trailing snapshot date (`-20250805`) is no part of the name.
    val version = parts.drop(2).filter { it.length < 8 }
    if (version.isEmpty() || !version.all { v -> v.isNotEmpty() && v.all { it.isDigit() } }) return null
    return "Claude ${parts[1].replaceFirstChar { it.uppercase() }} ${version.joinToString(".")}"
  }

  /** An alias by the model it runs, else the CLI's own name for it. */
  fun label(model: RemoteModelInfo): String = model.resolvedModel?.let(::pretty) ?: pretty(model.value) ?: model.displayName

  /** What an agent on [value] runs; null [value] is the CLI default. */
  fun label(value: String?, models: List<RemoteModelInfo>): String? {
    val picked = value ?: "default"
    models.firstOrNull { it.value == picked }?.let { return label(it) }
    if (value == null) return models.firstOrNull()?.let(::label)
    return pretty(value) ?: value
  }
}
