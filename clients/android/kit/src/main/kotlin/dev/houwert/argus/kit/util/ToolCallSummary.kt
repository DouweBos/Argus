package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.json.stringValue
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallChild
import kotlinx.serialization.json.JsonElement

/** One-line summaries for a collapsed tool call, ported from `toolCall.ts`. */
object ToolCallSummary {
  /** Tools whose summary is a path; the UI head-truncates them, since the filename is what to keep. */
  val pathTools: Set<String> = setOf("Read", "Edit", "MultiEdit", "Write", "LS")

  fun isPathTool(name: String): Boolean = name in pathTools

  fun summary(name: String, input: Map<String, JsonElement>): String {
    if (SecretRequest.isTool(name)) return input["label"].stringValue ?: ""
    return when (name) {
      "Read", "Edit", "MultiEdit", "Write" -> input["file_path"].stringValue ?: input["path"].stringValue ?: ""
      "LS" -> input["path"].stringValue ?: "."
      "Bash" -> clip(input["command"].stringValue ?: "", 60)
      "Glob", "Grep" -> input["pattern"].stringValue ?: ""
      "Task", "WebSearch" -> clip(input["description"].stringValue ?: input["query"].stringValue ?: "", 60)
      "WebFetch" -> clip(input["url"].stringValue ?: "", 60)
      "Artifact" -> {
        val action = input["action"].stringValue ?: "publish"
        val target = input["file_path"].stringValue ?: input["url"].stringValue ?: ""
        if (target.isEmpty()) action else "$action ${clip(target, 60)}"
      }
      "Agent" -> {
        val type = input["subagent_type"].stringValue ?: "agent"
        val description = input["description"].stringValue ?: ""
        if (description.isEmpty()) type else "$type: ${clip(description, 80)}"
      }
      else -> ""
    }
  }

  /** Agent and Task calls run a subagent whose own calls nest under them. */
  fun isSubagent(name: String): Boolean = name == "Agent" || name == "Task"

  /** What a call is called in a row: an Agent call goes by its subagent type. */
  fun label(name: String, input: Map<String, JsonElement>): String {
    if (SecretRequest.isTool(name)) return "Secret request"
    if (name != "Agent") return name
    return input["subagent_type"].stringValue.orEmpty().ifEmpty { "Agent" }
  }

  data class SubagentPreview(val calls: List<RemoteToolCall>, val earlier: Int)

  /** A subagent's newest calls for its collapsed preview, and how many came before them. */
  fun subagentPreview(call: RemoteToolCall, limit: Int = 5): SubagentPreview {
    val calls = call.children.orEmpty().mapNotNull { (it as? RemoteToolCallChild.ToolUse)?.value?.toolCall }
    val shown = calls.takeLast(limit)
    return SubagentPreview(shown, calls.size - shown.size)
  }
}
