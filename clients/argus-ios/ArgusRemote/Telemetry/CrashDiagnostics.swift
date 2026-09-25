import Foundation
import MetricKit

/// Crash and hang reports, via MetricKit.
///
/// `posthog-ios` has no crash reporter of its own — no mach or signal
/// handlers — so a Swift runtime trap would otherwise leave no trace at all.
/// MetricKit costs nothing extra and covers real crashes, with one catch: the
/// payload arrives on the *next* launch, so it describes the build that
/// crashed rather than the one reporting it. That build ships as
/// `crashed_app_version` rather than overloading `app_version`.
///
/// Nothing is delivered in the simulator; testing this needs a device.
final class CrashDiagnostics: NSObject, MXMetricManagerSubscriber {
  func subscribe() {
    MXMetricManager.shared.add(self)
  }

  nonisolated func didReceive(_ payloads: [MXDiagnosticPayload]) {
    // The payload types aren't `Sendable`, so everything worth sending is
    // pulled out here and only the strings cross over.
    let reports = payloads.flatMap(Self.reports(in:))
    guard !reports.isEmpty else { return }
    Task { @MainActor in
      for report in reports {
        Telemetry.captureException(
          type: report.type, message: report.message, source: "metrickit",
          extra: [
            "$exception_stack_trace_raw": report.stackTrace,
            "$exception_level": report.level,
            "crashed_app_version": report.appVersion,
          ])
      }
      Telemetry.flush()
    }
  }

  /// One crash or hang, flattened to what PostHog needs.
  private struct Report: Sendable {
    var type: String
    var message: String
    var stackTrace: String
    var level: String
    var appVersion: String
  }

  private static func reports(in payload: MXDiagnosticPayload) -> [Report] {
    let crashes = (payload.crashDiagnostics ?? []).map { crash in
      Report(
        type: describe(crash),
        message: crash.terminationReason ?? "Crash",
        stackTrace: stackTrace(crash.callStackTree),
        level: "error",
        appVersion: crash.metaData.applicationBuildVersion)
    }
    let hangs = (payload.hangDiagnostics ?? []).map { hang in
      Report(
        type: "Hang",
        message: "The app was unresponsive for \(hang.hangDuration).",
        stackTrace: stackTrace(hang.callStackTree),
        level: "warning",
        appVersion: hang.metaData.applicationBuildVersion)
    }

    return crashes + hangs
  }

  /// Mach exception plus signal — the pair is what identifies the crash;
  /// neither is reliably present on its own.
  private static func describe(_ crash: MXCrashDiagnostic) -> String {
    let exception = crash.exceptionType.map { "exception \($0)" }
    let signal = crash.signal.map { "signal \($0)" }
    let parts = [exception, signal].compactMap(\.self)

    return parts.isEmpty ? "Crash" : parts.joined(separator: " / ")
  }

  private static func stackTrace(_ tree: MXCallStackTree) -> String {
    let json = String(data: tree.jsonRepresentation(), encoding: .utf8) ?? ""

    return String(Telemetry.scrub(json).prefix(20000))
  }
}
