package dev.houwert.argus.app.stores

import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.core.account.setName
import dev.houwert.argus.core.stores.liveBackend
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.storage.PreferenceKey

/** Account names allow 1 to 64 UTF-16 units and no control characters; null when invalid. */
fun validatedDeviceName(raw: String): String? {
  val name = raw.trim()
  if (name.length !in 1..64) return null
  return name.takeIf { n -> n.none { it.code < 0x20 || it.code == 0x7f } }
}

/** The name setting: the account renames this phone (now, or once reachable) and calls back into [applyDeviceName]. */
suspend fun AppStore.setDeviceName(name: String): Boolean = account.setName(name, AccountStore.NameSource.Settings)

/** Persist the name and tell the connected computer. */
suspend fun AppStore.applyDeviceName(name: String) {
  preferences.set(name, PreferenceKey.DEVICE_NAME)
  _deviceName.value = name
  runCatching { host.liveBackend?.request(Methods.DeviceRename, MethodsTypes.DeviceRenameParams(name)) }
}
