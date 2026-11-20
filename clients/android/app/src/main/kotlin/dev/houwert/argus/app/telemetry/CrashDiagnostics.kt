package dev.houwert.argus.app.telemetry

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import androidx.annotation.RequiresApi
import dev.houwert.argus.app.BuildConfig
import dev.houwert.argus.kit.storage.Preferences
import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Crashes, ANRs and native crashes, reported on the next launch.
 *
 * A JVM crash is caught by an uncaught-exception handler that only writes a scrubbed report to disk
 * (the process is dying; a network send would race it). ANRs and native crashes never reach that
 * handler, so they come from [ApplicationExitInfo] on API 30+. Either way the report is sent by the
 * build after the one that crashed, which ships as `crashed_app_version`.
 */
internal class CrashDiagnostics(private val context: Context, private val preferences: Preferences) {
  private val pending = File(context.filesDir, "telemetry-crash.json")

  @Serializable
  private data class Report(val type: String, val message: String, val stackTrace: String, val appVersion: String)

  fun install() {
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      // Only written while sharing is on, so presence mode keeps nothing about the crash either.
      if (Telemetry.currentMode == TelemetryMode.Full) runCatching { persist(error) }
      previous?.uncaughtException(thread, error)
    }
    // Stamped on the process so an exit record can say which build it was.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      runCatching { context.getSystemService(ActivityManager::class.java)?.setProcessStateSummary(BuildConfig.VERSION_NAME.toByteArray()) }
    }
    sendPending()
  }

  /** The last launch's crash, and any exits the system recorded since the last look. */
  fun sendPending() {
    if (Telemetry.currentMode != TelemetryMode.Full) return
    runCatching { pending.takeIf { it.exists() }?.readText() }.getOrNull()?.let { text ->
      pending.delete()
      runCatching { json.decodeFromString(Report.serializer(), text) }.getOrNull()?.let { report ->
        Telemetry.captureException(
          type = report.type,
          message = report.message,
          source = "uncaughtException",
          extra = mapOf("\$exception_stack_trace_raw" to report.stackTrace, "crashed_app_version" to report.appVersion),
        )
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) reportExits()
    Telemetry.flush()
  }

  private fun persist(error: Throwable) {
    val report = Report(
      type = error.javaClass.name.substringAfterLast('.'),
      message = Telemetry.scrub(error.message.orEmpty()).take(2000),
      stackTrace = Telemetry.scrub(error.stackTraceToString()).take(MAX_TRACE),
      appVersion = BuildConfig.VERSION_NAME,
    )
    pending.writeText(json.encodeToString(Report.serializer(), report))
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun reportExits() {
    val activity = context.getSystemService(ActivityManager::class.java) ?: return
    val seen = preferences.string(EXIT_SEEN_KEY)?.toLongOrNull()
    val exits = runCatching { activity.getHistoricalProcessExitReasons(context.packageName, 0, 10) }.getOrNull().orEmpty()
    exits.maxOfOrNull { it.timestamp }?.let { preferences.set(it.toString(), EXIT_SEEN_KEY) }
    // The first look only sets the mark: exits from before telemetry started aren't this install's news.
    if (seen == null) return
    for (exit in exits.filter { it.timestamp > seen }) {
      val (type, level) = when (exit.reason) {
        ApplicationExitInfo.REASON_ANR -> "ANR" to "warning"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "NativeCrash" to "error"
        else -> continue
      }
      val trace = if (exit.reason == ApplicationExitInfo.REASON_ANR) anrTrace(exit) else ""
      Telemetry.captureException(
        type = type,
        message = exit.description.orEmpty().ifEmpty { type },
        source = "exit_info",
        extra = mapOf(
          "\$exception_stack_trace_raw" to trace,
          "\$exception_level" to level,
          "crashed_app_version" to versionOf(exit),
        ),
      )
    }
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun anrTrace(exit: ApplicationExitInfo): String =
    runCatching { exit.traceInputStream?.bufferedReader()?.use { Telemetry.scrub(it.readText()).take(MAX_TRACE) } }.getOrNull().orEmpty()

  /** The version [install] stamped on that process. */
  @RequiresApi(Build.VERSION_CODES.R)
  private fun versionOf(exit: ApplicationExitInfo): String =
    runCatching { exit.processStateSummary?.decodeToString() }.getOrNull()?.takeIf { it.isNotEmpty() } ?: "unknown"

  private companion object {
    const val EXIT_SEEN_KEY = "telemetry.exit.seen"
    const val MAX_TRACE = 20_000
    val json = Json { ignoreUnknownKeys = true }
  }
}
