import ArgusCore
import ArgusUI
import SwiftUI

/// "This Mac's name": one name for this Mac and its bundled host, since you
/// see one machine. Saved on Return or when the field loses focus; while
/// signed in it renames both on the account.
struct DeviceNameSection: View {
  @Environment(DesktopModel.self) private var model
  @State private var draft = ""
  @State private var error: String?
  @FocusState private var focused: Bool

  private var preferences: AppPreferences { .shared }

  var body: some View {
    SettingsGroup("This Mac") {
      SettingsRow(
        "Name",
        description: "How your iPhone, your other computers and your Argus account list this Mac and its host. "
          + "Leave empty for the system name."
      ) {
        TextField("Name", text: $draft, prompt: Text(AppPreferences.systemDeviceName))
          .textFieldStyle(.roundedBorder)
          .frame(width: 240)
          .focused($focused)
          .onSubmit(commit)
          .onChange(of: focused) { _, now in
            if !now { commit() }
          }
      }
      SettingsError(text: error)
    }
    .onAppear { draft = preferences.deviceName }
    // Renamed from the account list or another device.
    .onChange(of: preferences.deviceName) { _, next in
      if !focused { draft = next }
    }
  }

  private func commit() {
    let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    let target = trimmed.isEmpty ? AppPreferences.systemDeviceName : trimmed
    guard target != preferences.effectiveDeviceName else {
      draft = preferences.deviceName
      return
    }
    guard AccountDeviceKeys.validatedName(target) != nil else {
      error = "Names are 1–64 characters on one line."
      return
    }
    error = nil
    Task { await model.account.setName(target, source: .settings) }
  }
}
