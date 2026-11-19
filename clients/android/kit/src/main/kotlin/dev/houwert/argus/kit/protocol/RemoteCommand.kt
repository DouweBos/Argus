package dev.houwert.argus.kit.protocol

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A request the host serves, typed by the host's zod catalog: generated into
 * `Commands` (raw commands, admin tier) and `Methods` (the typed remote methods).
 */
abstract class RemoteCommand<P, R>(
  /** The name on the wire: `read_file`, `agents.spawn`, … */
  val name: String,
  /** `monitor`, `control`, `admin` or `host`. */
  val tier: String,
  val params: KSerializer<P>,
  val result: KSerializer<R>,
)

/** A gateway event's name and payload type. */
class EventSpec<T>(val name: String, val payload: KSerializer<T>)

/** `{}` — the params for every method that takes none. */
@Serializable
class EmptyParams

/** A result accepted but never read. */
@Serializable(with = IgnoredResult.Serializer::class)
object IgnoredResult {
  object Serializer : KSerializer<IgnoredResult> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("IgnoredResult")
    override fun deserialize(decoder: Decoder): IgnoredResult {
      (decoder as? JsonDecoder)?.decodeJsonElement()
      return IgnoredResult
    }
    override fun serialize(encoder: Encoder, value: IgnoredResult) {
      (encoder as JsonEncoder).encodeJsonElement(JsonObject(emptyMap()))
    }
  }
}

/** A union told apart by a `const` field, keeping unknown members as raw JSON. */
abstract class TaggedUnionSerializer<T>(name: String, private val discriminator: String) : KSerializer<T> {
  override val descriptor: SerialDescriptor = buildClassSerialDescriptor(name)

  abstract fun decode(json: Json, tag: String?, element: JsonElement): T

  abstract fun encode(json: Json, value: T): JsonElement

  override fun deserialize(decoder: Decoder): T {
    val d = decoder as JsonDecoder
    val element = d.decodeJsonElement()
    val tag = ((element as? JsonObject)?.get(discriminator) as? JsonPrimitive)?.takeIf { it.isString }?.content
    return decode(d.json, tag, element)
  }

  override fun serialize(encoder: Encoder, value: T) {
    val e = encoder as JsonEncoder
    e.encodeJsonElement(encode(e.json, value))
  }
}
