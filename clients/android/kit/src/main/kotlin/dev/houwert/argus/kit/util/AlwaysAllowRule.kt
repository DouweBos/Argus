package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.json.stringValue
import kotlinx.serialization.json.JsonElement

/**
 * The rule an "Always allow" answer adds for the rest of the session, as the host's
 * `alwaysAllowRule.ts` derives it: a command's binary, a file's extension, a URL's domain, else the tool.
 */
object AlwaysAllowRule {
  fun rule(name: String, input: Map<String, JsonElement>): String = when (name) {
    "Bash" -> {
      val binary = (input["command"].stringValue ?: "").trim().split(Regex("\\s+")).firstOrNull().orEmpty()
      if (binary.isEmpty()) name else "$name($binary *)"
    }
    "Edit", "MultiEdit", "Write", "Read" -> {
      val path = input["file_path"].stringValue ?: input["path"].stringValue ?: ""
      // JS `split(".").pop()`: everything after the last dot, or the whole path.
      val ext = path.split('.').last()
      if (ext != path && !ext.contains('/')) "$name(**/*.$ext)" else name
    }
    "WebFetch" -> input["url"].stringValue?.let(::urlHost)?.takeIf { it.isNotEmpty() }?.let { "$name(domain:$it)" } ?: name
    else -> name
  }
}
