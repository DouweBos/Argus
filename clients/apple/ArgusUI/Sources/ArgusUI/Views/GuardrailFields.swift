import ArgusCore
import SwiftUI

/// The limits a run is held to, whatever its playbook says. Enforced on the
/// computer, never in the prompt — this only edits the numbers.
public struct GuardrailFields: View {
  @Environment(\.theme) private var theme
  @Binding var guardrails: RemoteAutomationGuardrails

  public init(guardrails: Binding<RemoteAutomationGuardrails>) {
    self._guardrails = guardrails
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      number(
        "Confidence threshold", caption: "Below this, a proposal waits for you.",
        value: $guardrails.confidenceThreshold, fallback: 0.8)
      number(
        "Sessions at once", caption: "Auto-started, in flight.",
        value: $guardrails.maxConcurrentSessions, fallback: 2)
      number(
        "Files changed", caption: "A bigger branch is never pushed.",
        value: $guardrails.maxFilesChanged, fallback: 25)
      number(
        "Time limit (minutes)", caption: "A run past this is stopped and marked failed.",
        value: $guardrails.maxRunMinutes, fallback: 20)
      number(
        "Spend ceiling (USD)",
        caption: guardrails.maxCostUsdPerRun > 0
          ? "A run crossing this finishes its turn, then stops."
          : "Off — a run spends what the work costs.",
        value: $guardrails.maxCostUsdPerRun, fallback: 0)

      MutedText("Path denylist — comma-separated globs no run may touch.")
      ThemedTextField(
        placeholder: "infra/**, **/*.lock",
        text: Binding(
          get: { guardrails.pathDenylist.joined(separator: ", ") },
          set: { text in
            guardrails.pathDenylist =
              text.split(separator: ",")
              .map { $0.trimmingCharacters(in: .whitespaces) }
              .filter { !$0.isEmpty }
          }),
        mono: true, input: .code)

      Toggle("Require green CI before an auto-merge", isOn: $guardrails.requireCleanCi)
        .font(.scaled(size: 14))
        .tint(theme.accent)

      Toggle(
        "Retry on another Claude account when a usage limit is hit",
        isOn: $guardrails.retryOtherAccounts
      )
      .font(.scaled(size: 14))
      .tint(theme.accent)
    }
  }

  private func number(
    _ label: String, caption: String, value: Binding<Double>, fallback: Double
  ) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      MutedText("\(label) — \(caption)")
      ThemedTextField(
        placeholder: String(fallback),
        text: Binding(
          get: { Self.format(value.wrappedValue) },
          // Keep what was typed until it parses: rejecting mid-edit text would
          // fight every keystroke that isn't yet a number.
          set: { typed in
            let parsed = Double(typed.replacingOccurrences(of: ",", with: "."))
            value.wrappedValue = (parsed.map { $0 >= 0 ? $0 : fallback }) ?? fallback
          }),
        keyboard: .decimalPad, mono: true, input: .code)
    }
  }

  private static func format(_ value: Double) -> String {
    value == value.rounded() ? String(Int(value)) : String(value)
  }
}
