package dev.houwert.argus.core.backend

import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.RemoteCommand
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * A generated request whose params must carry `null` at [paths] (dot-separated, e.g. `input.agent.model`):
 * the wire drops nulls, but the host requires keys it declares `.nullable()` rather than `.optional()`.
 */
suspend fun <P, R> HostBackend.requestWithNulls(command: RemoteCommand<P, R>, params: P, vararg paths: String): R {
  var body = ProtocolJson.encode(command.params, params)
  for (path in paths) body = withNull(body, path.split('.'))
  return request(RawCommand(command.name, command.result, command.tier), body)
}

/** [element] with `null` at [path] wherever the key is missing; an existing value is left alone. */
internal fun withNull(element: JsonElement, path: List<String>): JsonElement {
  val obj = element as? JsonObject ?: return element
  val key = path.first()
  if (path.size == 1) return if (key in obj) obj else JsonObject(obj + (key to JsonNull))
  val child = obj[key] ?: return obj
  return JsonObject(obj + (key to withNull(child, path.drop(1))))
}
