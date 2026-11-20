package dev.houwert.argus.app

import android.content.Intent
import android.os.Bundle
import dev.houwert.argus.app.stores.ACCOUNT_URL_KEY
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner

class MainActivity : ComponentActivity() {
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
    setContent { ArgusRoot(app) }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleIntent(intent)
  }

  /** A sign-in coming back from the browser; in debug builds, a launch extra pointing at a test account service. */
  private fun handleIntent(intent: Intent?) {
    val argus = application as ArgusApplication
    intent?.data?.toString()?.let { argus.clerk.handleRedirect(it) }
    if (BuildConfig.DEBUG) intent?.getStringExtra(ACCOUNT_URL_KEY)?.let { argus.app.preferences.set(it, ACCOUNT_URL_KEY) }
  }
}
