package dev.houwert.argus.app.telemetry

import android.content.Context
import android.os.Build
import com.posthog.PersonProfiles
import com.posthog.PostHog
import com.posthog.android.PostHogAndroid
import com.posthog.android.PostHogAndroidConfig
import dev.houwert.argus.app.BuildConfig
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.StoreEvent
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.storage.Preferences
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** How much this install shares. `Presence` is the floor and the default, as on the desktop and iPhone. */
enum class TelemetryMode(val wire: String) { Presence("presence"), Full("full") }

/**
 * The only file that touches the PostHog SDK. Privacy rules, identical to the iPhone's and the host's:
 *
 * - The distinct id is a random UUID in preferences, never linked to an account; `identify` is never called.
 * - No autocapture, lifecycle, deep-link, screen-view or session-replay capture, and the SDK's device
 *   context is stripped: everything sent is sent from here, explicitly.
 * - `Presence` sends one `$pageview` heartbeat per launch and nothing else. `Full` unlocks the
 *   catalog, `$screen` and `$exception`.
 * - Off entirely when `POSTHOG_KEY` is empty, which is what a plain checkout builds.
 */
object Telemetry {
  @Volatile private var client: Boolean = false
  private var preferences: Preferences? = null
  private var distinctId = ""
  private var baseProps: Map<String, Any> = emptyMap()
  private var crashes: CrashDiagnostics? = null

  private val _mode = MutableStateFlow(TelemetryMode.Presence)
  /** For a Settings toggle to bind to. */
  val mode: StateFlow<TelemetryMode> = _mode.asStateFlow()
  val currentMode: TelemetryMode get() = _mode.value

  /** True once the consent sheet was answered, so it only shows on a fresh install. */
  val hasAnsweredConsent: Boolean get() = preferences?.string(PreferenceKey.TELEMETRY_CONSENT_SEEN) == "yes"

  fun start(context: Context, preferences: Preferences) {
    if (this.preferences != null) return
    this.preferences = preferences
    distinctId = anonymousId(preferences)
    _mode.value = TelemetryMode.entries.firstOrNull { it.wire == preferences.string(PreferenceKey.TELEMETRY_MODE) }
      ?: TelemetryMode.Presence

    val key = BuildConfig.POSTHOG_KEY
    if (key.isEmpty()) return

    val config = PostHogAndroidConfig(key, BuildConfig.POSTHOG_HOST).apply {
      captureApplicationLifecycleEvents = false
      captureDeepLinks = false
      captureScreenViews = false
      captureElementInteractions = false
      capturePushNotificationOpened = false
      capturePushNotificationSubscriptions = false
      sessionReplay = false
      preloadFeatureFlags = false
      surveys = false
      personProfiles = PersonProfiles.IDENTIFIED_ONLY
      errorTrackingConfig.autoCapture = false
      errorTrackingConfig.captureNativeCrashes = false
      // Low volume: send each event as it happens rather than lose a batch when the app is killed.
      flushAt = 1
      getAnonymousId = { fallback -> runCatching { UUID.fromString(distinctId) }.getOrDefault(fallback) }
      propertiesSanitizer = com.posthog.PostHogPropertiesSanitizer { props -> props.filterKeys { !isDeviceContext(it) }.toMutableMap() }
    }
    PostHogAndroid.setup(context.applicationContext, config)
    client = true
    baseProps = baseProps(context)

    captureHeartbeat()
    crashes = CrashDiagnostics(context.applicationContext, preferences).also { it.install() }
    capture(TelemetryEvent.Launched)
  }

  fun setMode(next: TelemetryMode) {
    val preferences = preferences ?: return
    preferences.set("yes", PreferenceKey.TELEMETRY_CONSENT_SEEN)
    preferences.set(next.wire, PreferenceKey.TELEMETRY_MODE)
    if (next == _mode.value) return

    if (next == TelemetryMode.Full) {
      _mode.value = TelemetryMode.Full
      capture(TelemetryEvent.TelemetryEnabled)
      capture(TelemetryEvent.Launched)
      crashes?.sendPending()
      return
    }
    // Record the downgrade before the gate closes on it.
    capture(TelemetryEvent.TelemetryDisabled)
    _mode.value = TelemetryMode.Presence
    flush()
  }

  fun capture(event: TelemetryEvent) {
    if (!client || _mode.value != TelemetryMode.Full) return
    send(event.name, baseProps + event.properties)
  }

  /** The shared stores report what they did; this is where it joins the app's catalog. */
  fun capture(event: StoreEvent) = capture(from(event))

  /** A route pattern (`/sessions/:sessionId`), never a title or an identifier. */
  fun screen(pattern: String) {
    if (!client || _mode.value != TelemetryMode.Full) return
    send("\$screen", baseProps + mapOf("\$screen_name" to pattern))
  }

  fun captureException(error: Throwable, source: String, extra: Map<String, Any> = emptyMap()) {
    captureException(
      type = error.javaClass.simpleName.ifEmpty { "Throwable" },
      message = HostStore.describe(error),
      source = source,
      extra = extra,
    )
  }

  /** The raw form, for a type and message without a live [Throwable]: a report from the last launch. */
  fun captureException(type: String, message: String, source: String, extra: Map<String, Any> = emptyMap()) {
    // Stack traces can leak paths even after scrubbing, so they stay behind the full-mode gate.
    if (!client || _mode.value != TelemetryMode.Full) return
    val props = baseProps.toMutableMap()
    props["\$exception_type"] = type
    props["\$exception_message"] = scrub(message).take(2000)
    props["\$exception_level"] = "error"
    props["source"] = source
    props.putAll(extra)
    send("\$exception", props)
  }

  fun flush() {
    if (client) PostHog.flush()
  }

  /** Strip anything that looks like a file path: host-side paths otherwise ride along in error messages. */
  fun scrub(message: String): String = SCRUBBERS.fold(message) { text, (pattern, replacement) -> pattern.replace(text, replacement) }

  private val SCRUBBERS = listOf(
    Regex("/Users/[^/\\s'\")]+") to "/Users/<user>",
    Regex("/home/[^/\\s'\")]+") to "/home/<user>",
    Regex("[A-Za-z]:\\\\Users\\\\[^\\\\\\s'\")]+") to "C:\\\\Users\\\\<user>",
    Regex("/data/(user/\\d+|data)/[^\\s'\")]+") to "/data/<path>",
    Regex("/storage/emulated/\\d+/[^\\s'\")]+") to "/storage/<path>",
  )

  internal fun from(event: StoreEvent): TelemetryEvent = when (event) {
    is StoreEvent.MessageSent -> TelemetryEvent.MessageSent(event.queued, event.hasImages, event.length)
    is StoreEvent.MessageSendFailed -> TelemetryEvent.MessageSendFailed(event.retried)
    is StoreEvent.PermissionAnswered -> TelemetryEvent.PermissionAnswered(event.approved, event.alwaysAllow, event.fromNotification)
    is StoreEvent.AgentControlled -> TelemetryEvent.AgentControlled(event.action)
    is StoreEvent.WorkLanded -> TelemetryEvent.WorkLanded(event.action, event.success, event.strategy)
    is StoreEvent.CommitComposed -> TelemetryEvent.CommitComposed(event.hasDescription, event.signOff, event.signed)
    is StoreEvent.ClaudeAccountChanged -> TelemetryEvent.ClaudeAccountChanged(event.action)
    is StoreEvent.AutomationEdited -> TelemetryEvent.AutomationEdited(event.action)
    is StoreEvent.RunActed -> TelemetryEvent.RunActed(event.action)
    is StoreEvent.ProposalHandled -> TelemetryEvent.ProposalHandled(event.action)
    is StoreEvent.PullRequestActed -> TelemetryEvent.PullRequestActed(event.action)
    is StoreEvent.BranchActed -> TelemetryEvent.BranchActed(event.action)
    is StoreEvent.SessionRenamed -> TelemetryEvent.SessionRenamed(event.target)
    is StoreEvent.MemoryEdited -> TelemetryEvent.MemoryEdited(event.action)
    is StoreEvent.DiffReviewed -> TelemetryEvent.DiffReviewed(event.action, event.comments)
    is StoreEvent.DiffScoped -> TelemetryEvent.DiffScoped(event.scope)
    is StoreEvent.TimelineOpened -> TelemetryEvent.TimelineOpened(event.turns)
    is StoreEvent.ReviewGuideUsed -> TelemetryEvent.ReviewGuideUsed(event.action, event.stops)
    is StoreEvent.OfflineReply -> TelemetryEvent.OfflineReply(event.action)
  }

  private fun send(name: String, properties: Map<String, Any>) {
    PostHog.capture(event = name, distinctId = distinctId, properties = properties)
  }

  /**
   * PostHog counts DAU from `$pageview`, so presence-only installs are only countable because of
   * this. It carries `app_version` and nothing else; the path is a fixed literal.
   */
  private fun captureHeartbeat() {
    send(
      "\$pageview",
      mapOf(
        "\$current_url" to "argus-android:///",
        "\$pathname" to "/",
        "app_version" to BuildConfig.VERSION_NAME,
        "source" to "heartbeat",
      ),
    )
  }

  /** Full mode only; the heartbeat skips these so a presence-only install leaks no device detail. */
  private fun baseProps(context: Context): Map<String, Any> = mapOf(
    "app_version" to BuildConfig.VERSION_NAME,
    "build_number" to BuildConfig.VERSION_CODE.toString(),
    "platform" to "android",
    "os_version" to Build.VERSION.RELEASE,
    "sdk_int" to Build.VERSION.SDK_INT,
    // The hardware model (`Pixel 8`), never the name the user gave the phone.
    "device_model" to Build.MODEL,
    "is_debug" to BuildConfig.DEBUG,
    "is_play_store" to isFromPlayStore(context),
    "client" to "android",
  )

  private fun isFromPlayStore(context: Context): Boolean = runCatching {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
    } else {
      @Suppress("DEPRECATION") context.packageManager.getInstallerPackageName(context.packageName)
    } == "com.android.vending"
  }.getOrDefault(false)

  /** The SDK's own device, app, locale and network context, which neither mode promises to send. */
  private fun isDeviceContext(key: String): Boolean =
    key != "\$device_id" && DEVICE_CONTEXT.any { key == it || (it.endsWith('_') && key.startsWith(it)) }

  private val DEVICE_CONTEXT = listOf(
    "\$app_", "\$device_", "\$os_", "\$network_", "\$screen_width", "\$screen_height", "\$screen_density",
    "\$locale", "\$timezone", "\$user_agent", "\$raw_user_agent", "\$is_emulator", "\$is_sideloaded",
  )

  private fun anonymousId(preferences: Preferences): String {
    preferences.string(PreferenceKey.TELEMETRY_ID)?.takeIf { it.isNotEmpty() }?.let { return it }
    val fresh = UUID.randomUUID().toString().uppercase()
    preferences.set(fresh, PreferenceKey.TELEMETRY_ID)
    return fresh
  }
}
