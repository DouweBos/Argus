package dev.houwert.argus.core.backend

import dev.houwert.argus.kit.protocol.RemoteCommand
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement

/**
 * A method whose params are built by hand, for the few that must send an
 * explicit `null` (generated params drop nulls on the wire).
 */
class RawCommand<R>(name: String, result: KSerializer<R>, tier: String = "control") :
  RemoteCommand<JsonElement, R>(name, tier, JsonElement.serializer(), result)
