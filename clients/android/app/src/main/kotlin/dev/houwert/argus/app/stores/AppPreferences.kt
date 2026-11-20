package dev.houwert.argus.app.stores

import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.storage.Preferences
import dev.houwert.argus.ui.theme.ColorTheme
import dev.houwert.argus.ui.theme.ThemePreference
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** This phone's own preferences (telemetry consent lives in [Telemetry]), read once and written through to [preferences]. */
class AppPreferences(private val preferences: Preferences) {
  private val _theme = MutableStateFlow(ThemePreference.sanitize(preferences.string(PreferenceKey.THEME)))
  val theme: StateFlow<ThemePreference> = _theme.asStateFlow()
  private val _colorTheme = MutableStateFlow(ColorTheme.sanitize(preferences.string(PreferenceKey.COLOR_THEME)))
  val colorTheme: StateFlow<ColorTheme> = _colorTheme.asStateFlow()
  private val _autoExpandImageReads = MutableStateFlow(preferences.string(PreferenceKey.AUTO_EXPAND_IMAGE_READS) == "on")
  val autoExpandImageReads: StateFlow<Boolean> = _autoExpandImageReads.asStateFlow()
  /** Null starts agents in the computer's own default. */
  private val _defaultPermissionMode = MutableStateFlow(preferences.string(PreferenceKey.DEFAULT_PERMISSION_MODE)?.let(::RemotePermissionMode))
  val defaultPermissionMode: StateFlow<RemotePermissionMode?> = _defaultPermissionMode.asStateFlow()

  fun setTheme(value: ThemePreference) {
    if (value == _theme.value) return
    _theme.value = value
    Telemetry.capture(TelemetryEvent.AppearanceChanged(TelemetryEvent.Appearance.entries.first { it.wire == value.raw }))
    preferences.set(value.raw, PreferenceKey.THEME)
  }

  fun setColorTheme(value: ColorTheme) {
    if (value == _colorTheme.value) return
    _colorTheme.value = value
    Telemetry.capture(TelemetryEvent.ColorThemeChanged(value.raw))
    preferences.set(value.raw, PreferenceKey.COLOR_THEME)
  }

  fun setAutoExpandImageReads(enabled: Boolean) {
    _autoExpandImageReads.value = enabled
    Telemetry.capture(TelemetryEvent.SettingChanged(TelemetryEvent.Setting.AutoExpandImageReads, enabled))
    preferences.set(if (enabled) "on" else "off", PreferenceKey.AUTO_EXPAND_IMAGE_READS)
  }

  fun setDefaultPermissionMode(mode: RemotePermissionMode?) {
    _defaultPermissionMode.value = mode
    Telemetry.capture(TelemetryEvent.DefaultChanged(TelemetryEvent.DefaultSetting.PermissionMode, mode?.rawValue ?: "computer"))
    preferences.set(mode?.rawValue, PreferenceKey.DEFAULT_PERMISSION_MODE)
  }

}
