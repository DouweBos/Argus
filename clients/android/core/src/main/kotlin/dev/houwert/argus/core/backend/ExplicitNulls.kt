package dev.houwert.argus.core.backend

import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.RemoteCommand
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * A generated request whose params must carry `null` at [paths] (dot-separated, e.g. `patch.model`).
 * Required nullable fields already go out as null; this is for a patch, where null clears a field
 * its all-optional type would leave out.
 */
suspend fun <P, R> HostBackend.requestWithNulls(command: RemoteCommand<P, R>, params: P, vararg paths: String): R {
  var body = ProtocolJson.encode(command.params, params)
  for (path in paths) body = withNull(body, path.split('.'))
  return request(object : RemoteCommand<JsonElement, R>(command.name, command.tier, JsonElement.serializer(), command.result) {}, body)
}

/** [element] with `null` at [path] wherever the key is missing; an existing value is left alone. */
internal fun withNull(element: JsonElement, path: List<String>): JsonElement {
  val obj = element as? JsonObject ?: return element
  val key = path.first()
  if (path.size == 1) return if (key in obj) obj else JsonObject(obj + (key to JsonNull))
  val child = obj[key] ?: return obj
  return JsonObject(obj + (key to withNull(child, path.drop(1))))
}
