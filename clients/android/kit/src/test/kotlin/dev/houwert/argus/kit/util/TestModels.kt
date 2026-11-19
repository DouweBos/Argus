package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallChild
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallStatus
import dev.houwert.argus.kit.protocol.generated.RemoteToolResultBlock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

internal fun str(value: String): JsonElement = JsonPrimitive(value)

internal fun toolCall(
  id: String,
  name: String,
  input: Map<String, JsonElement> = emptyMap(),
  resultBlocks: List<RemoteToolResultBlock> = emptyList(),
  children: List<RemoteToolCallChild>? = null,
  status: RemoteToolCallStatus = RemoteToolCallStatus.done,
  isError: Boolean? = null,
) = RemoteToolCall(
  id = id, name = name, input = input, resultBlocks = resultBlocks, children = children, isError = isError, status = status,
)

internal fun message(
  id: String,
  role: RemoteMessageRole = RemoteMessageRole.assistant,
  text: List<String> = emptyList(),
  toolCalls: List<RemoteToolCall> = emptyList(),
  isError: Boolean? = null,
) = RemoteMessage(id = id, role = role, textBlocks = text, toolCalls = toolCalls, isError = isError)
