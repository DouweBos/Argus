package dev.houwert.argus.app.screens.settings

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryMode
import dev.houwert.argus.app.ArgusApplication
import dev.houwert.argus.app.stores.setDeviceName
import dev.houwert.argus.app.stores.validatedDeviceName
import dev.houwert.argus.ui.components.AlertCategoriesGroup
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.ColorSchemeCards
import dev.houwert.argus.ui.components.ColorThemeCards
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsGroupTitle
import dev.houwert.argus.ui.components.SettingsPage
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.components.SettingsToggleRow
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.OnResume
import dev.houwert.argus.ui.composer.VoiceSettingsGroup
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun NameSettingsPage() {
  val app = LocalAppStore.current
  val current by app.deviceNameFlow.collectAsState()
  var name by remember { mutableStateOf(current) }
  var saved by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  // Renamed from the account list or another device.
  LaunchedEffect(current) { name = current }
  val savable = validatedDeviceName(name)?.let { it != current } ?: false
  val noun = deviceNoun()
  fun save() {
    val valid = validatedDeviceName(name) ?: return
    if (!savable) return
    scope.launch {
      if (!app.setDeviceName(valid)) return@launch
      saved = true
      delay(1200)
      saved = false
    }
  }
  SettingsPage {
    SettingsGroup(
      title = "This $noun",
      footer = "How your computers and your Argus account list this $noun. Changing it renames it on the account too.",
    ) {
      SettingsRow("Name", stacked = true) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          ThemedTextField(name, { name = it }, "This $noun's name", Modifier.weight(1f), input = TextInput.Name, onSubmit = ::save)
          Btn(if (saved) "Saved" else "Save", tone = ButtonTone.Secondary, small = true, hugs = true, enabled = savable, onClick = ::save)
        }
      }
    }
  }
}

@Composable
fun AppearanceSettingsPage() {
  val prefs = LocalAppStore.current.prefs
  val theme by prefs.theme.collectAsState()
  val colorTheme by prefs.colorTheme.collectAsState()
  val expand by prefs.autoExpandImageReads.collectAsState()
  SettingsPage {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      SettingsGroupTitle("Colour scheme")
      ColorSchemeCards(theme, colorTheme, prefs::setTheme)
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      SettingsGroupTitle("Colour theme")
      ColorThemeCards(colorTheme, prefs::setColorTheme)
    }
    SettingsGroup(title = "Transcript") {
      SettingsToggleRow(
        "Expand image reads", expand, prefs::setAutoExpandImageReads,
        description = "Open Read tool calls that returned an image, so screenshots show without a tap.",
      )
    }
  }
}

/** Notification permission: ask once, and send a denial to Android's settings, the only place that can undo it. */
@Composable
fun AlertsSettingsPage() {
  val context = LocalContext.current
  var enabled by remember { mutableStateOf(NotificationManagerCompat.from(context).areNotificationsEnabled()) }
  var asked by remember { mutableStateOf(false) }
  val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    enabled = granted
    asked = true
  }
  // Coming back from Android's settings.
  OnResume(connected = true) { enabled = NotificationManagerCompat.from(context).areNotificationsEnabled() }
  val canAsk = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !asked
  val push = (context.applicationContext as ArgusApplication).platform.push
  val pushState by push.state.collectAsState()
  var pushEnabled by remember { mutableStateOf(push.enabled) }
  var needsYou by remember { mutableStateOf(push.alertNeedsYou) }
  var finished by remember { mutableStateOf(push.alertFinished) }
  val scope = rememberCoroutineScope()
  SettingsPage {
    SettingsGroup(footer = "Get alerted when an agent needs you or finishes.") {
      SettingsRow("Notifications", description = if (enabled) "On" else if (canAsk) "Not enabled" else "Off in Android settings") {
        when {
          enabled -> Unit
          canAsk -> Btn("Enable", small = true, hugs = true) { request.launch(Manifest.permission.POST_NOTIFICATIONS) }
          else -> Btn("Open Android Settings", tone = ButtonTone.Secondary, small = true, hugs = true) {
            context.startActivity(
              Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
          }
        }
      }
      SettingsToggleRow("Background push", pushEnabled, { on ->
        pushEnabled = on
        scope.launch { push.setEnabled(on) }
      }, description = pushState.explanation)
    }
    AlertCategoriesGroup(
      needsYou = needsYou,
      finished = finished,
      onNeedsYou = { on -> needsYou = on; scope.launch { push.setAlert(needsYou = on) } },
      onFinished = { on -> finished = on; scope.launch { push.setAlert(finished = on) } },
    )
  }
}

/** Voice mode's voice, speed and when it speaks; read and written on this device only. */
@Composable
fun VoiceSettingsPage() {
  val preferences = LocalAppStore.current.preferences
  SettingsPage { VoiceSettingsGroup(preferences) }
}

@Composable
fun PrivacySettingsPage() {
  val mode by Telemetry.mode.collectAsState()
  SettingsPage {
    SettingsGroup(title = "Privacy") {
      SettingsToggleRow(
        "Anonymous usage and crash reports", mode == TelemetryMode.Full,
        { Telemetry.setMode(if (it) TelemetryMode.Full else TelemetryMode.Presence) },
        description = "Off, Argus sends one anonymous heartbeat per launch so we can count installs. On, it also sends " +
          "which screens you open, which actions you take, and crash reports — never prompts, project names, branches or paths.",
      )
    }
  }
}
