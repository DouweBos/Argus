import ArgusCore
import SwiftUI

/// A signal trigger's fields: which events, which labels, and how often it may run.
public struct SignalTriggerFields: View {
  @Binding var signal: RemoteAutomationSignal

  public init(signal: Binding<RemoteAutomationSignal>) {
    self._signal = signal
  }

  public var body: some View {
    ToggleList(
      title: "Events",
      options: Self.eventOptions(picked: signal.on).map { .init(id: $0.rawValue, label: $0.label) },
      selection: Binding(
        get: { signal.on.map(\.rawValue) },
        set: { signal.on = $0.map(RemoteSignalEvent.init(rawValue:)) }))
    VStack(alignment: .leading, spacing: 4) {
      MutedText("Labels — \(AutomationTriggerText.labelsCaption)")
      ThemedTextField(
        placeholder: AutomationTriggerText.labelsPlaceholder,
        text: Binding(
          get: { AutomationTriggerText.labelsText(signal.labels) },
          set: { signal.labels = AutomationTriggerText.labels($0) }),
        mono: true, input: .code)
    }
    FireFields(fire: $signal.fire, maxRunsPerHour: $signal.maxRunsPerHour)
  }

  /// The known events, plus any a newer computer set that this build can't name.
  public static func eventOptions(picked: [RemoteSignalEvent]) -> [RemoteSignalEvent] {
    RemoteSignalEvent.all + picked.filter { !RemoteSignalEvent.all.contains($0) }
  }
}

/// A webhook trigger's fields: its URL, its secret, and how often it may run.
public struct WebhookTriggerFields: View {
  @Environment(\.theme) private var theme
  @Binding var webhook: RemoteAutomationWebhook
  /// Nil until the automation is saved, or when the viewer can't change it.
  let rotate: (() async -> RemoteWebhookSecret?)?
  let saved: Bool

  @State private var secret: String?
  @State private var rotating = false

  public init(
    webhook: Binding<RemoteAutomationWebhook>, saved: Bool, rotate: (() async -> RemoteWebhookSecret?)?
  ) {
    self._webhook = webhook
    self.saved = saved
    self.rotate = rotate
  }

  public var body: some View {
    if !saved {
      MutedText(AutomationTriggerText.unsaved)
    } else {
      if let url = webhook.url {
        copyRow(url, label: "Copy URL")
      } else {
        MutedText(AutomationTriggerText.noUrl)
      }
      if let secret {
        VStack(alignment: .leading, spacing: 4) {
          copyRow(secret, label: "Copy secret")
          Text(AutomationTriggerText.secretOnce).font(.scaled(size: 13)).foregroundStyle(theme.warning)
        }
      }
      if let rotate {
        Btn(
          label: AutomationTriggerText.secretButton(hasSecret: webhook.hasSecret), tone: .secondary,
          small: true, hugs: true, busy: rotating
        ) {
          rotating = true
          Task {
            if let made = await rotate() {
              secret = made.secret
              webhook.hasSecret = true
              webhook.url = made.url
            }
            rotating = false
          }
        }
      }
    }
    FireFields(fire: $webhook.fire, maxRunsPerHour: $webhook.maxRunsPerHour)
  }

  private func copyRow(_ value: String, label: String) -> some View {
    HStack(spacing: 8) {
      Text(value)
        .font(.scaled(size: 13).monospaced())
        .foregroundStyle(theme.text)
        .lineLimit(2)
        .truncationMode(.middle)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
      IconBtn(systemName: Icon.copy, label: label) { Clipboard.copy(value) }
    }
    .padding(10)
    .background(theme.bgTertiary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
  }
}

/// One run per event or one for the lot, and the hourly cap both event triggers keep.
struct FireFields: View {
  @Binding var fire: RemoteSignalFire
  @Binding var maxRunsPerHour: Double

  var body: some View {
    SegmentedControl(value: $fire, options: RemoteSignalFire.allCases.map { ($0, $0.label) })
    VStack(alignment: .leading, spacing: 4) {
      MutedText("Runs per hour — \(AutomationTriggerText.capCaption)")
      ThemedTextField(
        placeholder: String(Int(RemoteAutomationSignal.defaultRunsPerHour)),
        text: Binding(
          get: { String(Int(maxRunsPerHour)) },
          set: { typed in
            guard let value = Double(typed) else { return }
            maxRunsPerHour = AutomationTriggerText.clampRuns(value)
          }),
        keyboard: .decimalPad, mono: true, input: .code)
    }
  }
}
