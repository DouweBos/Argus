package dev.houwert.argus.kit.protocol

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The RPC envelopes of `packages/remote-protocol/src/messages.ts`. `seq` is per
 * connection, per direction, strictly increasing; both sides drop anything at
 * or below the last one seen.
 */
@OptIn(ExperimentalSerializationApi::class)
object ProtocolJson {
  val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = false
    coerceInputValues = true
    isLenient = true
  }

  /**
   * Optional fields (default null) stay off the wire, but a field the host declares
   * `.nullable()` (generated with `@EncodeDefault`) must still go out as `null`.
   */
  private val encoder = Json(json) { explicitNulls = true }

  fun <T> encode(serializer: KSerializer<T>, value: T): JsonElement = encoder.encodeToJsonElement(serializer, value)

  fun <T> decode(serializer: KSerializer<T>, value: JsonElement?): T = json.decodeFromJsonElement(serializer, value ?: JsonNull)

  fun decodeFrame(text: String): ServerFrame {
    val obj = json.parseToJsonElement(text).jsonObject
    return when (obj["type"]?.jsonPrimitive?.contentOrNull) {
      "res" -> ServerFrame.Response(json.decodeFromJsonElement(ResponseEnvelope.serializer(), obj))
      "evt" -> ServerFrame.Event(json.decodeFromJsonElement(EventEnvelope.serializer(), obj))
      else -> ServerFrame.Unknown
    }
  }
}

@Serializable
data class GatewayErrorPayload(val code: String, override val message: String, val data: JsonElement? = null) : Exception(message) {
  /** The host refused on capability grounds, not because the call was wrong. */
  val isCapabilityDenied get() = code == "capability_denied"
  val isNotFound get() = code == "not_found"

  /** The method the host doesn't have — it runs an older Argus than this client. */
  val unsupportedMethod: String?
    get() {
      val d = data as? JsonObject
      if ((d?.get("reason") as? JsonPrimitive)?.contentOrNull == UNKNOWN_COMMAND) {
        return (d["method"] as? JsonPrimitive)?.contentOrNull ?: ""
      }
      // Hosts from before `data.reason` only send "unknown command|method <name>".
      val words = message.split(" ")
      if (words.size != 3 || words[0] != "unknown" || words[1] !in setOf("command", "method") || words[2].isEmpty()) return null
      return words[2]
    }

  companion object {
    const val UNKNOWN_COMMAND = "unknown_command"
  }
}

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class RequestEnvelope(
  @EncodeDefault val type: String = "req",
  val seq: Int,
  val id: String,
  val method: String,
  val params: JsonElement,
)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class SubscribeEnvelope(
  @EncodeDefault val type: String = "sub",
  val seq: Int,
  val action: String,
  @SerialName("agent_id") val agentId: String,
)

@Serializable
data class ResponseEnvelope(
  val seq: Int,
  val id: String,
  val ok: JsonElement? = null,
  val error: GatewayErrorPayload? = null,
)

@Serializable
data class EventEnvelope(
  val seq: Int,
  val event: String,
  @SerialName("agent_id") val agentId: String? = null,
  val payload: JsonElement = JsonNull,
) {
  fun <T> decode(spec: EventSpec<T>): T? = runCatching { ProtocolJson.decode(spec.payload, payload) }.getOrNull()
}

sealed interface ServerFrame {
  data class Response(val envelope: ResponseEnvelope) : ServerFrame
  data class Event(val envelope: EventEnvelope) : ServerFrame
  /** A frame this client doesn't model — ignored so a newer host never breaks it. */
  data object Unknown : ServerFrame
}
