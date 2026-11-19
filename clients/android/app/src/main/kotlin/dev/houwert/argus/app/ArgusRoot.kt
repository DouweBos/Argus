package dev.houwert.argus.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.navigation.AppSection
import dev.houwert.argus.app.navigation.Router
import dev.houwert.argus.app.navigation.TabHost
import dev.houwert.argus.app.stores.AppStore
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.kit.net.Transport
import kotlinx.coroutines.delay

val LocalAppStore = staticCompositionLocalOf<AppStore> { error("No AppStore") }
val LocalRouter = staticCompositionLocalOf<Router> { error("No Router") }

/** The app shell: one tab bar, a stack per tab, the connection pill and the error toast over it. */
@Composable
fun ArgusRoot(app: AppStore) {
  val router = remember { Router() }
  val dark = isSystemInDarkTheme()
  ArgusTheme(dark = dark) {
    CompositionLocalProvider(LocalAppStore provides app, LocalRouter provides router) {
      val section by router.section.collectAsState()
      val tabs = rememberSaveableStateHolder()
      Scaffold(
        bottomBar = {
          NavigationBar {
            AppSection.tabs.forEach { tab ->
              NavigationBarItem(
                selected = tab == section,
                onClick = { router.selectTab(tab) },
                icon = { Icon(tab.icon, contentDescription = null) },
                label = { Text(tab.title) },
              )
            }
          }
        },
      ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
          // Each tab keeps its stack while another is showing.
          tabs.SaveableStateProvider(section.name) { TabHost(section, router) }
          ConnectionPill(app, Modifier.align(Alignment.TopCenter))
          ErrorToast(app, Modifier.align(Alignment.BottomCenter))
        }
      }
    }
  }
}

/** Quiet status while reconnecting or showing what was saved; it retries on its own. */
@Composable
private fun ConnectionPill(app: AppStore, modifier: Modifier) {
  val identity by app.identity.collectAsState()
  val connection by app.host.connection.collectAsState()
  val savedAsOf by app.host.savedAsOf.collectAsState()
  if (identity == null || (connection != Transport.State.Offline && savedAsOf == null)) return
  val label = if (savedAsOf != null) "Saved copy" else "Reconnecting"
  Snackbar(modifier.padding(8.dp).semantics { contentDescription = "$label to ${identity?.label}" }) { Text(label) }
}

/** Every failed request sets `lastError`; without this the app just appears to ignore the tap. */
@Composable
private fun ErrorToast(app: AppStore, modifier: Modifier) {
  val error by app.host.lastError.collectAsState()
  val connection by app.host.connection.collectAsState()
  val message = error ?: return
  if (connection == Transport.State.Offline) return
  LaunchedEffect(message) {
    delay(6_000)
    app.host.clearError()
  }
  Snackbar(modifier.padding(12.dp)) { Text(message) }
}
