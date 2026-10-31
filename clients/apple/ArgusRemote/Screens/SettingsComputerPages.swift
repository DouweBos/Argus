import ArgusUI
import SwiftUI

/// The connected computer's settings that a phone can see or change.

struct ConnectionSettingsPage: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host

  var body: some View {
    Form {
      Section {
        LabeledContent("Status") {
          Text(host.connection.label)
            .foregroundStyle(host.connection == .ready ? theme.success : theme.warning)
        }
        if !host.capabilities.isEmpty {
          LabeledContent("Access", value: GrantLabel.text(host.capabilities))
        }
      } footer: {
        Text("Change what this device may do under Settings → Remote in Argus on the computer.")
      }
      if let identity = app.identity {
        Section {
          NavigationLink(value: Route.computer(deviceId: identity.deviceId)) {
            Label("Computer details", systemImage: Icon.desktop)
          }
        }
      }
    }
    .settingsPage(.connection)
  }
}

struct AgentsSettingsPage: View {
  @Environment(AppStore.self) private var app

  var body: some View {
    Form {
      Section {
        Picker(
          "Default permission mode",
          selection: Binding(
            get: { app.defaultPermissionMode }, set: { app.setDefaultPermissionMode($0) })
        ) {
          Text("Computer's default").tag(RemotePermissionMode?.none)
          ForEach(RemotePermissionMode.allCases, id: \.self) { mode in
            Text(mode.label).tag(Optional(mode))
          }
        }
      } footer: {
        Text("The mode new agents started from this phone begin in.")
      }
    }
    .settingsPage(.agents)
  }
}

struct AutomationsSettingsPage: View {
  @Environment(HostStore.self) private var host
  @Environment(AutomationsStore.self) private var automations
  /// The computer's autonomy cap: nil until read, `.some(nil)` for no cap.
  @State private var autonomy: RemoteAutonomy??

  var body: some View {
    Form {
      if let current = autonomy {
        Section {
          Picker("Autonomy cap", selection: binding(current)) {
            Text("No cap").tag(RemoteAutonomy?.none)
            ForEach(RemoteAutonomy.allRungs, id: \.self) { rung in
              Text(rung.label.capitalized).tag(Optional(rung))
            }
          }
          .disabled(!host.hasControl)
        } footer: {
          Text(
            "How far any automation on this computer may go on its own. A project can cap it lower, never higher.")
        }
      } else {
        Loading(label: "Reading the computer's settings…")
          .listRowBackground(Color.clear)
      }
    }
    .settingsPage(.automations)
    .task(id: host.connection == .ready) {
      guard host.connection == .ready else { return }
      autonomy = await automations.loadDefaultAutonomy()
    }
  }

  private func binding(_ current: RemoteAutonomy?) -> Binding<RemoteAutonomy?> {
    Binding(
      get: { current },
      set: { next in
        Task {
          guard await automations.setDefaultAutonomy(next) else { return }
          autonomy = .some(next)
          Telemetry.capture(.defaultChanged(setting: .autonomy, value: next?.rawValue ?? "none"))
        }
      })
  }
}

struct DeviceHostsSettingsPage: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  var body: some View {
    Form {
      Section {
        ForEach(host.deviceHosts) { entry in
          if entry.isEas {
            EasHostRow(entry: entry)
          } else {
            LabeledContent(entry.label) {
              Text(statusLabel(entry.status))
                .foregroundStyle(entry.status == .unreachable ? theme.warning : theme.textMuted)
            }
          }
        }
      } footer: {
        Text(
          "Other Macs this computer streams simulators from over SSH, and EAS Simulator hosts in Expo's cloud. Add or remove them, and set Expo tokens, in Argus on the computer."
        )
      }
    }
    .settingsPage(.deviceHosts)
    .refreshable { await host.refreshDeviceHosts() }
    .task { await host.refreshDeviceHosts() }
  }

  private func statusLabel(_ status: RemoteDeviceHost.Status) -> String {
    switch status {
    case .connected: "Connected"
    case .unreachable: "Unreachable"
    case .unknown: "Not checked yet"
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
