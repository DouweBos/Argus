package dev.houwert.argus.app

import android.app.Activity
import android.os.Bundle
import android.util.Log
import dev.houwert.argus.core.remote.ClientPairingModel
import dev.houwert.argus.kit.net.PairingClientInfo
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Debug only: pair from the command line, where typing a long code into an emulator is unreliable.
 * `adb shell am start -n dev.houwert.argus.dev/dev.houwert.argus.app.DevPairActivity --es code <code>`
 */
class DevPairActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val code = intent.getStringExtra("code") ?: return finish()
    val app = (application as ArgusApplication).app
    val scope = MainScope()
    val model = ClientPairingModel(
      scope = scope,
      client = PairingClientInfo(product = "Argus", kind = "mobile", device = app.deviceName, version = BuildConfig.VERSION_NAME),
      onPaired = { app.pairCompleted(it) },
    )
    model.begin(DevPairing.rewrite(code))
    scope.launch {
      val state = model.state.first { it.phase == ClientPairingModel.Phase.Paired || it.error != null }
      Log.i("DevPair", state.error ?: "paired")
      finish()
    }
  }
}
