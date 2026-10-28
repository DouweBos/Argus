import ArgusUI
import SwiftUI
import UIKit
import UserNotifications

struct SettingsView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var automations
  @Environment(\.openURL) private var openURL

  @State private var name = ""
  @State private var saved = false
  @State private var notificationStatus: UNAuthorizationStatus = .notDetermined
  /// The computer's autonomy cap: nil until read, `.some(nil)` for no cap.
  @State private var defaultAutonomy: RemoteAutonomy??

  var body: some View {
    Form {
      Section("Connection") {
        LabeledContent("Status") {
          Text(host.connection.rawValue)
            .foregroundStyle(host.connection == .ready ? theme.success : theme.warning)
        }
        if !host.capabilities.isEmpty {
          LabeledContent("Grants", value: host.capabilities.joined(separator: ", "))
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
        ColorThemePicker(selection: colorThemeBinding)
          .frame(maxWidth: .infinity)
      } footer: {
        Text("Match your system, or force light or dark, and pick an accent colour.")
      }

      Section {
        Picker("Default permission mode", selection: permissionModeBinding) {
          Text("Computer's default").tag(RemotePermissionMode?.none)
          ForEach(RemotePermissionMode.allCases, id: \.self) { mode in
            Text(mode.label).tag(Optional(mode))
          }
        }
      } header: {
        Text("Agents")
      } footer: {
        Text("The mode new agents started from this phone begin in.")
      }

      if let autonomy = defaultAutonomy {
        Section {
          Picker("Autonomy cap", selection: autonomyBinding(autonomy)) {
            Text("No cap").tag(RemoteAutonomy?.none)
            ForEach(RemoteAutonomy.allRungs, id: \.self) { rung in
              Text(rung.label.capitalized).tag(Optional(rung))
            }
          }
          .disabled(!host.hasControl)
        } header: {
          Text("Automations")
        } footer: {
          Text(
            "How far any automation on this computer may go on its own. A project can cap it lower, never higher.")
        }
      }

      Section {
        Button {
          router.push(.notifications)
        } label: {
          HStack {
            Text("Warnings & errors")
            Spacer()
            if app.unseenWarnings > 0 {
              Badge(label: "\(app.unseenWarnings)", tone: .danger)
            }
          }
        }
      }

      Section {
        Toggle("Expand image reads", isOn: autoExpandImageReadsBinding)
          .toggleStyle(.argusSwitch)
      } header: {
        Text("Transcript")
      } footer: {
        Text("Open Read tool calls that returned an image, so screenshots show without a tap.")
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
          .toggleStyle(.argusSwitch)
      } footer: {
        Text(app.pushState.explanation)
      }

      Section {
        Button("Claude accounts") { router.push(.claudeAccounts) }
        Button("Usage") { router.push(.usage) }
      } header: {
        Text("Claude")
      } footer: {
        Text("Choose which account new agents run as, add or remove the ones "
          + "signed in on this computer, and see how much of each plan is left.")
      }

      Section {
        Toggle("Anonymous usage & crash reports", isOn: telemetryBinding)
          .toggleStyle(.argusSwitch)
      } header: {
        Text("Privacy")
      } footer: {
        Text(
          "Off, Argus sends one anonymous heartbeat per launch so we can count installs. On, it also sends which screens you open, which actions you take, and crash reports — never prompts, project names, branches or paths."
        )
      }

      if !host.deviceHosts.isEmpty {
        Section {
          ForEach(host.deviceHosts) { entry in
            if entry.isEas {
              EasHostRow(entry: entry)
            } else {
              LabeledContent(entry.label) {
                Text(deviceHostStatusLabel(entry.status))
                  .foregroundStyle(entry.status == .unreachable ? theme.warning : theme.textMuted)
              }
            }
          }
        } header: {
          Text("Device hosts")
        } footer: {
          Text(
            "Other Macs this computer streams simulators from over SSH, and EAS Simulator hosts in Expo's cloud. Add or remove them, and set Expo tokens, in Argus on the computer."
          )
        }
      }

      Section {
        Button(app.account.isSignedIn ? "Account and computers" : "Sign in") {
          router.push(.account)
        }
      } header: {
        Text("Argus account")
      } footer: {
        Text(
          app.account.isSignedIn
            ? "Safety code \(app.account.safetyCode ?? "—"). Computers on your account connect without a QR code."
            : "Sign in once and the computers on your account show up here, with no QR code per computer.")
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
    .task(id: host.connection == .ready) {
      guard host.connection == .ready else { return }
      defaultAutonomy = await automations.loadDefaultAutonomy()
      await host.refreshDeviceHosts()
    }
  }

  private func deviceHostStatusLabel(_ status: RemoteDeviceHost.Status) -> String {
    switch status {
    case .connected: "Connected"
    case .unreachable: "Unreachable"
    case .unknown: "Not checked yet"
    }
  }

  private var colorThemeBinding: Binding<ColorTheme> {
    Binding(get: { app.colorTheme }, set: { app.setColorTheme($0) })
  }

  private var appearance: Binding<ThemePreference> {
    Binding(get: { app.themePreference }, set: { app.setThemePreference($0) })
  }

  private var permissionModeBinding: Binding<RemotePermissionMode?> {
    Binding(get: { app.defaultPermissionMode }, set: { app.setDefaultPermissionMode($0) })
  }

  private func autonomyBinding(_ current: RemoteAutonomy?) -> Binding<RemoteAutonomy?> {
    Binding(
      get: { current },
      set: { next in
        Task {
          guard await automations.setDefaultAutonomy(next) else { return }
          defaultAutonomy = .some(next)
          Telemetry.capture(.defaultChanged(setting: .autonomy, value: next?.rawValue ?? "none"))
        }
      })
  }

  private var autoExpandImageReadsBinding: Binding<Bool> {
    Binding(get: { app.autoExpandImageReads }, set: { app.setAutoExpandImageReads($0) })
  }

  private var telemetryBinding: Binding<Bool> {
    Binding(
      get: { app.telemetryMode == .full },
      set: { app.setTelemetryMode($0 ? .full : .presence) })
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

/// An EAS Simulator host: its running sessions, and a way to start one. A
/// session is billed to the Expo account on the computer, so starting one is
/// control-only and asks first.
private struct EasHostRow: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  let entry: RemoteDeviceHost
  @State private var confirming = false
  @State private var busy = false
  @State private var note: String?
  @State private var failed = false

  private var running: Int { entry.runningSessions ?? 0 }
  private var limit: Int { entry.maxSessions ?? 0 }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      LabeledContent(entry.label) {
        Text("EAS · \(running) of \(limit) running")
          .foregroundStyle(entry.status == .unreachable ? theme.warning : theme.textMuted)
      }
      if host.hasControl {
        Button(busy ? "Starting…" : "Start a session") { confirming = true }
          .disabled(busy || running >= limit)
      }
      if let note {
        Text(note)
          .font(.caption)
          .foregroundStyle(failed ? theme.error : theme.textMuted)
      }
    }
    .confirmationDialog(
      "Start an EAS Simulator session?", isPresented: $confirming, titleVisibility: .visible
    ) {
      Button("Start session (billed)", action: start)
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        "It costs money: the session is billed to the Expo account on the computer until you end it, it sits idle, or it reaches its time limit. It can take a few minutes to start."
      )
    }
  }

  private func start() {
    busy = true
    failed = false
    note = nil
    Task {
      defer { busy = false }
      do {
        _ = try await host.startEasSession(hostId: entry.id)
        note = "Starting. The device shows up under Devices once it's ready."
      } catch {
        failed = true
        note = HostStore.describe(error)
      }
    }
  }
}
