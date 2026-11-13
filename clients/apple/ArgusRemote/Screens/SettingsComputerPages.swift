import ArgusUI
import SwiftUI

/// The connected computer's settings that a phone can see or change.

struct ConnectionSettingsPage: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host

  var body: some View {
    SettingsPage {
      SettingsGroup(footer: "Change what this device may do under Settings → Remote in Argus on the computer.") {
        SettingsRow("Status") {
          HStack(spacing: 6) {
            StatusDot(tone: host.connection == .ready ? .success : .warning, pulse: false)
            Text(host.connection.label)
              .font(.scaled(size: 13))
              .foregroundStyle(host.connection == .ready ? theme.success : theme.warning)
          }
        }
        if !host.capabilities.isEmpty {
          SettingsRow("Access") {
            Text(GrantLabel.text(host.capabilities))
              .font(.scaled(size: 13))
              .foregroundStyle(theme.textSecondary)
          }
        }
      }
      if let identity = app.identity {
        SettingsGroup {
          NavigationLink(value: Route.computer(deviceId: identity.deviceId)) {
            SettingsLinkRow("Computer details", systemImage: Icon.desktop)
          }
          .buttonStyle(.settingsRow)
          .settingsRowFlush()
        }
      }
    }
    .settingsPage(.connection)
  }
}

struct AgentsSettingsPage: View {
  @Environment(AppStore.self) private var app

  var body: some View {
    SettingsPage {
      SettingsGroup("New agents") {
        SettingsRow("Default permission mode", description: "The mode new agents started from this phone begin in.") {
          Picker(
            "Default permission mode",
            selection: Binding(get: { app.defaultPermissionMode }, set: { app.setDefaultPermissionMode($0) })
          ) {
            Text("Computer's default").tag(RemotePermissionMode?.none)
            ForEach(RemotePermissionMode.allCases, id: \.self) { mode in
              Text(mode.label).tag(Optional(mode))
            }
          }
          .pickerStyle(.menu)
        }
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
    SettingsPage {
      SettingsGroup("Automations") {
        if let current = autonomy {
          SettingsRow(
            "Autonomy cap",
            description: "How far any automation on this computer may go on its own. A project can cap it lower, never higher."
          ) {
            Picker("Autonomy cap", selection: binding(current)) {
              Text("No cap").tag(RemoteAutonomy?.none)
              ForEach(RemoteAutonomy.allRungs, id: \.self) { rung in
                Text(rung.label.capitalized).tag(Optional(rung))
              }
            }
            .pickerStyle(.menu)
            .disabled(!host.hasControl)
          }
        } else {
          Loading(label: "Reading the computer's settings…")
        }
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

/// The computer's worktree cleanup: the policy, what it would remove now, and Clean Up Now.
struct WorktreesSettingsPage: View {
  @Environment(HostStore.self) private var host
  @State private var cleanup: WorktreeCleanupModel?

  var body: some View {
    SettingsPage {
      if let cleanup {
        WorktreeCleanupSettings(model: cleanup, canEdit: host.hasControl) { field, value in
          Telemetry.capture(.defaultChanged(setting: Self.setting(field), value: value))
        }
      }
    }
    .settingsPage(.worktrees)
    .task(id: host.connection == .ready) {
      let model = cleanup ?? WorktreeCleanupModel(host: host)
      cleanup = model
      guard host.connection == .ready else { return }
      await model.load()
    }
    .refreshable { await cleanup?.load() }
  }

  private static func setting(_ field: WorktreeCleanupSettings.Field) -> TelemetryEvent.DefaultSetting {
    switch field {
    case .enabled: .worktreeCleanupEnabled
    case .landedDays: .worktreeCleanupLandedDays
    case .idleDays: .worktreeCleanupIdleDays
    case .maxSize: .worktreeCleanupMaxSize
    }
  }
}

struct DeviceHostsSettingsPage: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  var body: some View {
    SettingsPage {
      SettingsGroup(
        "Device hosts",
        footer:
          "Other Macs this computer streams simulators from over SSH, and EAS Simulator hosts in Expo's cloud. Add or remove them, and set Expo tokens, in Argus on the computer."
      ) {
        if host.deviceHosts.isEmpty {
          Text("No device hosts on this computer.")
            .font(.scaled(size: 13))
            .foregroundStyle(theme.textSecondary)
        }
        ForEach(host.deviceHosts) { entry in
          if entry.isEas {
            EasHostRow(entry: entry)
          } else {
            DeviceHostRow(entry: entry, detail: statusLabel(entry.status))
          }
        }
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

/// A device host's status dot, name and what it's doing.
private struct DeviceHostRow<Trailing: View>: View {
  @Environment(\.theme) private var theme
  let entry: RemoteDeviceHost
  let detail: String
  @ViewBuilder var trailing: Trailing

  var body: some View {
    HStack(spacing: 10) {
      StatusDot(tone: tone, pulse: false).frame(width: TextScale.shared(24))
      VStack(alignment: .leading, spacing: 2) {
        Text(entry.label)
          .font(.scaled(size: 15))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        Text(detail)
          .font(.scaled(size: 13))
          .foregroundStyle(entry.status == .unreachable ? theme.warning : theme.textSecondary)
          .lineLimit(1)
      }
      Spacer(minLength: 6)
      trailing
    }
  }

  private var tone: Tone {
    switch entry.status {
    case .connected: .success
    case .unreachable: .warning
    case .unknown: .muted
    }
  }
}

extension DeviceHostRow where Trailing == EmptyView {
  init(entry: RemoteDeviceHost, detail: String) {
    self.init(entry: entry, detail: detail) { EmptyView() }
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
      DeviceHostRow(entry: entry, detail: "EAS · \(running) of \(limit) running") {
        if host.hasControl {
          Btn(label: busy ? "Starting…" : "Start", tone: .secondary, small: true, hugs: true) { confirming = true }
            .disabled(busy || running >= limit)
        }
      }
      if let note {
        Text(note)
          .font(.scaled(size: 12))
          .foregroundStyle(failed ? theme.error : theme.textSecondary)
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
