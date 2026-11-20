package dev.houwert.argus.app.platform

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.fragment.app.FragmentActivity
import dev.houwert.argus.app.navigation.Router
import dev.houwert.argus.app.notifications.Notifier
import dev.houwert.argus.app.stores.AppStore
import dev.houwert.argus.core.stores.liveBackend
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch

private const val PERMISSION_ASKED = "push.permissionAsked"

/** The biometric gate in front of the app, and the notification prompt once a computer is paired. */
@Composable
fun AppGate(activity: FragmentActivity, app: AppStore, platform: AndroidPlatform, content: @Composable () -> Unit) {
  val unlocked by platform.unlocked.collectAsState()
  LaunchedEffect(Unit) {
    if (platform.unlocked.value) return@LaunchedEffect
    if (AppLock.available(activity)) AppLock.authenticate(activity, platform::unlock) else platform.unlock()
  }
  if (!unlocked) {
    ArgusTheme(dark = isSystemInDarkTheme()) { LockScreen { AppLock.authenticate(activity, platform::unlock) } }
    return
  }
  content()
  NotificationPrompt(app, platform)
}

/** Being woken while away is the point of pairing, so ask on the first connection rather than waiting for Settings. Asked once. */
@Composable
private fun NotificationPrompt(app: AppStore, platform: AndroidPlatform) {
  if (Build.VERSION.SDK_INT < 33) return
  val paired by app.pairedHosts.collectAsState()
  val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) app.host.liveBackend?.let { backend -> app.scope.launch { platform.push.register(backend) } }
  }
  LaunchedEffect(paired.isNotEmpty()) {
    if (paired.isEmpty() || !platform.push.enabled || Notifier.allowed(platform.context)) return@LaunchedEffect
    if (app.preferences.bool(PERMISSION_ASKED) == true) return@LaunchedEffect
    app.preferences.set(true, PERMISSION_ASKED)
    launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
  }
}

/** Hands the root's router to the launch router, so notifications and links can navigate. */
@Composable
fun LaunchAttach(router: Router) {
  val launches = (androidx.compose.ui.platform.LocalContext.current.applicationContext as dev.houwert.argus.app.ArgusApplication).platform.launches
  DisposableEffect(router) {
    launches.attach(router)
    onDispose { launches.detach(router) }
  }
}
