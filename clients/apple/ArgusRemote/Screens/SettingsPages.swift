import ArgusUI
import SwiftUI
import UIKit
import UserNotifications

/// A settings sub-page. The phone's own pages first, then the computer's.
enum SettingsPage: String, Hashable {
  case name, appearance, alerts, privacy
  case connection, agents, automations
  case deviceHosts = "device_hosts"

  var title: String {
    switch self {
    case .name: "Name"
    case .appearance: "Appearance"
    case .alerts: "Alerts"
    case .privacy: "Privacy"
    case .connection: "Connection"
    case .agents: "Agents"
    case .automations: "Automations"
    case .deviceHosts: "Device hosts"
    }
  }

  var symbol: String {
    switch self {
    case .name: "character.cursor.ibeam"
    case .appearance: "paintpalette"
    case .alerts: "app.badge"
    case .privacy: "hand.raised"
    case .connection: "antenna.radiowaves.left.and.right"
    case .agents: Icon.agents
    case .automations: Icon.automations
    case .deviceHosts: Icon.devices
    }
  }

  @ViewBuilder
  var screen: some View {
    switch self {
    case .name: NameSettingsPage()
    case .appearance: AppearanceSettingsPage()
    case .alerts: AlertsSettingsPage()
    case .privacy: PrivacySettingsPage()
    case .connection: ConnectionSettingsPage()
    case .agents: AgentsSettingsPage()
    case .automations: AutomationsSettingsPage()
    case .deviceHosts: DeviceHostsSettingsPage()
    }
  }
}

extension View {
  func settingsPage(_ page: SettingsPage) -> some View {
    navigationTitle(page.title).navigationBarTitleDisplayMode(.inline)
  }
}

private var deviceNoun: String {
  UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
}

struct NameSettingsPage: View {
  @Environment(AppStore.self) private var app
  @State private var name = ""
  @State private var saved = false

  var body: some View {
    Form {
      Section {
        TextField("This \(deviceNoun)'s name", text: $name)
          .textInputAutocapitalization(.words)
          .onSubmit(save)
        Button(saved ? "Saved" : "Save", action: save)
          .disabled(!nameIsSavable)
      } footer: {
        Text(
          "How your computers and your Argus account list this \(deviceNoun). Changing it renames it on the account too.")
      }
    }
    .settingsPage(.name)
    // Renamed from the account list or another device.
    .onChange(of: app.deviceName) { _, next in name = next }
    .task { name = app.deviceName }
  }

  private var nameIsSavable: Bool {
    AccountDeviceKeys.validatedName(name).map { $0 != app.deviceName } ?? false
  }

  private func save() {
    guard nameIsSavable else { return }
    Task {
      guard await app.setDeviceName(name) else { return }
      name = app.deviceName
      saved = true
      try? await Task.sleep(for: .milliseconds(1200))
      saved = false
    }
  }
}

struct AppearanceSettingsPage: View {
  @Environment(AppStore.self) private var app

  var body: some View {
    Form {
      Section("Colour scheme") {
        ColorSchemeCards(
          selection: Binding(get: { app.themePreference }, set: { app.setThemePreference($0) }),
          colorTheme: app.colorTheme)
        .padding(.vertical, 4)
      }
      Section {
        ColorThemeCards(
          selection: Binding(get: { app.colorTheme }, set: { app.setColorTheme($0) }))
        .padding(.vertical, 4)
      } header: {
        Text("Colour theme")
      } footer: {
        Text("The accent used for buttons, links and selection.")
      }
      Section {
        Toggle(
          "Expand image reads",
          isOn: Binding(
            get: { app.autoExpandImageReads }, set: { app.setAutoExpandImageReads($0) })
        )
        .toggleStyle(.argusSwitch)
      } header: {
        Text("Transcript")
      } footer: {
        Text("Open Read tool calls that returned an image, so screenshots show without a tap.")
      }
    }
    .settingsPage(.appearance)
  }
}

struct AlertsSettingsPage: View {
  @Environment(AppStore.self) private var app
  @Environment(\.openURL) private var openURL
  @State private var status: UNAuthorizationStatus = .notDetermined

  var body: some View {
    Form {
      Section {
        LabeledContent("Notifications", value: statusLabel)
        if status == .denied {
          // Only iOS can undo a denial, so send them there rather than
          // leaving a dead button behind.
          Button("Open iOS Settings") {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            openURL(url)
          }
        } else if status == .notDetermined {
          Button("Enable", action: enable)
        }
      } footer: {
        Text("Get alerted when an agent finishes or needs approval.")
      }

      Section {
        Toggle(
          "Background push",
          isOn: Binding(
            get: { app.pushEnabled },
            set: { enabled in Task { await app.setPushEnabled(enabled) } })
        )
        .toggleStyle(.argusSwitch)
      } footer: {
        Text(app.pushState.explanation)
      }
    }
    .settingsPage(.alerts)
    .task { status = await NotificationRouter.shared.authorizationStatus() }
  }

  private var statusLabel: String {
    switch status {
    case .authorized, .provisional, .ephemeral: "On"
    case .denied: "Off in iOS Settings"
    default: "Not enabled"
    }
  }

  private func enable() {
    Task {
      _ = await NotificationRouter.shared.requestAuthorization()
      // Permission is what gates the push token, so re-register right after.
      await app.setPushEnabled(true)
      status = await NotificationRouter.shared.authorizationStatus()
    }
  }
}

struct PrivacySettingsPage: View {
  @Environment(AppStore.self) private var app

  var body: some View {
    Form {
      Section {
        Toggle(
          "Anonymous usage & crash reports",
          isOn: Binding(
            get: { app.telemetryMode == .full },
            set: { app.setTelemetryMode($0 ? .full : .presence) })
        )
        .toggleStyle(.argusSwitch)
      } footer: {
        Text(
          "Off, Argus sends one anonymous heartbeat per launch so we can count installs. On, it also sends which screens you open, which actions you take, and crash reports — never prompts, project names, branches or paths."
        )
      }
    }
    .settingsPage(.privacy)
  }
}
