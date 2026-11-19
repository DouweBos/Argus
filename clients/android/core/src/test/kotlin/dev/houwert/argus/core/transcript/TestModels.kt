package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole

internal fun decodeMessage(json: String): RemoteMessage = ProtocolJson.json.decodeFromString(RemoteMessage.serializer(), json)

internal fun textMessage(
  id: String,
  role: RemoteMessageRole = RemoteMessageRole.assistant,
  text: List<String> = emptyList(),
  timestamp: Double? = null,
) = RemoteMessage(id = id, role = role, textBlocks = text, toolCalls = emptyList(), timestamp = timestamp)
