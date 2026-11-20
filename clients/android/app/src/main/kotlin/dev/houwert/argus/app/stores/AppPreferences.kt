package dev.houwert.argus.app.stores

import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.storage.Preferences
import dev.houwert.argus.ui.theme.ColorTheme
import dev.houwert.argus.ui.theme.ThemePreference
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What telemetry may send: one launch heartbeat, or the full event catalog. */
enum class TelemetryMode(val raw: String) {
  Presence("presence"),
  Full("full");

  companion object {
    fun sanitize(raw: String?) = entries.firstOrNull { it.raw == raw } ?: Presence
  }
}

/** This phone's own preferences, read once and written through to [preferences]. */
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
  private val _telemetryMode = MutableStateFlow(TelemetryMode.sanitize(preferences.string(PreferenceKey.TELEMETRY_MODE)))
  val telemetryMode: StateFlow<TelemetryMode> = _telemetryMode.asStateFlow()

  fun setTheme(value: ThemePreference) {
    _theme.value = value
    preferences.set(value.raw, PreferenceKey.THEME)
  }

  fun setColorTheme(value: ColorTheme) {
    _colorTheme.value = value
    preferences.set(value.raw, PreferenceKey.COLOR_THEME)
  }

  fun setAutoExpandImageReads(enabled: Boolean) {
    _autoExpandImageReads.value = enabled
    preferences.set(if (enabled) "on" else "off", PreferenceKey.AUTO_EXPAND_IMAGE_READS)
  }

  fun setDefaultPermissionMode(mode: RemotePermissionMode?) {
    _defaultPermissionMode.value = mode
    preferences.set(mode?.rawValue, PreferenceKey.DEFAULT_PERMISSION_MODE)
  }

  fun setTelemetryMode(mode: TelemetryMode) {
    _telemetryMode.value = mode
    preferences.set(mode.raw, PreferenceKey.TELEMETRY_MODE)
  }
}
