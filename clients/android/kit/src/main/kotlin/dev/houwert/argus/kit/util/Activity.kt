package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.json.stringValue
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import kotlinx.serialization.json.JsonElement

/**
 * Activity and status derivation, as the desktop's `activityDescription` + `spinnerVerbs`:
 * an agent's status and current tool as a short phrase ("Editing main.ts", "Running command").
 */
object Activity {
  enum class State { BLOCKED, IDLE, STOPPED, WORKING }

  data class Description(val text: String, val state: State)

  internal val toolVerbs = mapOf(
    "Agent" to "Running agent",
    "Artifact" to "Working on artifact",
    "Bash" to "Running command",
    "Edit" to "Editing file",
    "Glob" to "Finding files",
    "Grep" to "Searching code",
    "MultiEdit" to "Editing files",
    "NotebookEdit" to "Editing notebook",
    "Read" to "Reading file",
    "WebFetch" to "Fetching URL",
    "WebSearch" to "Searching web",
    "Write" to "Writing file",
  )

  internal fun verb(toolName: String): String = toolVerbs[toolName] ?: "Using $toolName"

  fun toolActivity(toolName: String, input: Map<String, JsonElement>?): String {
    if (input == null) return verb(toolName)
    return when (toolName) {
      "Edit", "MultiEdit", "Write", "Read" -> {
        val path = input["file_path"].stringValue ?: input["path"].stringValue ?: return verb(toolName)
        val basename = path.split('/').lastOrNull { it.isNotEmpty() } ?: path
        if (toolName == "Read") "Reading $basename" else "Editing $basename"
      }
      "WebFetch" -> input["url"].stringValue?.let(::urlHost)?.let { "Fetching $it" } ?: verb(toolName)
      "Glob" -> input["pattern"].stringValue?.let { "Finding $it" } ?: verb(toolName)
      "Grep" -> input["pattern"].stringValue?.let { "Searching for \"${clip(it, 20)}\"" } ?: verb(toolName)
      "Bash" -> "Running command"
      else -> verb(toolName)
    }
  }

  fun derive(
    status: RemoteAgentStatusStatus?,
    pendingToolName: String?,
    pendingToolInput: Map<String, JsonElement>? = null,
    hasPendingPermission: Boolean,
  ): Description {
    when (status) {
      RemoteAgentStatusStatus.stopped, RemoteAgentStatusStatus.error -> return Description("Stopped", State.STOPPED)
      RemoteAgentStatusStatus.idle, null -> return Description("Idle", State.IDLE)
      else -> Unit
    }
    if (hasPendingPermission) {
      if (pendingToolName != null && SecretRequest.isTool(pendingToolName)) {
        return Description("Waiting for a secret", State.BLOCKED)
      }
      return Description("Waiting for permission", State.BLOCKED)
    }
    if (pendingToolName != null) return Description(toolActivity(pendingToolName, pendingToolInput), State.WORKING)
    return Description("Thinking", State.WORKING)
  }

  /** Shown instead of a bare "Thinking"; the caller holds one for a whole thinking episode so it doesn't flicker. */
  val spinnerVerbs = listOf(
    "Cogitating", "Ruminating", "Pondering", "Deliberating", "Musing",
    "Percolating", "Marinating", "Noodling", "Puzzling", "Contemplating",
    "Mulling", "Chewing", "Brewing", "Churning", "Whirring",
    "Scheming", "Plotting", "Divining", "Conjuring", "Untangling",
    "Unravelling", "Excavating", "Spelunking", "Foraging", "Rummaging",
    "Wrangling", "Herding", "Juggling", "Orchestrating", "Assembling",
    "Distilling", "Fermenting", "Simmering", "Reducing", "Steeping",
    "Calibrating", "Triangulating", "Extrapolating", "Interpolating", "Inferring",
    "Consulting", "Deducing", "Surmising", "Reckoning", "Weighing",
    "Sifting", "Winnowing", "Threading", "Splicing", "Knitting",
    "Tessellating", "Crystallising", "Coalescing", "Converging", "Homing in",
    "Circling", "Closing in",
  )

  fun randomSpinnerVerb(): String = spinnerVerbs.randomOrNull() ?: "Thinking"
}
