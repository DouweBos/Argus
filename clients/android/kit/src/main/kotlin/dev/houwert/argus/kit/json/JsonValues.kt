package dev.houwert.argus.kit.json

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/** Accessors for JSON of unknown shape (tool inputs, results), as on `JSONValue` in Swift. */
val JsonElement?.stringValue: String? get() = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
val JsonElement?.numberValue: Double? get() = (this as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
val JsonElement?.longValue: Long? get() = (this as? JsonPrimitive)?.takeIf { !it.isString }?.let { it.longOrNull ?: it.doubleOrNull?.toLong() }
val JsonElement?.boolValue: Boolean? get() = (this as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
val JsonElement?.arrayValue: List<JsonElement>? get() = this as? JsonArray
val JsonElement?.objectValue: Map<String, JsonElement>? get() = this as? JsonObject

operator fun JsonElement?.get(key: String): JsonElement? = (this as? JsonObject)?.get(key)
