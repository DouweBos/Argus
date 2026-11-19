package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.json.stringValue
import kotlinx.serialization.json.JsonElement

/** An agent's `request_secret` call: what it needs, why, and where the value goes. */
data class SecretRequest(val label: String, val reason: String, val delivery: Delivery) {
  sealed interface Delivery {
    data object File : Delivery
    data class Env(val runCommand: String, val variable: String) : Delivery
  }

  /** Where the value ends up, in words. */
  val destination: String
    get() = when (delivery) {
      Delivery.File -> "Saved to a private file on your computer for the agent to read, deleted within 24 hours."
      is Delivery.Env -> "Set as ${delivery.variable} for the “${delivery.runCommand}” run command, kept in memory only."
    }

  companion object {
    /** `request_secret` under whatever prefix the runner gives MCP tools. */
    fun isTool(name: String): Boolean = name == "request_secret" || name.endsWith("__request_secret")

    fun parse(name: String, input: Map<String, JsonElement>): SecretRequest? {
      if (!isTool(name)) return null
      val label = input["label"].stringValue ?: return null
      val reason = input["reason"].stringValue ?: ""
      val run = input["run_command"].stringValue
      val variable = input["env_var"].stringValue
      if (input["delivery"].stringValue == "env" && run != null && variable != null) {
        return SecretRequest(label, reason, Delivery.Env(run, variable))
      }
      return SecretRequest(label, reason, Delivery.File)
    }
  }
}
