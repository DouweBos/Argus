import ArgusUI
import SwiftUI

/// The explanation under a setting, as the desktop's field captions.
struct SettingsCaption: View {
  let text: String

  init(_ text: String) { self.text = text }

  var body: some View {
    Text(text)
      .font(.caption)
      .foregroundStyle(.secondary)
      .fixedSize(horizontal: false, vertical: true)
  }
}

/// A failure the Settings window couldn't recover from on its own.
struct SettingsError: View {
  @Environment(\.theme) private var theme
  let text: String?

  var body: some View {
    if let text {
      Label(text, systemImage: "exclamationmark.triangle")
        .font(.caption)
        .foregroundStyle(theme.error)
        .textSelection(.enabled)
    }
  }
}

/// A host setting that hasn't loaded yet.
struct SettingsLoading: View {
  var body: some View {
    HStack {
      ProgressView().controlSize(.small)
      Text("Loading…").foregroundStyle(.secondary)
    }
  }
}

extension Binding {
  /// Reports `field` whenever the user changes the value.
  @MainActor
  func tracked(_ field: SettingsField) -> Binding<Value> {
    Binding(
      get: { wrappedValue },
      set: { next in
        wrappedValue = next
        MacTelemetry.capture(.settingsChanged(setting: field))
      })
  }
}
