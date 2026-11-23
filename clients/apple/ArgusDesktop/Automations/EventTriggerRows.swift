import ArgusCore
import ArgusUI
import SwiftUI

/// A signal trigger's events, one toggle row each, under the trigger section.
struct SignalEventsSection: View {
  @Binding var signal: RemoteAutomationSignal
  let error: String?

  var body: some View {
    let ids = SignalTriggerFields.eventOptions(picked: signal.on).map(\.rawValue)
    Section {
      ForEach(SignalTriggerFields.eventOptions(picked: signal.on), id: \.self) { event in
        Toggle(event.label, isOn: membership(event))
      }
    } header: {
      ScopeHeader(title: "Events", ids: ids, selection: rawSelection)
    } footer: {
      if let error {
        Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
      } else {
        Text(AutomationTriggerText.signalCaption)
      }
    }
  }

  private var rawSelection: Binding<[String]> {
    Binding(
      get: { signal.on.map(\.rawValue) },
      set: { signal.on = $0.map(RemoteSignalEvent.init(rawValue:)) })
  }

  private func membership(_ event: RemoteSignalEvent) -> Binding<Bool> {
    Binding(
      get: { signal.on.contains(event) },
      set: { on in
        signal.on.removeAll { $0 == event }
        if on { signal.on.append(event) }
      })
  }
}

/// A signal trigger's label filter, inside the trigger section.
struct SignalLabelsRow: View {
  @Binding var labels: [String]

  var body: some View {
    TextField(
      text: Binding(
        get: { AutomationTriggerText.labelsText(labels) },
        set: { labels = AutomationTriggerText.labels($0) }),
      prompt: Text(AutomationTriggerText.labelsPlaceholder)
    ) {
      Text("Labels")
      Text(AutomationTriggerText.labelsCaption)
    }
  }
}

/// One run per event or one for the lot, and the hourly cap.
struct FireRows: View {
  @Binding var fire: RemoteSignalFire
  @Binding var maxRunsPerHour: Double

  var body: some View {
    Picker("Runs", selection: $fire) {
      ForEach(RemoteSignalFire.allCases, id: \.self) { Text($0.label).tag($0) }
    }
    Stepper(
      value: Binding(get: { maxRunsPerHour }, set: { maxRunsPerHour = AutomationTriggerText.clampRuns($0) }),
      in: RemoteAutomationSignal.runsPerHourRange
    ) {
      LabeledContent {
        Text("\(Int(maxRunsPerHour))").monospacedDigit()
      } label: {
        Text("Runs per hour")
        Text(AutomationTriggerText.capCaption)
      }
    }
  }
}

/// The webhook's address and secret. The secret shows once, straight after
/// it's made; the host keeps only its hash.
struct WebhookRows: View {
  @Binding var webhook: RemoteAutomationWebhook
  let rotate: () async -> RemoteWebhookSecret?

  @State private var secret: String?
  @State private var rotating = false

  var body: some View {
    LabeledContent("URL") {
      if let url = webhook.url {
        CopyableValue(value: url, help: "Copy URL")
      } else {
        Text(AutomationTriggerText.noUrl).foregroundStyle(.secondary)
      }
    }
    if let secret {
      LabeledContent {
        CopyableValue(value: secret, help: "Copy secret")
      } label: {
        Text("Secret")
        Text(AutomationTriggerText.secretOnce).foregroundStyle(.orange)
      }
    }
    HStack {
      Spacer()
      if rotating { ProgressView().controlSize(.small) }
      Button(AutomationTriggerText.secretButton(hasSecret: webhook.hasSecret)) {
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
      .disabled(rotating)
    }
  }
}

/// A monospaced value that can be selected, with a copy button beside it.
private struct CopyableValue: View {
  let value: String
  let help: String

  var body: some View {
    HStack(spacing: 6) {
      Text(value)
        .font(.system(.body, design: .monospaced))
        .lineLimit(1)
        .truncationMode(.middle)
        .textSelection(.enabled)
      Button {
        Clipboard.copy(value)
      } label: {
        Image(systemName: Icon.copy)
      }
      .buttonStyle(.argusBorderless)
      .help(help)
      .accessibilityLabel(help)
    }
  }
}
