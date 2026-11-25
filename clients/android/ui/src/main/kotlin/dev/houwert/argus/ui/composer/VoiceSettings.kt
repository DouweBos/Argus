package dev.houwert.argus.ui.composer

import dev.houwert.argus.kit.storage.Preferences
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

/** How voice mode speaks, per device. */
data class VoiceSettings(
  /** A `TextToSpeech` voice name; null is the system's voice for the current language. */
  val voiceId: String? = null,
  /** A multiple of the system's normal speaking rate. */
  val speed: Double = 1.0,
  /** Stay quiet while Argus is in front, and only listen. */
  val onlyInBackground: Boolean = false,
) {
  fun save(preferences: Preferences) {
    val fields = buildMap {
      voiceId?.let { put("voiceId", JsonPrimitive(it)) }
      put("speed", JsonPrimitive(speed))
      put("onlyInBackground", JsonPrimitive(onlyInBackground))
    }
    preferences.encode(JsonObject(fields), JsonObject.serializer(), KEY)
  }

  companion object {
    val DEFAULT = VoiceSettings()
    val SPEEDS = 0.5..2.0

    internal const val KEY = "voice.settings"
    internal const val MODE_KEY = "voice.mode"

    fun load(preferences: Preferences): VoiceSettings {
      val json = runCatching { preferences.decode(KEY, JsonObject.serializer()) }.getOrNull() ?: return DEFAULT
      return VoiceSettings(
        voiceId = (json["voiceId"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
        speed = json["speed"]?.jsonPrimitive?.doubleOrNull ?: DEFAULT.speed,
        onlyInBackground = json["onlyInBackground"]?.jsonPrimitive?.booleanOrNull ?: DEFAULT.onlyInBackground,
      )
    }

    /** Voice mode is one switch for the whole app, not per agent. */
    fun isModeOn(preferences: Preferences): Boolean = preferences.string(MODE_KEY) == "on"

    internal fun setMode(on: Boolean, preferences: Preferences) = preferences.set(if (on) "on" else null, MODE_KEY)
  }
}
