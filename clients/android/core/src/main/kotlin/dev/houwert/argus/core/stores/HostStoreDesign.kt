package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.DesignComparison
import dev.houwert.argus.kit.protocol.generated.FigmaFrameDetails
import dev.houwert.argus.kit.protocol.generated.IntegrationId
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import dev.houwert.argus.kit.protocol.generated.RemoteSession

// Figma frames as the computer's connected Figma user sees them, and comparing one against a
// device the computer runs.

/** Figma is connected and its key still works. */
val HostStore.figmaConnected: Boolean get() = integrations.value.isConnected(IntegrationId.figma)

/** Null when the link isn't a frame Figma could render. */
suspend fun HostStore.figmaFrameDetails(url: String): FigmaFrameDetails? {
  val backend = backend ?: return null
  return backend.request(Methods.FigmaFrameDetails, MethodsTypes.FigmaFrameDetailsParams(url)).details
}

suspend fun HostStore.compareDesign(url: String, platform: RemotePlatform, deviceKey: String): DesignComparison? {
  val backend = backend ?: return null
  return backend.request(
    Methods.DesignCompare,
    MethodsTypes.DesignCompareParams(url, MethodsTypes.DesignCompareParamsPlatform(platform.rawValue), deviceKey),
  ).comparison
}

/** A session by id, across every loaded project. */
fun HostStore.loadedSession(id: String): RemoteSession? = sessionsByRepo.value.values.flatten().firstOrNull { it.id == id }
