package dev.houwert.argus.app

import android.content.Intent
import android.os.Bundle
import dev.houwert.argus.app.stores.ACCOUNT_URL_KEY
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
    val argus = application as ArgusApplication
    val app = argus.app
    handleIntent(intent)
    // Moved tunnels, new networks and dead sockets, picked up on the way back in.
    ProcessLifecycleOwner.get().lifecycle.addObserver(
      object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) = app.enteredForeground()
      },
    )
    argus.platform.launches.resolver = contentResolver
    // A recreated activity already handled the intent that started it.
    if (savedInstanceState == null) argus.platform.launches.handle(intent)
    setContent { AppGate(this, app, argus.platform) { ArgusRoot(app) } }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleIntent(intent)
    (application as ArgusApplication).platform.launches.handle(intent)
  }

  /** A sign-in coming back from the browser; in debug builds, a launch extra pointing at a test account service. */
  private fun handleIntent(intent: Intent?) {
    val argus = application as ArgusApplication
    intent?.data?.toString()?.let { argus.clerk.handleRedirect(it) }
    if (BuildConfig.DEBUG) intent?.getStringExtra(ACCOUNT_URL_KEY)?.let { argus.app.preferences.set(it, ACCOUNT_URL_KEY) }
  }
}
