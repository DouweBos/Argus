package dev.houwert.argus.app

import android.app.Application
import android.content.Intent
import android.net.Uri
import dev.houwert.argus.app.auth.ClerkAuth
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
  lateinit var platform: dev.houwert.argus.app.platform.AndroidPlatform
  lateinit var clerk: ClerkAuth
    private set

  override fun onCreate() {
    super.onCreate()
    val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val secrets = AndroidSecretStore(this)
    // GitHub and Apple sign-in come back to MainActivity on this scheme.
    clerk = ClerkAuth(secrets, "$packageName://callback") { url ->
      startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    app = AppStore(
      scope = MainScope(),
      keystore = Keystore(secrets),
      preferences = Preferences(DataStoreKeyValueStore(this, io)),
      sealedFiles = AndroidSealedFiles(this),
      networkPaths = AndroidNetworkPathWatcher(this),
      defaultDeviceName = deviceName(),
      accountAuth = clerk,
    )
    dev.houwert.argus.app.telemetry.Telemetry.start(this, app.preferences)
    dev.houwert.argus.ui.mermaid.MermaidRenderer.attach(this)
    dev.houwert.argus.ui.mermaid.MermaidRenderer.onRender = { failed ->
      dev.houwert.argus.app.telemetry.Telemetry.capture(dev.houwert.argus.app.telemetry.TelemetryEvent.MermaidRendered(failed))
    }
    platform = dev.houwert.argus.app.platform.AndroidPlatform(this, app, AndroidSecretStore(this))
    app.platform = platform
    app.initialize()
  }

  private fun deviceName(): String =
    Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() } ?: Build.MODEL
}
