package dev.houwert.argus.app

import android.app.Application
import android.os.Build
import android.provider.Settings
import dev.houwert.argus.app.storage.AndroidNetworkPathWatcher
import dev.houwert.argus.app.storage.AndroidSealedFiles
import dev.houwert.argus.app.storage.AndroidSecretStore
import dev.houwert.argus.app.storage.DataStoreKeyValueStore
import dev.houwert.argus.app.stores.AppStore
import dev.houwert.argus.kit.storage.Keystore
import dev.houwert.argus.kit.storage.Preferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.CoroutineScope

/** Owns the app-wide stores, which outlive any activity. */
class ArgusApplication : Application() {
  lateinit var app: AppStore
    private set

  override fun onCreate() {
    super.onCreate()
    val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    app = AppStore(
      scope = MainScope(),
      keystore = Keystore(AndroidSecretStore(this)),
      preferences = Preferences(DataStoreKeyValueStore(this, io)),
      sealedFiles = AndroidSealedFiles(this),
      networkPaths = AndroidNetworkPathWatcher(this),
      defaultDeviceName = deviceName(),
    )
    app.initialize()
  }

  private fun deviceName(): String =
    Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() } ?: Build.MODEL
}
