package dev.houwert.argus.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import dev.houwert.argus.app.platform.AppGate

/** A FragmentActivity because the biometric prompt needs one. */
class MainActivity : FragmentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    val application = application as ArgusApplication
    val app = application.app
    // Moved tunnels, new networks and dead sockets, picked up on the way back in.
    ProcessLifecycleOwner.get().lifecycle.addObserver(
      object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) = app.enteredForeground()
      },
    )
    application.platform.launches.resolver = contentResolver
    // A recreated activity already handled the intent that started it.
    if (savedInstanceState == null) application.platform.launches.handle(intent)
    setContent { AppGate(this, app, application.platform) { ArgusRoot(app) } }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    (application as ArgusApplication).platform.launches.handle(intent)
  }
}
