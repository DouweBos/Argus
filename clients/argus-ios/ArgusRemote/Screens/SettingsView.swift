import ArgusKit
import SwiftUI
import UIKit
import UserNotifications

struct SettingsView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router
  @Environment(\.openURL) private var openURL

  @State private var name = ""
  @State private var saved = false
  @State private var notificationStatus: UNAuthorizationStatus = .notDetermined

  var body: some View {
    Form {
      Section("Connection") {
        LabeledContent("Status") {
          Text(app.connection.rawValue)
            .foregroundStyle(app.connection == .ready ? theme.success : theme.warning)
        }
        if !app.capabilities.isEmpty {
          LabeledContent("Grants", value: app.capabilities.joined(separator: ", "))
        }
      }

      Section {
        TextField("Device name", text: $name)
          .textInputAutocapitalization(.words)
          .onSubmit(save)
        Button(saved ? "Saved" : "Save", action: save)
          .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name == app.deviceName)
      } header: {
        Text("Device name")
      } footer: {
        Text("Shown under paired devices in Argus on every computer you pair with.")
      }

      Section {
        Picker("Appearance", selection: appearance) {
          ForEach(ThemePreference.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
      } footer: {
        Text("Match your system, or force light or dark.")
      }

      Section {
        LabeledContent("Notifications", value: notificationLabel)
        if notificationStatus == .denied {
          // Only iOS can undo a denial, so send them there rather than
          // leaving a dead button behind.
          Button("Open iOS Settings") {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            openURL(url)
          }
        } else if notificationStatus == .notDetermined {
          Button("Enable", action: enableNotifications)
        }
      } header: {
        Text("Alerts")
      } footer: {
        Text("Get alerted when an agent finishes or needs approval.")
      }

      Section {
        Toggle("Background push", isOn: pushBinding)
      } footer: {
        Text(app.pushState.explanation)
      }

      Section {
        if let identity = app.identity {
          LabeledContent("Connected to", value: identity.label)
        }
        Button(app.hosts.isEmpty ? "Pair a computer" : "Manage computers") {
          router.push(app.hosts.isEmpty ? .pair : .computers)
        }
      } header: {
        Text("Computers")
      } footer: {
        Text("Pair with as many computers as you like; the app talks to one at a time.")
      }
    }
    .navigationTitle("Settings")
    .task {
      name = app.deviceName
      notificationStatus = await NotificationRouter.shared.authorizationStatus()
    }
  }

  private var appearance: Binding<ThemePreference> {
    Binding(get: { app.themePreference }, set: { app.setThemePreference($0) })
  }

  private var pushBinding: Binding<Bool> {
    Binding(
      get: { app.pushEnabled },
      set: { enabled in Task { await app.setPushEnabled(enabled) } })
  }

  private var notificationLabel: String {
    switch notificationStatus {
    case .authorized, .provisional, .ephemeral: "Enabled"
    case .denied: "Blocked — enable in system settings"
    default: "Not enabled"
    }
  }

  private func save() {
    Task {
      await app.setDeviceName(name)
      saved = true
      try? await Task.sleep(for: .milliseconds(1200))
      saved = false
    }
  }

  private func enableNotifications() {
    Task {
      _ = await NotificationRouter.shared.requestAuthorization()
      // Permission is what gates the push token, so re-register right after.
      await app.setPushEnabled(true)
      notificationStatus = await NotificationRouter.shared.authorizationStatus()
    }
  }
}
